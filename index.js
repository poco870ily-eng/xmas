import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
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
  const { data } = await supabase
    .from("users")
    .select("balance")
    .eq("user_id", userId)
    .single();

  const newBalance = data ? parseFloat(data.balance) + amount : amount;

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

// ===== КОМАНДА /pay (только сумма) =====
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith("/pay")) {
    const args = message.content.split(" ");
    const amount = parseFloat(args[1]);

    if (!amount || isNaN(amount) || amount <= 0) {
      return message.reply("Используй: `/pay 10` — где 10 это сумма в USD");
    }

    // Меню выбора валюты (в самом боте)
    const select = new StringSelectMenuBuilder()
      .setCustomId(`pay_select_${message.author.id}_${amount}`)
      .setPlaceholder("Выберите криптовалюту")
      .addOptions([
        {
          label: "Bitcoin (BTC)",
          value: "BTC",
          description: "Оплатить в Bitcoin",
          emoji: "₿"
        },
        {
          label: "Litecoin (LTC)",
          value: "LTC",
          description: "Оплатить в Litecoin",
          emoji: "Ł"
        }
      ]);

    const row = new ActionRowBuilder().addComponents(select);

    await message.reply({
      content: `**💰 Оплата на сумму ${amount} USD**\nВыберите валюту для оплаты:`,
      components: [row]
    });
  }

  if (message.content === "/balance") {
    const bal = await getBalance(message.author.id);
    message.reply(`💳 Ваш баланс: ${bal} USD`);
  }
});

// ===== ВЫБОР ВАЛЮТЫ И СОЗДАНИЕ ПЛАТЕЖА =====
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  const customId = interaction.customId;
  if (!customId.startsWith("pay_select_")) return;

  const [, , userId, amountStr] = customId.split("_");
  const selectedCurrency = interaction.values[0];
  const amount = parseFloat(amountStr);

  if (interaction.user.id !== userId) {
    return interaction.reply({ content: "Это не твоя команда оплаты.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const response = await axios.post(
      "https://api.nowpayments.io/v1/payment",
      {
        price_amount: amount,
        price_currency: "USD",
        pay_currency: selectedCurrency,
        order_id: userId,
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

    // Эмбед БЕЗ ССЫЛКИ — только адрес (как ты просил)
    const embed = new EmbedBuilder()
      .setTitle("💰 Инструкция по оплате")
      .setColor("#FFD700")
      .addFields(
        { name: "Сумма", value: `${payment.price_amount} USD`, inline: true },
        { name: "К оплате", value: `${payment.pay_amount} ${selectedCurrency}`, inline: true },
        {
          name: "Адрес для оплаты",
          value: payment.pay_address ? `\`${payment.pay_address}\`` : "Адрес появится позже"
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

    await interaction.user.send({ embeds: [embed] });

    await interaction.editReply({
      content: `✅ Платёж на ${amount} USD в ${selectedCurrency} создан!\nИнструкция отправлена тебе в ЛС.`,
      components: []
    });

  } catch (err) {
    console.error("NOWPayments error:", err.response?.data || err.message);
    await interaction.editReply("❌ Ошибка при создании платежа. Попробуй позже.");
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

    if (status === "waiting") await user.send("⏳ Платёж создан. Ожидаем перевод...");
    if (status === "confirming") await user.send("🔄 Получен перевод. Ожидаем подтверждений сети...");
    if (status === "confirmed") await user.send("💰 Платёж подтверждён сетью.");
    if (status === "finished") {
      await addBalance(userId, amount);

      const embed = new EmbedBuilder()
        .setTitle("✅ Платёж успешно зачислен")
        .setColor("#00FF00")
        .addFields(
          { name: "Сумма", value: `${amount} USD`, inline: true },
          { name: "Баланс обновлён", value: "Проверь через /balance" }
        )
        .setTimestamp();

      await user.send({ embeds: [embed] });
    }
  } catch (err) {
    console.log("DM error:", err.message);
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`🌐 Webhook server running on port ${PORT}`));

client.login(DISCORD_TOKEN);
