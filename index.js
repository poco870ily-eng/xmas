// index.js
import dotenv from "dotenv";
dotenv.config();

import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import express from "express";
import axios from "axios";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// ===== ENV =====
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const IPN_SECRET = process.env.IPN_SECRET;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!DISCORD_TOKEN || !NOWPAYMENTS_API_KEY || !IPN_SECRET || !WEBHOOK_URL || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❗ Не заданы все переменные окружения. Проверь .env");
  process.exit(1);
}

// ===== SUPABASE CLIENT =====
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== DISCORD BOT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    client.user.setPresence({
      activities: [{ name: "Crypto Payments 💰" }],
      status: "online"
    });
  } catch (e) {
    console.warn("Не удалось выставить presence:", e.message);
  }
});

// ===== HELPERS (Supabase) =====
async function addBalance(userId, amount) {
  // upsert: если нет — создаст, если есть — обновит
  const { error } = await supabase
    .from("users")
    .upsert({ user_id: userId, balance: 0 }, { onConflict: "user_id" });

  if (error) console.error("Supabase upsert error:", error);

  const { error: updateErr } = await supabase
    .from("users")
    .update({ balance: supabase.raw("COALESCE(balance,0) + ?", [amount]) })
    .eq("user_id", userId);

  if (updateErr) console.error("Supabase update error:", updateErr);
}

async function getBalance(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("balance")
    .eq("user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") console.error("Supabase select error:", error);
  return data ? parseFloat(data.balance) || 0 : 0;
}

// ===== DISCORD COMMANDS =====
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // ===== /pay =====
  if (message.content.startsWith("/pay")) {
    const args = message.content.trim().split(/\s+/);
    const amount = parseFloat(args[1]);
    const cryptoCurrency = args[2]?.toUpperCase();

    if (!amount || !cryptoCurrency) {
      return message.reply("Use: `/pay 10 BTC` or `/pay 10 LTC`");
    }

    if (!["BTC", "LTC"].includes(cryptoCurrency)) {
      return message.reply("Available currencies: BTC or LTC");
    }

    try {
      const response = await axios.post(
        "https://api.nowpayments.io/v1/payment",
        {
          price_amount: amount,
          price_currency: "USD",
          pay_currency: cryptoCurrency,
          order_id: message.author.id,
          ipn_callback_url: WEBHOOK_URL
        },
        {
          headers: {
            "x-api-key": NOWPAYMENTS_API_KEY,
            "Content-Type": "application/json"
          },
          timeout: 15000
        }
      );

      const payment = response.data;
      // Логируем весь объект — полезно для отладки
      console.log("Payment response (create):");
      console.dir(payment, { depth: null, colors: false });

      // 기본: используем invoice_url
      let payLink = payment.invoice_url ?? null;

      // fallback: если invoice_url отсутствует, делаем GET по payment_id
      if (!payLink && payment.payment_id) {
        try {
          const statusResp = await axios.get(
            `https://api.nowpayments.io/v1/payment/${payment.payment_id}`,
            { headers: { "x-api-key": NOWPAYMENTS_API_KEY }, timeout: 10000 }
          );
          const statusData = statusResp.data;
          console.log("Payment status fetched (fallback):");
          console.dir(statusData, { depth: null, colors: false });
          payLink = statusData?.invoice_url ?? null;
        } catch (err) {
          console.log("Fallback GET /payment/{id} failed:", err.message);
          // не критично — продолжим с тем, что есть
        }
      }

      // формируем поля embed'а аккуратно
      const amountToPay = payment.pay_amount ?? payment.estimated_amount ?? "—";
      const payCurrency = (payment.pay_currency ?? cryptoCurrency).toUpperCase();

      const embed = new EmbedBuilder()
        .setTitle("💰 Payment Instructions")
        .setColor("#FFD700")
        .addFields(
          { name: "Amount (USD)", value: `${payment.price_amount ?? amount} USD`, inline: true },
          { name: "To Pay", value: `${amountToPay} ${payCurrency}`, inline: true },
          {
            name: "Payment Address",
            value: payment.pay_address ? `\`${payment.pay_address}\`` : "No direct address provided"
          }
        )
        .setTimestamp();

      if (payLink) {
        embed.addFields({ name: "Pay Link", value: `[Click Here to Pay](${payLink})` });
      } else {
        // Если нет ссылки — даём инструкцию и минимальную информацию
        embed.addFields({
          name: "Pay Link",
          value:
            "Link not available. Use the address + amount shown above or contact support.\n" +
            (payment.payment_id ? `Payment id: \`${payment.payment_id}\`` : "")
        });
      }

      embed.addFields(
        { name: "Status", value: payment.payment_status ?? "waiting", inline: true },
        {
          name: "Expires At",
          value: payment.expiration_estimate_date
            ? new Date(payment.expiration_estimate_date).toLocaleString()
            : "Not specified",
          inline: true
        }
      );

      // Отправляем в DM
      try {
        await message.author.send({ embeds: [embed] });
        await message.reply("📬 Payment details sent to your DM!");
      } catch (dmErr) {
        console.log("DM send error:", dmErr.message);
        await message.reply("📬 Не удалось отправить в ЛС — проверьте настройки приватности. Ссылка/инфо ниже:");
        // если DM не прошёл — шлём кратко в канал
        const short = payLink ? `Pay: ${payLink}` : `Address: ${payment.pay_address ?? "—"}`;
        await message.reply(short);
      }
    } catch (err) {
      console.log("NOWPayments create error:", err.response?.data ?? err.message);
      message.reply("❌ Failed to create payment.");
    }
  }

  // ===== /balance =====
  if (message.content === "/balance") {
    try {
      const bal = await getBalance(message.author.id);
      message.reply(`💳 Your balance: ${bal} USD`);
    } catch (err) {
      console.error("Get balance error:", err.message);
      message.reply("❌ Ошибка получения баланса.");
    }
  }
});

// ===== IPN VERIFY =====
// Note: NowPayments signs the raw body; here we compute HMAC over JSON.stringify(req.body)
// This matches your previous approach — ensure your middleware doesn't mutate body before this.
function verifyIPN(req) {
  const signatureHeader = req.headers["x-nowpayments-sig"] || req.headers["x-nowpayments-sign"];
  if (!signatureHeader) return false;

  const hmac = crypto
    .createHmac("sha512", IPN_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  return hmac === signatureHeader;
}

// ===== WEB SERVER =====
const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("Bot is alive ✅"));

app.post("/webhook", async (req, res) => {
  console.log("Webhook received:", req.body);

  if (!verifyIPN(req)) {
    console.log("❌ Invalid IPN signature");
    return res.status(401).send("Invalid signature");
  }

  const data = req.body;
  const status = data.payment_status;
  const userId = data.order_id;
  const amount = parseFloat(data.price_amount || 0);

  console.log("IPN status:", status, "order_id:", userId, "amount:", amount);

  try {
    // Try to fetch user and DM them about status updates
    if (userId) {
      try {
        const user = await client.users.fetch(userId);

        if (status === "waiting") await user.send("⏳ Payment created. Waiting for transfer...");
        if (status === "confirming") await user.send("🔄 Payment received. Waiting for blockchain confirmations...");
        if (status === "confirmed") await user.send("💰 Payment confirmed by network.");
        if (status === "finished") {
          // update balance in supabase
          await addBalance(userId, amount);

          const embed = new EmbedBuilder()
            .setTitle("✅ Payment Completed")
            .setColor("#00FF00")
            .addFields(
              { name: "Amount", value: `${amount} USD`, inline: true },
              { name: "Balance Updated", value: "Check using /balance" }
            )
            .setTimestamp();

          await user.send({ embeds: [embed] });
        }
      } catch (dmErr) {
        console.log("DM error (webhook):", dmErr.message);
      }
    } else {
      console.log("No order_id in IPN payload, cannot DM user or update balance.");
    }
  } catch (err) {
    console.log("Processing IPN error:", err.message);
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log("🌐 Webhook server running on port", PORT));

// ===== LOGIN DISCORD =====
client.login(DISCORD_TOKEN).catch((e) => {
  console.error("Discord login failed:", e.message);
  process.exit(1);
});
