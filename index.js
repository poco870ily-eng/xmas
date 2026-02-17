import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
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
const SUPABASE_KEY = process.env.SUPABASE_KEY;     // ← ОБЯЗАТЕЛЬНО service_role key!
const OWNER_ID = process.env.OWNER_ID;             // ← ТВОЙ Discord User ID

// ===== SUPABASE =====
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== DISCORD BOT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🔧 Используется service_role key: ${SUPABASE_KEY ? "✅" : "❌"}`);
  client.user.setPresence({
    activities: [{ name: "💳 Crypto Payments | /pay", type: 0 }],
    status: "online"
  });
});

// ===== HELPERS =====
async function addBalance(userId, amount) {
  console.log(`💰 addBalance called: userId=${userId}, amount=${amount}`);

  const userIdStr = userId.toString();
  amount = parseFloat(amount);

  if (isNaN(amount) || amount <= 0) return false;

  // Получаем текущий баланс
  const { data, error: selectError } = await supabase
    .from("users")
    .select("balance")
    .eq("user_id", userIdStr)
    .single();

  let currentBalance = 0;
  if (data) {
    currentBalance = parseFloat(data.balance || 0);
  } else if (selectError && selectError.code !== 'PGRST116') {
    console.error("❌ Select error:", selectError.message);
    return false;
  }

  const newBalance = currentBalance + amount;

  if (data) {
    // UPDATE
    const { error: updateError } = await supabase
      .from("users")
      .update({ balance: newBalance })
      .eq("user_id", userIdStr);
    if (updateError) {
      console.error("❌ Update error:", updateError.message);
      return false;
    }
  } else {
    // INSERT
    const { error: insertError } = await supabase
      .from("users")
      .insert({ user_id: userIdStr, balance: newBalance });
    if (insertError) {
      console.error("❌ Insert error:", insertError.message);
      return false;
    }
  }

  console.log(`✅ Баланс обновлён до ${newBalance.toFixed(2)} для ${userIdStr}`);
  return true;
}

async function getBalance(userId) {
  const { data } = await supabase
    .from("users")
    .select("balance")
    .eq("user_id", userId.toString())
    .single();

  return data ? parseFloat(data.balance || 0) : 0;
}

// ===== CURRENCY CONFIG =====
const CURRENCIES = {
  BTC:  { emoji: "₿", name: "Bitcoin",        color: "#F7931A" },
  LTC:  { emoji: "Ł", name: "Litecoin",        color: "#BFBBBB" },
  ETH:  { emoji: "Ξ", name: "Ethereum",        color: "#627EEA" },
  USDT: { emoji: "₮", name: "Tether (TRC20)",  color: "#26A17B" },
  SOL:  { emoji: "◎", name: "Solana",          color: "#9945FF" }
};

// ===== CREATE PAYMENT =====
async function createPayment(userId, amount, currency) {
  const response = await axios.post(
    "https://api.nowpayments.io/v1/payment",
    {
      price_amount: amount,
      price_currency: "USD",
      pay_currency: currency,
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
  return response.data;
}

// ===== EMBEDS =====
function buildMainMenuEmbed() {
  return new EmbedBuilder()
    .setTitle("💳  Crypto Payment Bot")
    .setDescription(
      "```\nSecure · Fast · Anonymous\n```\n" +
      "Top up your balance using cryptocurrency.\n" +
      "Select an action below to get started."
    )
    .addFields({
      name: "📌 Commands",
      value: "`/pay` — Top up balance\n`/balance` — Check balance\n`/test <amount>` — [owner] Debug add balance",
      inline: false
    })
    .setColor(0x5865F2)
    .setFooter({ text: "Powered by NOWPayments • Secure crypto processing" })
    .setTimestamp();
}

function buildBalanceEmbed(userId, balance, tag) {
  return new EmbedBuilder()
    .setTitle("💳  Your Balance")
    .setDescription(`Account: **${tag}**`)
    .addFields(
      { name: "Available Balance", value: `**${balance.toFixed(2)} USD**`, inline: false },
      { name: "User ID", value: `\`${userId}\``, inline: true }
    )
    .setColor(0x57F287)
    .setFooter({ text: "Use /pay to top up your balance" })
    .setTimestamp();
}

function buildPaymentEmbed(payment, currency) {
  const cur = CURRENCIES[currency] || { emoji: "🪙", name: currency };
  return new EmbedBuilder()
    .setTitle(`${cur.emoji}  Payment Created — ${cur.name}`)
    .setDescription(
      "Send the **exact amount** to the address below.\n" +
      `⚠️ Send only **${currency}** to this address!`
    )
    .addFields(
      {
        name: "📬 Payment Address",
        value: payment.pay_address
          ? `\`\`\`\n${payment.pay_address}\n\`\`\``
          : "Address not available yet"
      },
      {
        name: "💰 Amount to Send",
        value: `**${payment.pay_amount} ${payment.pay_currency}**`,
        inline: true
      },
      {
        name: "💵 USD Equivalent",
        value: `**${payment.price_amount} USD**`,
        inline: true
      },
      {
        name: "⏰ Expires At",
        value: payment.expiration_estimate_date
          ? `<t:${Math.floor(new Date(payment.expiration_estimate_date).getTime() / 1000)}:R>`
          : "~20 minutes",
        inline: true
      },
      {
        name: "🔑 Payment ID",
        value: `\`${payment.payment_id}\``,
        inline: false
      }
    )
    .setColor(0xFEE75C)
    .setFooter({ text: "You will receive a DM when payment is confirmed" })
    .setTimestamp();
}

// ===== CURRENCY SELECT MENU =====
function buildCurrencyMenu(customId = "select_currency") {
  const options = Object.entries(CURRENCIES).map(([code, info]) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${info.name} (${code})`)
      .setDescription(`Pay with ${info.name}`)
      .setValue(code)
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("🪙  Select a cryptocurrency...")
    .addOptions(options);

  return new ActionRowBuilder().addComponents(menu);
}

// ===== AMOUNT BUTTONS =====
function buildAmountRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("amt_5").setLabel("$5").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("amt_10").setLabel("$10").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("amt_25").setLabel("$25").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("amt_50").setLabel("$50").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("amt_custom").setLabel("Custom amount").setStyle(ButtonStyle.Success)
  );
}

// ===== PENDING PAYMENTS =====
const pendingPayments = new Map();

// ===== MESSAGE COMMANDS =====
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const args = message.content.trim().split(/\s+/);
  const cmd = args[0].toLowerCase();

  if (cmd === "/help") {
    const embed = buildMainMenuEmbed();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("btn_pay").setLabel("💳  Top Up Balance").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("btn_balance").setLabel("💰  My Balance").setStyle(ButtonStyle.Primary)
    );
    await message.reply({ embeds: [embed], components: [row] });
  }

  if (cmd === "/pay") {
    const embed = new EmbedBuilder()
      .setTitle("💳  Top Up Balance")
      .setDescription("**Step 1 of 2:** Choose the cryptocurrency you want to pay with.")
      .setColor(0x5865F2);
    await message.reply({ embeds: [embed], components: [buildCurrencyMenu("pay_currency")] });
  }

  if (cmd === "/balance") {
    const balance = await getBalance(message.author.id);
    const embed = buildBalanceEmbed(message.author.id, balance, message.author.tag);
    await message.reply({ embeds: [embed] });
  }

  // ===== НОВАЯ ДЕБАГ-КОМАНДА /test =====
  if (cmd === "/test") {
    if (message.author.id !== OWNER_ID) {
      return message.reply("⛔ Только владелец бота может использовать эту команду.");
    }

    const amount = parseFloat(args[1]);
    if (isNaN(amount) || amount <= 0) {
      return message.reply("❌ Использование: `/test 10` (или любая сумма > 0)");
    }

    const success = await addBalance(message.author.id, amount);
    const newBalance = await getBalance(message.author.id);

    const embed = new EmbedBuilder()
      .setTitle("🧪 Debug: Test Balance Add")
      .setColor(success ? 0x57F287 : 0xED4245)
      .addFields(
        { name: "Добавлено", value: `**+${amount} USD**`, inline: true },
        { name: "Новый баланс", value: `**${newBalance.toFixed(2)} USD**`, inline: true }
      );

    if (!success) embed.setDescription("❌ Ошибка записи в базу. Смотри логи сервера.");
    await message.reply({ embeds: [embed] });
  }
});

// ===== INTERACTION HANDLER (оставлен без изменений) =====
client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === "btn_pay") {
      const embed = new EmbedBuilder()
        .setTitle("💳  Top Up Balance")
        .setDescription("**Step 1 of 2:** Choose the cryptocurrency you want to pay with.")
        .setColor(0x5865F2);
      await interaction.reply({ embeds: [embed], components: [buildCurrencyMenu("pay_currency")], ephemeral: true });
    }

    if (interaction.customId === "btn_balance") {
      const balance = await getBalance(interaction.user.id);
      const embed = buildBalanceEmbed(interaction.user.id, balance, interaction.user.tag);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.customId.startsWith("amt_")) {
      const userId = interaction.user.id;
      const pending = pendingPayments.get(userId);
      if (!pending) return interaction.reply({ content: "⚠️ Session expired. Use /pay again.", ephemeral: true });

      if (interaction.customId === "amt_custom") {
        const modal = new ModalBuilder()
          .setCustomId("modal_custom_amount")
          .setTitle("💵 Enter Custom Amount");
        const input = new TextInputBuilder()
          .setCustomId("custom_amount_input")
          .setLabel("Amount in USD (e.g. 15.50)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("1 — 1000")
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return await interaction.showModal(modal);
      }

      const amount = parseFloat(interaction.customId.replace("amt_", ""));
      pending.amount = amount;
      pendingPayments.set(userId, pending);

      await interaction.deferReply({ ephemeral: true });
      await processPayment(interaction, userId, amount, pending.currency);
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "pay_currency") {
    const currency = interaction.values[0];
    const userId = interaction.user.id;
    pendingPayments.set(userId, { currency, amount: null });

    const cur = CURRENCIES[currency];
    const embed = new EmbedBuilder()
      .setTitle(`${cur.emoji}  ${cur.name} Selected`)
      .setDescription("**Step 2 of 2:** Choose an amount to top up.")
      .setColor(0x5865F2);

    await interaction.update({ embeds: [embed], components: [buildAmountRow()] });
  }

  if (interaction.isModalSubmit() && interaction.customId === "modal_custom_amount") {
    const userId = interaction.user.id;
    const pending = pendingPayments.get(userId);
    if (!pending) return interaction.reply({ content: "⚠️ Session expired.", ephemeral: true });

    const rawAmount = interaction.fields.getTextInputValue("custom_amount_input");
    const amount = parseFloat(rawAmount);

    if (isNaN(amount) || amount < 1 || amount > 1000) {
      return interaction.reply({ content: "❌ Invalid amount (1-1000).", ephemeral: true });
    }

    pending.amount = amount;
    pendingPayments.set(userId, pending);

    await interaction.deferReply({ ephemeral: true });
    await processPayment(interaction, userId, amount, pending.currency);
  }
});

// ===== PROCESS PAYMENT =====
async function processPayment(interaction, userId, amount, currency) {
  try {
    const payment = await createPayment(userId, amount, currency);
    const embed = buildPaymentEmbed(payment, currency);

    try {
      const user = await client.users.fetch(userId);
      await user.send({ embeds: [embed] });
      await interaction.editReply({ content: "📬 Payment details sent to your DMs!", embeds: [], components: [] });
    } catch {
      await interaction.editReply({ content: "📋 Payment details (DMs disabled):", embeds: [embed], components: [] });
    }

    setTimeout(() => pendingPayments.delete(userId), 30 * 60 * 1000);
  } catch (err) {
    console.error("Payment creation error:", err.response?.data || err.message);
    await interaction.editReply({ content: "❌ Failed to create payment.", embeds: [], components: [] });
  }
}

// ===== IPN VERIFY =====
function verifyIPN(req) {
  const hmac = crypto
    .createHmac("sha512", IPN_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");
  return hmac === req.headers["x-nowpayments-sig"];
}

// ===== STATUS CONFIG =====
const STATUS_CONFIG = { /* оставлен без изменений */ 
  waiting: { color: 0xFEE75C, icon: "⏳", title: "Payment Waiting", desc: "..." },
  confirming: { color: 0x5865F2, icon: "🔄", title: "Confirming...", desc: "..." },
  confirmed: { color: 0x57F287, icon: "💚", title: "Payment Confirmed", desc: "..." },
  finished: { color: 0x57F287, icon: "✅", title: "Payment Complete!", desc: "Your balance has been topped up." },
  failed: { color: 0xED4245, icon: "❌", title: "Payment Failed", desc: "..." },
  expired: { color: 0x99AAB5, icon: "💀", title: "Payment Expired", desc: "..." }
};

// ===== WEB SERVER =====
const app = express();
app.use(express.json());

app.get("/", (_req, res) => res.send("✅ Bot is online"));

app.post("/webhook", async (req, res) => {
  console.log("📩 Webhook received:", req.body);

  if (!verifyIPN(req)) {
    console.warn("❌ Invalid IPN signature");
    return res.status(401).send("Invalid signature");
  }

  const { payment_status: status, order_id: userId, price_amount, pay_currency, payment_id } = req.body;
  const amount = parseFloat(price_amount || 0);

  console.log(`🔔 Webhook: status=${status}, userId=${userId}, amount=${amount}`);

  try {
    const cfg = STATUS_CONFIG[status];
    if (!cfg) return res.sendStatus(200);

    const embed = new EmbedBuilder()
      .setTitle(`${cfg.icon}  ${cfg.title}`)
      .setDescription(cfg.desc)
      .setColor(cfg.color)
      .setTimestamp();

    if (status === "finished") {
      const success = await addBalance(userId, amount);
      const newBalance = await getBalance(userId);

      embed.addFields(
        { name: "Amount Added", value: `**+${amount} USD**`, inline: true },
        { name: "New Balance", value: `**${newBalance.toFixed(2)} USD**`, inline: true }
      );

      if (!success) {
        embed.setColor(0xED4245)
             .setTitle("⚠️ Payment OK, but balance update FAILED")
             .setDescription("Проверь логи бота!");
      }
    } else if (["waiting", "confirming", "confirmed"].includes(status)) {
      embed.addFields(
        { name: "Amount", value: `**${amount} USD**`, inline: true },
        { name: "Currency", value: `**${pay_currency}**`, inline: true }
      );
    }

    embed.setFooter({ text: `Payment ID: ${payment_id}` });

    const user = await client.users.fetch(userId).catch(() => null);
    if (user) await user.send({ embeds: [embed] });
  } catch (err) {
    console.error("Webhook processing error:", err.message);
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`🌐 Webhook server running on port ${PORT}`));

client.login(DISCORD_TOKEN);
