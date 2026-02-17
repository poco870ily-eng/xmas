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
  db.run(
    `INSERT OR IGNORE INTO users (user_id, balance) VALUES (?, 0)`,
    [userId]
  );

  db.run(
    `UPDATE users SET balance = balance + ? WHERE user_id = ?`,
    [amount, userId]
  );
}

function getBalance(userId) {
  return new Promise((resolve) => {
    db.get(
      `SELECT balance FROM users WHERE user_id = ?`,
      [userId],
      (err, row) => {
        resolve(row ? row.balance : 0);
      }
    );
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
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // ===== /pay =====
  if (message.content.startsWith("/pay")) {
    const args = message.content.split(" ");
    const amount = parseFloat(args[1]);
    const cryptoCurrency = args[2]?.toLowerCase();

    if (!amount || !cryptoCurrency) {
      return message.reply("Используй: `/pay 10 btc` или `/pay 10 ltc`");
    }

    if (cryptoCurrency !== "btc" && cryptoCurrency !== "ltc") {
      return message.reply("Доступно только: btc или ltc");
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

      const embed = new EmbedBuilder()
        .setTitle("💰 Инструкция для оплаты")
        .setColor("#FFD700")
        .addFields(
          { name: "Сумма", value: `${payment.price_amount} USD`, inline: true },
          { name: "К оплате", value: `${payment.pay_amount} ${payment.pay_currency.toUpperCase()}`, inline: true },
          { name: "Адрес", value: `\`${payment.pay_address}\`` },
          { name: "Статус", value: "Ожидание оплаты ⏳", inline: true },
          {
            name: "Действителен до",
            value: new Date(payment.expiration_estimate_date).toLocaleString(),
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

// ===== WEBHOOK SERVER =====
const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
  console.log("Webhook received:", req.body);

  if (!verifyIPN(req)) {
    console.log("❌ Invalid IPN signature");
    return res.status(401).send("Invalid signature");
  }

  const data = req.body;
  const status = data.payment_status;

  console.log("STATUS:", status);

  if (status === "confirmed" || status === "finished") {
    const userId = data.order_id;
    const amount = parseFloat(data.price_amount || 0);

    addBalance(userId, amount);
    console.log(`✅ Баланс ${userId} пополнен на ${amount} USD`);

    try {
      const user = await client.users.fetch(userId);

      const embed = new EmbedBuilder()
        .setTitle("✅ Платёж получен")
        .setColor("#00FF00")
        .addFields(
          { name: "Сумма", value: `${amount} USD`, inline: true },
          { name: "Статус", value: "Завершено ✅", inline: true },
          { name: "Баланс обновлён", value: "Проверь через /balance" }
        )
        .setTimestamp();

      await user.send({ embeds: [embed] });
    } catch (err) {
      console.log("Ошибка отправки ЛС:", err.message);
    }
  }

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log("🌐 Webhook server running on port", PORT);
});

// ===== START BOT =====
client.login(DISCORD_TOKEN);
