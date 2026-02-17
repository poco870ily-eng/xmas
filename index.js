import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import express from "express";
import axios from "axios";
import sqlite3 from "sqlite3";
import crypto from "crypto";

// ===== ENV =====
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const IPN_SECRET = process.env.IPN_SECRET;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

// ===== DATABASE =====
const db = new sqlite3.Database("./database.db");

db.run(`
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    balance REAL DEFAULT 0
)
`);

function addBalance(userId, amount) {
  db.run(`INSERT OR IGNORE INTO users (user_id, balance) VALUES (?, 0)`, [userId]);
  db.run(`UPDATE users SET balance = balance + ? WHERE user_id = ?`, [amount, userId]);
}

function getBalance(userId) {
  return new Promise((resolve) => {
    db.get(`SELECT balance FROM users WHERE user_id = ?`, [userId], (err, row) => {
      resolve(row ? row.balance : 0);
    });
  });
}

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
    activities: [{ name: "Crypto payments 💰" }],
    status: "online"
  });
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // ===== /pay =====
  if (message.content.startsWith("/pay")) {
    const args = message.content.split(" ");
    const amount = parseFloat(args[1]);
    const cryptoCurrency = args[2]?.toUpperCase(); // FIXED

    if (!amount || !cryptoCurrency) {
      return message.reply("Используй: `/pay 10 BTC` или `/pay 10 LTC`");
    }

    if (!["BTC", "LTC"].includes(cryptoCurrency)) {
      return message.reply("Доступно только: BTC или LTC");
    }

    try {
      const response = await axios.post(
        "https://api.nowpayments.io/v1/payment",
        {
          price_amount: amount,
          price_currency: "usd",
          pay_currency: cryptoCurrency,
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
      console.log("Payment response:", payment);

      const embed = new EmbedBuilder()
        .setTitle("💰 Инструкция для оплаты")
        .setColor("#FFD700")
        .addFields(
          { name: "Сумма", value: `${payment.price_amount} USD`, inline: true },
          { name: "К оплате", value: `${payment.pay_amount} ${payment.pay_currency}`, inline: true },
          {
            name: "Адрес",
            value: payment.pay_address
              ? `\`${payment.pay_address}\``
              : "Используйте ссылку ниже",
          },
          {
            name: "Ссылка для оплаты",
            value: payment.invoice_url || "Нет ссылки"
          },
          {
            name: "Статус",
            value: payment.payment_status || "waiting",
            inline: true
          },
          {
            name: "Действителен до",
            value: payment.expiration_estimate_date
              ? new Date(payment.expiration_estimate_date).toLocaleString()
              : "Не указано",
            inline: true
          }
        )
        .setTimestamp();

      await message.author.send({ embeds: [embed] });
      message.reply("📬 Инструкция отправлена в ЛС!");
    } catch (err) {
      console.log("NOWPayments error:", err.response?.data || err.message);
      message.reply("❌ Ошибка создания платежа.");
    }
  }

  // ===== /balance =====
  if (message.content === "/balance") {
    const bal = await getBalance(message.author.id);
    message.reply(`💳 Ваш баланс: ${bal} USD`);
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

// Чтобы Render не засыпал
app.get("/", (req, res) => {
  res.send("Bot is alive ✅");
});

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

  console.log("STATUS:", status);

  try {
    const user = await client.users.fetch(userId);

    if (status === "waiting") {
      await user.send("⏳ Платёж создан. Ожидаем перевод...");
    }

    if (status === "confirming") {
      await user.send("🔄 Платёж получен. Ожидаем подтверждений сети...");
    }

    if (status === "confirmed") {
      await user.send("💰 Платёж подтверждён сетью.");
    }

    if (status === "finished") {
      addBalance(userId, amount);

      const embed = new EmbedBuilder()
        .setTitle("✅ Платёж завершён")
        .setColor("#00FF00")
        .addFields(
          { name: "Сумма", value: `${amount} USD`, inline: true },
          { name: "Баланс обновлён", value: "Проверь через /balance" }
        )
        .setTimestamp();

      await user.send({ embeds: [embed] });
    }

  } catch (err) {
    console.log("Ошибка отправки ЛС:", err.message);
  }

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log("🌐 Webhook server running on port", PORT);
});

client.login(DISCORD_TOKEN);
