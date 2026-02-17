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

  client.user.setPresence({
    activities: [{ name: "Crypto Payments 💰" }],
    status: "online"
  });
});

// ===== HELPERS =====
async function addBalance(userId, amount) {
  const { data, error } = await supabase
    .from("users")
    .select("balance")
    .eq("user_id", userId)
    .single();

  let newBalance = amount;
  if (data) newBalance += parseFloat(data.balance);

  await supabase
    .from("users")
    .upsert({ user_id: userId, balance: newBalance });
}

async function getBalance(userId) {
  const { data } = await supabase
    .from("users")
    .select("balance")
    .eq("user_id", userId)
    .single();

  return data ? parseFloat(data.balance) : 0;
}

// ===== DISCORD COMMANDS =====
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // ===== /pay =====
  if (message.content.startsWith("/pay")) {
    const args = message.content.split(" ");
    const amount = parseFloat(args[1]);
    const cryptoCurrency = args[2]?.toUpperCase(); // для красивого отображения

    if (!amount || !cryptoCurrency) {
      return message.reply("Use: `/pay 10 BTC` or `/pay 10 LTC`");
    }

    if (!["BTC", "LTC"].includes(cryptoCurrency)) {
      return message.reply("Available currencies: BTC or LTC");
    }

    // ← КРИТИЧНО: для API всегда lowercase
    const payCurrencyApi = cryptoCurrency.toLowerCase();

    try {
      const response = await axios.post(
        "https://api.nowpayments.io/v1/payment",
        {
          price_amount: amount,
          price_currency: "USD",
          pay_currency: payCurrencyApi,        // ← lowercase!
          order_id: message.author.id,
          ipn_callback_url: WEBHOOK_URL
        },
        {
          headers: {
            "x-api-key": NOWPAYMENTS_API_KEY,
            "Content-Type": "application/json"
          }
        }
      );

      const payment = response.data;
      console.log("🔍 Full NOWPayments response:", JSON.stringify(payment, null, 2));

      // Лучшая генерация ссылки
      let payLink = payment.invoice_url;
      if (!payLink && payment.payment_id) {
        payLink = `https://nowpayments.io/payment/?iid=${payment.payment_id}`;
      }

      const embed = new EmbedBuilder()
        .setTitle("💰 Payment Instructions")
        .setColor("#FFD700")
        .addFields(
          { name: "Amount", value: `${payment.price_amount} USD`, inline: true },
          { name: "To Pay", value: `${payment.pay_amount} ${cryptoCurrency}`, inline: true },
          {
            name: "Payment Address",
            value: payment.pay_address ? `\`${payment.pay_address}\`` : "Use Pay Link below"
          }
        );

      // Добавляем Pay Link только если он есть
      if (payLink) {
        embed.addFields({
          name: "🔗 Pay Link (with QR-code)",
          value: `[Click Here to Pay](${payLink})`
        });
      }

      embed
        .addFields(
          { name: "Status", value: payment.payment_status || "waiting", inline: true },
          {
            name: "Expires At",
            value: payment.expiration_estimate_date
              ? new Date(payment.expiration_estimate_date).toLocaleString()
              : "Not specified",
            inline: true
          }
        )
        .setTimestamp();

      await message.author.send({ embeds: [embed] });
      message.reply("📬 Payment details sent to your DM!");
    } catch (err) {
      console.error("NOWPayments error:", err.response?.data || err.message);
      message.reply("❌ Failed to create payment.");
    }
  }

  // ===== /balance =====
  if (message.content === "/balance") {
    const bal = await getBalance(message.author.id);
    message.reply(`💳 Your balance: ${bal} USD`);
  }
});

// ===== IPN VERIFY =====
function verifyIPN(req) {
  const hmac = crypto
    .createHmac("sha512", IPN_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  return hmac === req.headers["x-nowpayments-sig"];
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

  try {
    const user = await client.users.fetch(userId);

    if (status === "waiting") await user.send("⏳ Payment created. Waiting for transfer...");
    if (status === "confirming") await user.send("🔄 Payment received. Waiting for blockchain confirmations...");
    if (status === "confirmed") await user.send("💰 Payment confirmed by network.");
    if (status === "finished") {
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
  } catch (err) {
    console.log("DM error:", err.message);
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log("🌐 Webhook server running on port", PORT));

client.login(DISCORD_TOKEN);
