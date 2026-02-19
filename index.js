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
  TextInputStyle,
  REST,
  Routes,
  ApplicationCommandOptionType,
  AttachmentBuilder
} from "discord.js";
import express from "express";
import axios from "axios";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// ===== ENV =====
const DISCORD_TOKEN       = process.env.DISCORD_TOKEN;
const CLIENT_ID           = process.env.CLIENT_ID;
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const IPN_SECRET          = process.env.IPN_SECRET;
const WEBHOOK_URL         = process.env.WEBHOOK_URL;
const PORT                = process.env.PORT || 3000;
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_KEY        = process.env.SUPABASE_KEY;
const OWNER_ID            = process.env.OWNER_ID;
const GUILD_ID            = process.env.GUILD_ID;

// ===== ROLE NAMES =====
const ROLE_ACCESS      = "Pay Access";
const ROLE_ACCESS_PLUS = "Pay Access+";
const ROLE_SCRIPTER    = "Scripter";

// ===== (ОПЦИОНАЛЬНО) ROLE IDs =====
const USE_ROLE_IDS        = false;
const ROLE_ID_ACCESS      = process.env.ROLE_ID_ACCESS || "";
const ROLE_ID_ACCESS_PLUS = process.env.ROLE_ID_ACCESS_PLUS || "";

// ===== SUPABASE =====
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== DISCORD BOT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

// ===== PUBLIC SLASH COMMANDS (видны всем, включая Scripter) =====
// Регистрируются ГЛОБАЛЬНО
const PUBLIC_COMMANDS = [
  {
    name: "pay",
    description: "💳 Top up your balance with cryptocurrency"
  },
  {
    name: "balance",
    description: "💰 Check your current balance"
  },
  {
    name: "buy",
    description: "🛒 Purchase products (Auto Joiner, Notifier, etc.)"
  },
  {
    name: "help",
    description: "📖 Show all available commands"
  }
];

// ===== STAFF SLASH COMMANDS (только Pay Access / Pay Access+) =====
// Регистрируются только для GUILD, скрыты от обычных пользователей
// default_member_permissions: "0" — скрыто от всех по умолчанию
// После деплоя зайди: Server Settings → Integrations → Бот → Manage
// и добавь роли Pay Access / Pay Access+ к каждой из этих команд
const STAFF_COMMANDS = [
  {
    name: "viewadmins",
    description: "🔍 [Owner] Debug — list all users with Pay Access / Pay Access+ roles",
    dm_permission: false,
    default_member_permissions: "0"
  },
  {
    name: "forceadd",
    description: "🔧 [Pay Access] Manually add balance to a user",
    dm_permission: false,
    default_member_permissions: "0",
    options: [
      {
        name: "user",
        description: "The user to add balance to",
        type: ApplicationCommandOptionType.User,
        required: true
      },
      {
        name: "amount",
        description: "Amount in USD to add (e.g. 25.00)",
        type: ApplicationCommandOptionType.Number,
        required: true,
        min_value: 0.01,
        max_value: 100000
      }
    ]
  },
  {
    name: "addkey",
    description: "🔑 [Pay Access] Add keys to a product",
    dm_permission: false,
    default_member_permissions: "0",
    options: [
      {
        name: "product",
        description: "Product to add keys for",
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: "Auto Joiner", value: "auto_joiner" },
          { name: "Notifier",    value: "notifier" }
        ]
      },
      {
        name: "tier",
        description: "Tier / duration (required for Auto Joiner)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        choices: [
          { name: "1 Day",  value: 1 },
          { name: "2 Days", value: 2 },
          { name: "3 Days", value: 3 }
        ]
      },
      {
        name: "keys",
        description: "Keys separated by spaces or newlines",
        type: ApplicationCommandOptionType.String,
        required: false
      },
      {
        name: "file",
        description: "Text file with keys (one per line)",
        type: ApplicationCommandOptionType.Attachment,
        required: false
      }
    ]
  },
  {
    name: "keylist",
    description: "📋 [Pay Access] View and manage available product keys",
    dm_permission: false,
    default_member_permissions: "0",
    options: [
      {
        name: "product",
        description: "Product to view keys for",
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: "Auto Joiner", value: "auto_joiner" },
          { name: "Notifier",    value: "notifier" }
        ]
      },
      {
        name: "tier",
        description: "Tier / duration (required for Auto Joiner)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        choices: [
          { name: "1 Day",  value: 1 },
          { name: "2 Days", value: 2 },
          { name: "3 Days", value: 3 }
        ]
      },
      {
        name: "page",
        description: "Page number (default: 1)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 1
      }
    ]
  }
];

// ===== REGISTER COMMANDS ON READY =====
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  try {
    console.log("🔄 Registering slash commands...");

    // 1. Регистрируем публичные команды ГЛОБАЛЬНО (pay, balance, buy, help)
    //    Они видны всем — включая Scripter
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: PUBLIC_COMMANDS }
    );
    console.log("✅ Public commands registered globally!");

    // 2. Регистрируем стафф-команды ТОЛЬКО для конкретного гильда
    //    default_member_permissions: "0" — скрыто от всех по умолчанию
    //    Затем вручную в Integrations добавь Pay Access / Pay Access+
    if (GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: STAFF_COMMANDS }
      );
      console.log(`✅ Staff commands registered for guild ${GUILD_ID}!`);
      console.log("⚠️  ВАЖНО: Зайди в Server Settings → Integrations → Бот → Manage");
      console.log("   и добавь роли 'Pay Access' / 'Pay Access+' к командам стаффа!");
    } else {
      console.warn("⚠️ GUILD_ID не задан — стафф-команды не зарегистрированы!");
    }

  } catch (err) {
    console.error("❌ Failed to register slash commands:", err);
  }

  client.user.setPresence({
    activities: [{ name: "💳 /pay  |  /buy  |  /balance", type: 0 }],
    status: "online"
  });
});

// ===== ROLE HELPERS =====

function normalizeRoleName(name) {
  return name.trim().toLowerCase();
}

function memberHasRole(member, roleName, roleId = "") {
  if (USE_ROLE_IDS && roleId) {
    return member.roles.cache.has(roleId);
  }
  const target = normalizeRoleName(roleName);
  return member.roles.cache.some(r => normalizeRoleName(r.name) === target);
}

/**
 * Проверяет, является ли пользователь Scripter (только публичные команды)
 */
async function isScripter(userId) {
  for (const [, guild] of client.guilds.cache) {
    let member;
    try {
      member = await guild.members.fetch({ user: userId, force: true });
    } catch {
      continue;
    }
    if (memberHasRole(member, ROLE_SCRIPTER)) return true;
  }
  return false;
}

async function getAccessTier(userId) {
  if (userId === OWNER_ID) return "plus";

  for (const [, guild] of client.guilds.cache) {
    let member;
    try {
      member = await guild.members.fetch({ user: userId, force: true });
    } catch {
      continue;
    }

    console.log(
      `[DEBUG getAccessTier] User ${userId} in "${guild.name}" has roles:`,
      member.roles.cache.map(r => `"${r.name}" (${r.id})`).join(", ") || "none"
    );

    if (memberHasRole(member, ROLE_ACCESS_PLUS, ROLE_ID_ACCESS_PLUS)) return "plus";
    if (memberHasRole(member, ROLE_ACCESS,      ROLE_ID_ACCESS))      return "basic";
  }

  return null;
}

async function getAccessPlusUsers() {
  const seen  = new Set();
  const users = [];

  for (const [, guild] of client.guilds.cache) {
    try {
      await guild.members.fetch({ force: true });
    } catch (e) {
      console.error(`❌ Could not fetch members for guild "${guild.name}":`, e.message);
      continue;
    }

    let role;
    if (USE_ROLE_IDS && ROLE_ID_ACCESS_PLUS) {
      role = guild.roles.cache.get(ROLE_ID_ACCESS_PLUS);
    } else {
      role = guild.roles.cache.find(
        r => normalizeRoleName(r.name) === normalizeRoleName(ROLE_ACCESS_PLUS)
      );
    }

    if (!role) {
      console.warn(`⚠️ Role "${ROLE_ACCESS_PLUS}" not found in guild "${guild.name}"`);
      continue;
    }

    for (const [, member] of role.members) {
      if (seen.has(member.id)) continue;
      seen.add(member.id);
      users.push(member.user);
    }
  }

  return users;
}

// ===== STAFF COMMAND ACCESS GUARD =====
/**
 * Проверяет доступ к стафф-командам.
 * Scripter → отказ (только публичные команды)
 * Pay Access / Pay Access+ → доступ
 */
async function checkStaffAccess(interaction) {
  const tier = await getAccessTier(interaction.user.id);

  if (!tier) {
    // Дополнительно проверяем — вдруг это Scripter пытается что-то сделать
    const scripter = await isScripter(interaction.user.id);
    const desc = scripter
      ? `У роли **${ROLE_SCRIPTER}** нет доступа к командам стаффа.\nДоступные тебе команды: \`/pay\`, \`/balance\`, \`/buy\`, \`/help\``
      : `Эта команда требует роль **${ROLE_ACCESS}** или **${ROLE_ACCESS_PLUS}**.`;

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("⛔  Access Denied")
          .setDescription(desc)
          .setColor(ERROR_COLOR)
          .setFooter({ text: FOOTER_TEXT })
      ]
    });
    return false;
  }

  return tier;
}

// ===== BALANCE HELPERS =====
async function addBalance(userId, amount) {
  console.log(`💰 addBalance: userId=${userId}, amount=${amount}`);
  const userIdStr = userId.toString();
  amount = parseFloat(amount);
  if (isNaN(amount) || amount <= 0) return false;

  const { data, error: selectError } = await supabase
    .from("users")
    .select("balance")
    .eq("user_id", userIdStr)
    .single();

  let currentBalance = 0;
  if (data) {
    currentBalance = parseFloat(data.balance || 0);
  } else if (selectError && selectError.code !== "PGRST116") {
    console.error("❌ Select error:", selectError.message);
    return false;
  }

  const newBalance = currentBalance + amount;

  if (data) {
    const { error } = await supabase.from("users").update({ balance: newBalance }).eq("user_id", userIdStr);
    if (error) { console.error("❌ Update error:", error.message); return false; }
  } else {
    const { error } = await supabase.from("users").insert({ user_id: userIdStr, balance: newBalance });
    if (error) { console.error("❌ Insert error:", error.message); return false; }
  }

  console.log(`✅ Balance updated to ${newBalance.toFixed(2)} for ${userIdStr}`);
  return true;
}

async function deductBalance(userId, amount) {
  console.log(`💸 deductBalance: userId=${userId}, amount=${amount}`);
  const userIdStr = userId.toString();
  amount = parseFloat(amount);

  const { data, error: selectError } = await supabase
    .from("users")
    .select("balance")
    .eq("user_id", userIdStr)
    .single();

  if (selectError && selectError.code !== "PGRST116") {
    console.error("❌ Deduct select error:", selectError.message);
    return false;
  }

  if (!data) {
    console.log("⚠️ User not found in database");
    return false;
  }

  const currentBalance = parseFloat(data.balance || 0);
  console.log(`📊 Current balance: ${currentBalance}, trying to deduct: ${amount}`);

  if (currentBalance < amount) {
    console.log("⚠️ Insufficient balance");
    return false;
  }

  const newBalance = currentBalance - amount;

  const { error } = await supabase
    .from("users")
    .update({ balance: newBalance })
    .eq("user_id", userIdStr);

  if (error) {
    console.error("❌ Deduct error:", error.message);
    return false;
  }

  console.log(`✅ Balance deducted. New balance: ${newBalance}`);
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

// ===== PAYMENT MESSAGE TRACKING =====
const paymentMessages = new Map();

async function savePaymentMessage(paymentId, userId, messageId, channelId) {
  paymentMessages.set(paymentId, { userId, messageId, channelId });
  console.log(`💾 Saved payment message: ${paymentId} -> msg ${messageId}`);
}

async function getPaymentMessage(paymentId) {
  return paymentMessages.get(paymentId);
}

// ===== KEY HELPERS =====

function resolveStorageId(productId, days = null) {
  if (productId === "auto_joiner" && days) return `${productId}_${days}`;
  return productId;
}

async function getAvailableKeyCount(storageId) {
  console.log(`🔍 Counting available keys for storageId: ${storageId}`);
  const { count, error } = await supabase
    .from("keys")
    .select("*", { count: "exact", head: true })
    .eq("product_id", storageId)
    .eq("is_used", false);

  if (error) {
    console.error("❌ Error counting keys:", error.message);
    return 0;
  }

  console.log(`📊 Available keys: ${count || 0}`);
  return count || 0;
}

async function getRandomAvailableKey(storageId) {
  console.log(`🔑 Getting random key for storageId: ${storageId}`);

  const { data, error } = await supabase
    .from("keys")
    .select("*")
    .eq("product_id", storageId)
    .eq("is_used", false)
    .limit(1);

  if (error) {
    console.error("❌ Error fetching key:", error.message);
    return null;
  }

  if (!data || data.length === 0) {
    console.log("⚠️ No available keys found");
    return null;
  }

  console.log(`✅ Found key: ${data[0].key_value.substring(0, 10)}...`);
  return data[0];
}

async function markKeyAsUsed(keyId, userId) {
  console.log(`🔒 Marking key ${keyId} as used by ${userId}`);
  const { error } = await supabase
    .from("keys")
    .update({
      is_used: true,
      used_by_user_id: userId.toString(),
      used_at: new Date().toISOString()
    })
    .eq("id", keyId);

  if (error) {
    console.error("❌ Error marking key as used:", error.message);
    return false;
  }

  console.log("✅ Key marked as used");
  return true;
}

async function addKeys(storageId, keys) {
  console.log(`➕ Adding ${keys.length} keys for storageId: ${storageId}`);
  const keyRecords = keys.map(key => ({
    product_id: storageId,
    key_value:  key.trim(),
    is_used:    false
  }));

  const { error } = await supabase.from("keys").insert(keyRecords);

  if (error) {
    console.error("❌ Error adding keys:", error.message);
    return false;
  }

  console.log("✅ Keys added successfully");
  return true;
}

async function getAvailableProductKeys(storageId, page = 1, perPage = 10) {
  console.log(`📋 Getting available keys for storageId: ${storageId}, page: ${page}`);
  const from = (page - 1) * perPage;
  const to   = from + perPage - 1;

  const { data, error, count } = await supabase
    .from("keys")
    .select("*", { count: "exact" })
    .eq("product_id", storageId)
    .eq("is_used", false)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    console.error("❌ Error getting keys:", error.message);
    return { keys: [], total: 0 };
  }

  console.log(`📊 Found ${count || 0} available keys, returning ${data?.length || 0} for this page`);
  return { keys: data || [], total: count || 0 };
}

async function deleteKey(keyId) {
  console.log(`🗑️ Deleting key: ${keyId}`);
  const { error } = await supabase
    .from("keys")
    .delete()
    .eq("id", keyId);

  if (error) {
    console.error("❌ Error deleting key:", error.message);
    return false;
  }

  console.log("✅ Key deleted");
  return true;
}

// ===== PRODUCT CONFIG =====
const PRODUCTS = {
  auto_joiner: {
    id:          "auto_joiner",
    name:        "Auto Joiner",
    emoji:       "🤖",
    description: "Automatically join rich servers",
    tiers: [
      { days: 1, price: 30, originalPrice: 60 },
      { days: 2, price: 50, originalPrice: 80 },
      { days: 3, price: 70, originalPrice: 100 }
    ]
  },
  notifier: {
    id:          "notifier",
    name:        "Notifier",
    emoji:       "🔔",
    description: "Get brainrot logs",
    comingSoon:  true
  }
};

// ===== CURRENCY CONFIG =====
const CURRENCIES = {
  BTC:  { emoji: "₿", name: "Bitcoin",       color: 0xF7931A },
  LTC:  { emoji: "Ł", name: "Litecoin",       color: 0xBFBBBB },
  ETH:  { emoji: "Ξ", name: "Ethereum",       color: 0x627EEA },
  USDT: { emoji: "₮", name: "Tether (TRC20)", color: 0x26A17B },
  SOL:  { emoji: "◎", name: "Solana",         color: 0x9945FF }
};

// ===== FUNPAY RESELLERS =====
const FUNPAY_RESELLERS = [
  { name: "ilyasika", url: "https://funpay.com/lots/offer?id=55896359" },
  { name: "ver0n",    url: "https://funpay.com/lots/offer?id=55551861" }
];

// ===== CREATE PAYMENT =====
async function createPayment(userId, amount, currency) {
  const response = await axios.post(
    "https://api.nowpayments.io/v1/payment",
    {
      price_amount:     amount,
      price_currency:   "USD",
      pay_currency:     currency,
      order_id:         userId,
      ipn_callback_url: WEBHOOK_URL
    },
    { headers: { "x-api-key": NOWPAYMENTS_API_KEY, "Content-Type": "application/json" } }
  );
  return response.data;
}

// ===== DESIGN CONSTANTS =====
const BRAND_COLOR   = 0x5865F2;
const SUCCESS_COLOR = 0x2ECC71;
const WARNING_COLOR = 0xF1C40F;
const ERROR_COLOR   = 0xE74C3C;
const NEUTRAL_COLOR = 0x99AAB5;
const ADMIN_COLOR   = 0xE67E22;
const PLUS_COLOR    = 0xA855F7;
const FUNPAY_COLOR  = 0xFF6B35;

const FOOTER_TEXT = "⚡ Nameless Paysystem";

// ===== EMBEDS =====
function buildMainMenuEmbed() {
  return new EmbedBuilder()
    .setTitle("🏦  Nameless Paysystem")
    .setDescription(
      "**Secure · Instant · Anonymous**\n" +
      "> Top up your balance using cryptocurrency"
    )
    .addFields(
      {
        name:   "💳  Payments",
        value:  "`/pay` — Start a crypto top-up\n`/balance` — Check your balance\n`/buy` — Purchase products",
        inline: true
      },
      {
        name:   "🔧  Staff",
        value:  "`/forceadd` — Add balance to a user\n`/addkey` — Add product keys\n`/keylist` — Manage keys",
        inline: true
      },
      {
        name:   "🪙  Supported Currencies",
        value:  Object.entries(CURRENCIES)
          .map(([code, c]) => `${c.emoji} **${code}** — ${c.name}`)
          .join("\n"),
        inline: false
      },
      {
        name:   "🔑  Access Roles",
        value:
          `**${ROLE_ACCESS}** — Can use \`/forceadd\`, \`/addkey\`, \`/keylist\`\n` +
          `**${ROLE_ACCESS_PLUS}** — All above + receives payment notifications\n` +
          `**${ROLE_SCRIPTER}** — Can use \`/pay\`, \`/balance\`, \`/buy\`, \`/help\``,
        inline: false
      }
    )
    .setColor(BRAND_COLOR)
    .setFooter({ text: FOOTER_TEXT })
    .setTimestamp();
}

function buildBalanceEmbed(userId, balance, username) {
  const tier =
    balance >= 500 ? "💎 VIP"
    : balance >= 100 ? "🥇 Gold"
    : balance >= 25  ? "🥈 Silver"
    : "🥉 Bronze";

  return new EmbedBuilder()
    .setTitle("💰  Wallet Balance")
    .setDescription(`Account **@${username}** • ${tier}`)
    .addFields(
      { name: "📊 Available Balance", value: `## \`${balance.toFixed(2)} USD\``, inline: false },
      { name: "🆔 User ID",           value: `\`${userId}\``,                    inline: true  },
      { name: "💡 Top Up",            value: "Use `/pay` to add funds",           inline: true  }
    )
    .setColor(balance > 0 ? SUCCESS_COLOR : NEUTRAL_COLOR)
    .setFooter({ text: FOOTER_TEXT })
    .setTimestamp();
}

async function buildShopEmbed() {
  const embed = new EmbedBuilder()
    .setTitle("🛒  Product Shop")
    .setDescription("Select a product to view pricing and purchase options.")
    .setColor(BRAND_COLOR)
    .setFooter({ text: FOOTER_TEXT })
    .setTimestamp();

  for (const [, product] of Object.entries(PRODUCTS)) {
    if (product.comingSoon) {
      embed.addFields({
        name:   `${product.emoji}  ${product.name}`,
        value:  `${product.description}\n\`🔜 Coming Soon\``,
        inline: false
      });
    } else {
      const tierInfo = await Promise.all(
        product.tiers.map(async t => {
          const stock = await getAvailableKeyCount(resolveStorageId(product.id, t.days));
          return (
            `**${t.days} day${t.days > 1 ? "s" : ""}** — ~~$${t.originalPrice}~~ **$${t.price}** 🔥  📦 \`${stock}\` in stock`
          );
        })
      );

      embed.addFields({
        name:   `${product.emoji}  ${product.name}`,
        value:  `${product.description}\n${tierInfo.join("\n")}`,
        inline: false
      });
    }
  }

  return embed;
}

function buildFunPayEmbed() {
  const resellersText = FUNPAY_RESELLERS
    .map((r, i) => `**${i + 1}. ${r.name}**\n🔗 ${r.url}`)
    .join("\n\n");

  return new EmbedBuilder()
    .setTitle("🎮  Purchase via FunPay")
    .setDescription(
      "**Our Official Resellers:**\n\n" +
      resellersText + "\n\n" +
      "**📝 How to Purchase:**\n" +
      "> 1️⃣ Click on a reseller link above\n" +
      "> 2️⃣ Select the product you want\n" +
      "> 3️⃣ Complete the purchase on FunPay\n" +
      "> 4️⃣ Receive your key from the reseller\n\n" +
      "⚠️ **Note:** Purchases through FunPay are handled by the resellers. " +
      "Contact them directly for support."
    )
    .setColor(FUNPAY_COLOR)
    .setFooter({ text: FOOTER_TEXT })
    .setTimestamp();
}

function buildPaymentEmbed(payment, currency, status = "waiting") {
  const cur = CURRENCIES[currency] || { emoji: "🪙", name: currency, color: BRAND_COLOR };
  const cfg = STATUS_CONFIG[status];

  const embed = new EmbedBuilder()
    .setTitle(`${cfg.icon}  ${cfg.title} — ${cur.emoji} ${cur.name}`)
    .setDescription(cfg.desc)
    .setColor(cfg.color)
    .setFooter({ text: `Payment ID: ${payment.payment_id} • ${FOOTER_TEXT}` })
    .setTimestamp();

  if (status === "waiting") {
    embed.addFields(
      {
        name:  "📬  Deposit Address",
        value: payment.pay_address
          ? `\`${payment.pay_address}\``
          : "`Address pending...`"
      },
      { name: "💸  Amount",    value: `\`${payment.pay_amount} ${payment.pay_currency}\``, inline: true },
      { name: "💵  USD Value", value: `\`${payment.price_amount} USD\``,                   inline: true },
      {
        name:  "⏱️  Expires",
        value: payment.expiration_estimate_date
          ? `<t:${Math.floor(new Date(payment.expiration_estimate_date).getTime() / 1000)}:R>`
          : "`~20 minutes`",
        inline: true
      }
    );
  } else if (["confirming", "confirmed"].includes(status)) {
    embed.addFields(
      { name: "💵  Amount",   value: `\`${payment.price_amount} USD\``, inline: true },
      { name: "🪙  Currency", value: `\`${payment.pay_currency}\``,     inline: true }
    );
  }

  return embed;
}

function buildForceAddEmbed(targetUser, amount, newBalance, executedBy) {
  return new EmbedBuilder()
    .setTitle("🔧  Manual Balance Credit")
    .setDescription(`Balance credited to **@${targetUser.username}** by **@${executedBy.username}**`)
    .addFields(
      { name: "➕  Amount Added", value: `\`+${amount.toFixed(2)} USD\``,             inline: true  },
      { name: "💰  New Balance",  value: `\`${newBalance.toFixed(2)} USD\``,           inline: true  },
      { name: "🎯  Target User",  value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: false }
    )
    .setColor(ADMIN_COLOR)
    .setFooter({ text: `Executed by ${executedBy.tag} • ${FOOTER_TEXT}` })
    .setTimestamp();
}

function buildPaymentNotifyEmbed(payerUser, amount, newBalance, paymentId) {
  return new EmbedBuilder()
    .setTitle("🔔  Payment Notification")
    .setDescription(
      `A user has successfully completed a payment.\n` +
      `> Sent to all **${ROLE_ACCESS_PLUS}** members.`
    )
    .addFields(
      { name: "👤  User",          value: `<@${payerUser.id}> (\`${payerUser.tag}\`)`, inline: false },
      { name: "💵  Amount Paid",   value: `\`${amount.toFixed(2)} USD\``,              inline: true  },
      { name: "💰  Their Balance", value: `\`${newBalance.toFixed(2)} USD\``,          inline: true  },
      { name: "🔑  Payment ID",    value: `\`${paymentId}\``,                          inline: false }
    )
    .setColor(PLUS_COLOR)
    .setFooter({ text: `${ROLE_ACCESS_PLUS} Alert • ${FOOTER_TEXT}` })
    .setTimestamp();
}

// ===== STATUS CONFIG =====
const STATUS_CONFIG = {
  waiting: {
    color: WARNING_COLOR, icon: "⏳", title: "Awaiting Payment",
    desc: "> Send the exact amount below to complete your top-up."
  },
  confirming: {
    color: BRAND_COLOR, icon: "🔄", title: "Confirming Transaction",
    desc: "> Your payment has been detected and is being confirmed on the network."
  },
  confirmed: {
    color: 0x1ABC9C, icon: "💚", title: "Transaction Confirmed",
    desc: "> Payment confirmed! Waiting for final processing..."
  },
  finished: {
    color: SUCCESS_COLOR, icon: "✅", title: "Payment Complete!",
    desc: "> Your balance has been successfully topped up. Enjoy!"
  },
  failed: {
    color: ERROR_COLOR, icon: "❌", title: "Payment Failed",
    desc: "> Your payment could not be processed. Please try again with `/pay`."
  },
  expired: {
    color: NEUTRAL_COLOR, icon: "💀", title: "Payment Expired",
    desc: "> This invoice has expired. Please create a new payment with `/pay`."
  }
};

// ===== UI BUILDERS =====
function buildPaymentMethodMenu() {
  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel("💰 Pay with Balance")
      .setDescription("Use your account balance")
      .setValue("balance")
      .setEmoji("💳"),
    new StringSelectMenuOptionBuilder()
      .setLabel("🎮 Pay via FunPay")
      .setDescription("Purchase from our resellers")
      .setValue("funpay")
      .setEmoji("🛒")
  ];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("select_payment_method")
      .setPlaceholder("💳  Choose payment method...")
      .addOptions(options)
  );
}

function buildCurrencyMenu(customId = "select_currency") {
  const options = Object.entries(CURRENCIES).map(([code, info]) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${info.name} (${code})`)
      .setDescription(`Pay with ${info.name}`)
      .setValue(code)
  );

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("🪙  Select a cryptocurrency...")
      .addOptions(options)
  );
}

function buildProductMenu() {
  const options = Object.entries(PRODUCTS).map(([id, product]) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(product.name)
      .setDescription(product.comingSoon ? "Coming Soon" : product.description)
      .setValue(id)
      .setEmoji(product.emoji)
  );

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("select_product")
      .setPlaceholder("🛒  Select a product...")
      .addOptions(options)
  );
}

function buildTierButtons(productId) {
  const product = PRODUCTS[productId];
  if (!product || product.comingSoon) return null;

  const buttons = product.tiers.map(tier =>
    new ButtonBuilder()
      .setCustomId(`buy_${productId}_${tier.days}`)
      .setLabel(`${tier.days} Day${tier.days > 1 ? "s" : ""} - $${tier.price}`)
      .setStyle(ButtonStyle.Success)
      .setEmoji("💳")
  );

  return new ActionRowBuilder().addComponents(...buttons);
}

function buildAmountRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("amt_5").setLabel("$5").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("amt_10").setLabel("$10").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("amt_25").setLabel("$25").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("amt_50").setLabel("$50").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("amt_custom").setLabel("✏️ Custom").setStyle(ButtonStyle.Success)
  );
}

function buildKeyListButtons(page, totalPages, storageId) {
  const buttons = [];

  if (page > 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`keylist_${storageId}_${page - 1}`)
        .setLabel("◀️ Previous")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`keylist_refresh_${storageId}_${page}`)
      .setLabel("🔄 Refresh")
      .setStyle(ButtonStyle.Primary)
  );

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`keylist_delete_${storageId}_${page}`)
      .setLabel("🗑️ Delete Key")
      .setStyle(ButtonStyle.Danger)
  );

  if (page < totalPages) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`keylist_${storageId}_${page + 1}`)
        .setLabel("Next ▶️")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return new ActionRowBuilder().addComponents(...buttons);
}

// ===== PENDING PAYMENTS =====
const pendingPayments = new Map();

// ===== INTERACTION HANDLER =====
client.on("interactionCreate", async (interaction) => {

  // ──────────── SLASH COMMANDS ────────────
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    // /help
    if (commandName === "help") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("btn_pay").setLabel("💳  Top Up").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("btn_balance").setLabel("💰  Balance").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("btn_buy").setLabel("🛒  Shop").setStyle(ButtonStyle.Success)
      );
      return interaction.reply({ embeds: [buildMainMenuEmbed()], components: [row], ephemeral: true });
    }

    // /balance
    if (commandName === "balance") {
      const balance = await getBalance(interaction.user.id);
      return interaction.reply({
        embeds: [buildBalanceEmbed(interaction.user.id, balance, interaction.user.username)],
        ephemeral: true
      });
    }

    // /buy
    if (commandName === "buy") {
      const embed = new EmbedBuilder()
        .setTitle("🛒  Purchase Products")
        .setDescription(
          "**Step 1 / 2** — Choose your payment method.\n\n" +
          "💰 **Balance** — Use your account balance (instant delivery)\n" +
          "🎮 **FunPay** — Purchase from our trusted resellers"
        )
        .setColor(BRAND_COLOR)
        .setFooter({ text: FOOTER_TEXT })
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
        components: [buildPaymentMethodMenu()],
        ephemeral: true
      });
    }

    // /pay
    if (commandName === "pay") {
      const embed = new EmbedBuilder()
        .setTitle("💳  Top Up Balance")
        .setDescription("**Step 1 / 2** — Choose the cryptocurrency you'd like to pay with.")
        .setColor(BRAND_COLOR)
        .setFooter({ text: FOOTER_TEXT });
      return interaction.reply({
        embeds: [embed],
        components: [buildCurrencyMenu("pay_currency")],
        ephemeral: true
      });
    }

    // ── STAFF COMMANDS ──
    // Все они требуют Pay Access / Pay Access+
    // Scripter получает ошибку с объяснением

    // /addkey
    if (commandName === "addkey") {
      await interaction.deferReply({ ephemeral: true });

      const tier = await checkStaffAccess(interaction);
      if (!tier) return;

      const productId  = interaction.options.getString("product");
      const tierDays   = interaction.options.getInteger("tier");
      const keysText   = interaction.options.getString("keys");
      const file       = interaction.options.getAttachment("file");

      if (productId === "auto_joiner" && !tierDays) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Tier Required")
              .setDescription(
                "**Auto Joiner** has separate key pools per duration.\n" +
                "Please specify the `tier` option: **1 Day**, **2 Days**, or **3 Days**."
              )
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const storageId = resolveStorageId(productId, tierDays);

      let keys = [];

      if (keysText) {
        keys = keysText.split(/[\s\n]+/).filter(k => k.trim().length > 0);
      } else if (file) {
        try {
          const response    = await axios.get(file.url);
          const fileContent = response.data;
          keys = fileContent.split(/[\s\n]+/).filter(k => k.trim().length > 0);
        } catch (err) {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("❌  File Error")
                .setDescription("Could not read the file. Make sure it's a text file.")
                .setColor(ERROR_COLOR)
                .setFooter({ text: FOOTER_TEXT })
            ]
          });
        }
      } else {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Invalid Input")
              .setDescription("Please provide either keys as text or upload a file.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      if (keys.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  No Keys Found")
              .setDescription("No valid keys were found in your input.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const success = await addKeys(storageId, keys);

      if (!success) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Database Error")
              .setDescription("Failed to add keys. Check server logs.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const product  = PRODUCTS[productId];
      const newStock = await getAvailableKeyCount(storageId);
      const tierLabel = tierDays ? ` (${tierDays} Day${tierDays > 1 ? "s" : ""})` : "";

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅  Keys Added Successfully")
            .setDescription(`Added **${keys.length}** keys to **${product.name}${tierLabel}**`)
            .addFields(
              { name: "📦 New Stock", value: `\`${newStock}\` keys available`, inline: true },
              { name: "➕ Added By",  value: `<@${interaction.user.id}>`,       inline: true }
            )
            .setColor(SUCCESS_COLOR)
            .setFooter({ text: FOOTER_TEXT })
            .setTimestamp()
        ]
      });
    }

    // /keylist
    if (commandName === "keylist") {
      await interaction.deferReply({ ephemeral: true });

      const accessTier = await checkStaffAccess(interaction);
      if (!accessTier) return;

      const productId = interaction.options.getString("product");
      const tierDays  = interaction.options.getInteger("tier");
      const page      = interaction.options.getInteger("page") || 1;
      const perPage   = 10;

      if (productId === "auto_joiner" && !tierDays) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Tier Required")
              .setDescription(
                "**Auto Joiner** has separate key pools per duration.\n" +
                "Please specify the `tier` option: **1 Day**, **2 Days**, or **3 Days**."
              )
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const storageId = resolveStorageId(productId, tierDays);
      return sendKeyListEmbed(interaction, storageId, productId, tierDays, page, perPage);
    }

    // /viewadmins
    if (commandName === "viewadmins") {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⛔  Access Denied")
              .setDescription("This debug command is restricted to the **bot owner** only.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ],
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const basicUsers = [];
      const plusUsers  = [];
      const seen       = new Set();

      for (const [, guild] of client.guilds.cache) {
        try {
          await guild.members.fetch({ force: true });
        } catch (e) {
          console.error(`❌ Could not fetch members for guild "${guild.name}":`, e.message);
          continue;
        }

        let roleBasic, rolePlus;

        if (USE_ROLE_IDS) {
          roleBasic = ROLE_ID_ACCESS      ? guild.roles.cache.get(ROLE_ID_ACCESS)      : null;
          rolePlus  = ROLE_ID_ACCESS_PLUS ? guild.roles.cache.get(ROLE_ID_ACCESS_PLUS) : null;
        } else {
          roleBasic = guild.roles.cache.find(
            r => normalizeRoleName(r.name) === normalizeRoleName(ROLE_ACCESS)
          );
          rolePlus = guild.roles.cache.find(
            r => normalizeRoleName(r.name) === normalizeRoleName(ROLE_ACCESS_PLUS)
          );
        }

        if (rolePlus) {
          for (const [, member] of rolePlus.members) {
            if (seen.has(member.id)) continue;
            seen.add(member.id);
            plusUsers.push({ tag: member.user.tag, id: member.id, guild: guild.name });
          }
        }

        if (roleBasic) {
          for (const [, member] of roleBasic.members) {
            if (seen.has(member.id)) continue;
            seen.add(member.id);
            basicUsers.push({ tag: member.user.tag, id: member.id, guild: guild.name });
          }
        }
      }

      const formatList = (arr) =>
        arr.length > 0
          ? arr.map(u => `<@${u.id}> — \`${u.tag}\` • server: ${u.guild}`).join("\n")
          : "`— None found —`";

      const embed = new EmbedBuilder()
        .setTitle("🔍  Debug — Access Role Members")
        .setDescription(
          `Scanned **${client.guilds.cache.size}** guild(s).\n` +
          `Total found: **${basicUsers.length + plusUsers.length}** user(s).`
        )
        .addFields(
          {
            name:   `🔑  ${ROLE_ACCESS} (${basicUsers.length})`,
            value:  formatList(basicUsers),
            inline: false
          },
          {
            name:   `👑  ${ROLE_ACCESS_PLUS} (${plusUsers.length})`,
            value:  formatList(plusUsers),
            inline: false
          }
        )
        .setColor(0x3498DB)
        .setFooter({ text: `Owner debug • ${FOOTER_TEXT}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // /forceadd
    if (commandName === "forceadd") {
      await interaction.deferReply({ ephemeral: true });

      const accessTierLevel = await checkStaffAccess(interaction);
      if (!accessTierLevel) return;

      const targetUser = interaction.options.getUser("user");
      const amount     = interaction.options.getNumber("amount");

      if (targetUser.bot) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Invalid Target")
              .setDescription("You cannot add balance to a bot account.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const success    = await addBalance(targetUser.id, amount);
      const newBalance = await getBalance(targetUser.id);

      if (!success) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Database Error")
              .setDescription("Failed to update balance. Check server logs.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      await interaction.editReply({
        embeds: [buildForceAddEmbed(targetUser, amount, newBalance, interaction.user)]
      });

      try {
        const dmEmbed = new EmbedBuilder()
          .setTitle("🎉  Balance Added!")
          .setDescription(`An administrator has added **${amount.toFixed(2)} USD** to your account.`)
          .addFields(
            { name: "➕ Added",       value: `\`+${amount.toFixed(2)} USD\``,    inline: true },
            { name: "💰 New Balance", value: `\`${newBalance.toFixed(2)} USD\``, inline: true }
          )
          .setColor(SUCCESS_COLOR)
          .setFooter({ text: FOOTER_TEXT })
          .setTimestamp();
        await targetUser.send({ embeds: [dmEmbed] });
      } catch {
        console.log(`⚠️ Could not DM ${targetUser.tag} — DMs likely disabled`);
      }

      return;
    }
  }

  // ──────────── BUTTONS ────────────
  if (interaction.isButton()) {
    if (interaction.customId === "btn_pay") {
      const embed = new EmbedBuilder()
        .setTitle("💳  Top Up Balance")
        .setDescription("**Step 1 / 2** — Choose the cryptocurrency you'd like to pay with.")
        .setColor(BRAND_COLOR)
        .setFooter({ text: FOOTER_TEXT });
      return interaction.reply({
        embeds: [embed],
        components: [buildCurrencyMenu("pay_currency")],
        ephemeral: true
      });
    }

    if (interaction.customId === "btn_balance") {
      const balance = await getBalance(interaction.user.id);
      return interaction.reply({
        embeds: [buildBalanceEmbed(interaction.user.id, balance, interaction.user.username)],
        ephemeral: true
      });
    }

    if (interaction.customId === "btn_buy") {
      const embed = new EmbedBuilder()
        .setTitle("🛒  Purchase Products")
        .setDescription(
          "**Step 1 / 2** — Choose your payment method.\n\n" +
          "💰 **Balance** — Use your account balance (instant delivery)\n" +
          "🎮 **FunPay** — Purchase from our trusted resellers"
        )
        .setColor(BRAND_COLOR)
        .setFooter({ text: FOOTER_TEXT })
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
        components: [buildPaymentMethodMenu()],
        ephemeral: true
      });
    }

    // buy_<productId>_<days>
    if (interaction.customId.startsWith("buy_")) {
      console.log(`🛒 Purchase initiated by ${interaction.user.tag}: ${interaction.customId}`);
      await interaction.deferReply({ ephemeral: true });

      try {
        const withoutPrefix  = interaction.customId.slice("buy_".length);
        const lastUnderscore = withoutPrefix.lastIndexOf("_");
        const productId      = withoutPrefix.substring(0, lastUnderscore);
        const days           = parseInt(withoutPrefix.substring(lastUnderscore + 1));

        console.log(`📦 Parsed → productId: "${productId}", days: ${days}`);

        const product = PRODUCTS[productId];

        if (!product) {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("❌  Product Not Found")
                .setDescription(`Unknown product: \`${productId}\``)
                .setColor(ERROR_COLOR)
                .setFooter({ text: FOOTER_TEXT })
            ]
          });
        }

        const tier = product.tiers.find(t => t.days === days);

        if (!tier) {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("❌  Tier Not Found")
                .setDescription(`No tier found for \`${days}\` day(s) in **${product.name}**.`)
                .setColor(ERROR_COLOR)
                .setFooter({ text: FOOTER_TEXT })
            ]
          });
        }

        const balance = await getBalance(interaction.user.id);
        console.log(`💰 User balance: ${balance}, Required: ${tier.price}`);

        if (balance < tier.price) {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("💰  Insufficient Balance")
                .setDescription(
                  `You need **$${tier.price.toFixed(2)}** but only have **$${balance.toFixed(2)}**.\n` +
                  `Missing: **$${(tier.price - balance).toFixed(2)}**\n\n` +
                  `Use \`/pay\` to top up your balance.`
                )
                .setColor(ERROR_COLOR)
                .setFooter({ text: FOOTER_TEXT })
            ]
          });
        }

        const storageId = resolveStorageId(productId, days);
        const key = await getRandomAvailableKey(storageId);

        if (!key) {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("📦  Out of Stock")
                .setDescription(
                  `**${product.name}** (${days} day${days > 1 ? "s" : ""}) is currently out of stock. Please check back later.`
                )
                .setColor(WARNING_COLOR)
                .setFooter({ text: FOOTER_TEXT })
            ]
          });
        }

        const deducted = await deductBalance(interaction.user.id, tier.price);
        if (!deducted) {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("❌  Payment Failed")
                .setDescription("Could not process payment. Please try again.")
                .setColor(ERROR_COLOR)
                .setFooter({ text: FOOTER_TEXT })
            ]
          });
        }

        await markKeyAsUsed(key.id, interaction.user.id);

        const newBalance = await getBalance(interaction.user.id);
        const stock      = await getAvailableKeyCount(storageId);

        console.log(`✅ Purchase successful! New balance: ${newBalance}, Remaining stock: ${stock}`);

        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("✅  Purchase Successful!")
              .setDescription(`You've purchased **${product.name}** — ${tier.days} day${tier.days > 1 ? "s" : ""}`)
              .addFields(
                { name: "💵 Price",          value: `\`$${tier.price}\``,            inline: true },
                { name: "💰 New Balance",     value: `\`$${newBalance.toFixed(2)}\``, inline: true },
                { name: "📦 Remaining Stock", value: `\`${stock} keys\``,             inline: true }
              )
              .setColor(SUCCESS_COLOR)
              .setFooter({ text: "Your key has been sent to your DMs • " + FOOTER_TEXT })
              .setTimestamp()
          ]
        });

        try {
          const keyFileContent =
            `${product.name} License Key\n` +
            `========================\n\n` +
            `Product: ${product.name}\n` +
            `Duration: ${tier.days} day${tier.days > 1 ? "s" : ""}\n` +
            `Price: $${tier.price}\n` +
            `Purchase Date: ${new Date().toISOString()}\n\n` +
            `License Key:\n${key.key_value}\n\n` +
            `========================\n` +
            `Keep this key safe and secure.\n`;

          const keyAttachment = new AttachmentBuilder(
            Buffer.from(keyFileContent, "utf-8"),
            { name: `${product.name.replace(/\s+/g, "_")}_Key_${Date.now()}.txt` }
          );

          await interaction.user.send({
            embeds: [
              new EmbedBuilder()
                .setTitle(`🔑  ${product.name} Key`)
                .setDescription(`Your **${tier.days} day${tier.days > 1 ? "s" : ""}** license key:`)
                .addFields(
                  { name: "🔐 License Key", value: `\`${key.key_value}\``,                              inline: false },
                  { name: "⏱️ Duration",    value: `\`${tier.days} day${tier.days > 1 ? "s" : ""}\``,  inline: true  },
                  { name: "💵 Price",       value: `\`$${tier.price}\``,                                inline: true  }
                )
                .setColor(SUCCESS_COLOR)
                .setFooter({ text: FOOTER_TEXT })
                .setTimestamp()
            ],
            files: [keyAttachment]
          });
          console.log(`📬 Key sent to ${interaction.user.tag}`);
        } catch (dmErr) {
          console.log(`⚠️ Could not DM key to ${interaction.user.tag}:`, dmErr.message);
        }

      } catch (err) {
        console.error("❌ Buy handler error:", err);
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Unexpected Error")
              .setDescription(`\`${err.message}\`\nPlease contact support.`)
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        }).catch(() => {});
      }

      return;
    }

    // keylist_delete_<storageId>_<page>
    if (interaction.customId.startsWith("keylist_delete_")) {
      const withoutPrefix  = interaction.customId.slice("keylist_delete_".length);
      const lastUnderscore = withoutPrefix.lastIndexOf("_");
      const storageId      = withoutPrefix.substring(0, lastUnderscore);
      const page           = withoutPrefix.substring(lastUnderscore + 1);

      const modal = new ModalBuilder()
        .setCustomId(`modal_delete_key_${storageId}_${page}`)
        .setTitle("🗑️ Delete Key by Number");

      const input = new TextInputBuilder()
        .setCustomId("delete_key_number")
        .setLabel("Key number to delete (from the list above)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. 3")
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    // keylist pagination / refresh
    if (interaction.customId.startsWith("keylist_")) {
      await interaction.deferUpdate();

      const withoutPrefix = interaction.customId.slice("keylist_".length);
      const isRefresh     = withoutPrefix.startsWith("refresh_");

      let rest;
      if (isRefresh) {
        rest = withoutPrefix.slice("refresh_".length);
      } else {
        rest = withoutPrefix;
      }

      const lastUnderscore = rest.lastIndexOf("_");
      const storageId      = rest.substring(0, lastUnderscore);
      const page           = parseInt(rest.substring(lastUnderscore + 1));
      const perPage        = 10;

      const { productId, tierDays } = parseStorageId(storageId);
      return sendKeyListEdit(interaction, storageId, productId, tierDays, page, perPage);
    }

    // amount buttons
    if (interaction.customId.startsWith("amt_")) {
      const userId  = interaction.user.id;
      const pending = pendingPayments.get(userId);
      if (!pending) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⚠️  Session Expired")
              .setDescription("Your session has timed out. Please start again with `/pay`.")
              .setColor(WARNING_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ],
          ephemeral: true
        });
      }

      if (interaction.customId === "amt_custom") {
        const modal = new ModalBuilder()
          .setCustomId("modal_custom_amount")
          .setTitle("💵 Enter Custom Amount");
        const input = new TextInputBuilder()
          .setCustomId("custom_amount_input")
          .setLabel("Amount in USD (e.g. 15.50)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Enter amount: 1 — 1000")
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      const amount   = parseFloat(interaction.customId.replace("amt_", ""));
      pending.amount = amount;
      pendingPayments.set(userId, pending);

      await interaction.deferReply({ ephemeral: true });
      await processPayment(interaction, userId, amount, pending.currency);
    }
  }

  // ──────────── SELECT MENUS ────────────
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "select_payment_method") {
      const method = interaction.values[0];

      if (method === "funpay") {
        const backButton = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("btn_buy")
            .setLabel("◀️ Back to Payment Methods")
            .setStyle(ButtonStyle.Secondary)
        );
        return interaction.update({
          embeds: [buildFunPayEmbed()],
          components: [backButton]
        });
      }

      if (method === "balance") {
        const embed = await buildShopEmbed();
        return interaction.update({
          embeds: [embed],
          components: [buildProductMenu()]
        });
      }
    }

    if (interaction.customId === "select_product") {
      const productId = interaction.values[0];
      const product   = PRODUCTS[productId];

      if (product.comingSoon) {
        return interaction.update({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${product.emoji}  ${product.name}`)
              .setDescription(
                `${product.description}\n\n🔜 **Coming Soon**\n\nThis product is currently under development.`
              )
              .setColor(WARNING_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ],
          components: []
        });
      }

      const tierInfo = await Promise.all(
        product.tiers.map(async t => {
          const stock = await getAvailableKeyCount(resolveStorageId(product.id, t.days));
          return (
            `**${t.days} day${t.days > 1 ? "s" : ""}** — ~~$${t.originalPrice}~~ **$${t.price}** 🔥  📦 \`${stock}\` in stock`
          );
        })
      );

      const embed = new EmbedBuilder()
        .setTitle(`${product.emoji}  ${product.name}`)
        .setDescription(
          `${product.description}\n\n` +
          `**💰 Pricing (Special Discount!):**\n${tierInfo.join("\n")}`
        )
        .setColor(BRAND_COLOR)
        .setFooter({ text: "Select a tier below to purchase • " + FOOTER_TEXT })
        .setTimestamp();

      const row = buildTierButtons(productId);

      return interaction.update({
        embeds:     [embed],
        components: row ? [row] : []
      });
    }

    if (interaction.customId === "pay_currency") {
      const currency = interaction.values[0];
      const userId   = interaction.user.id;
      pendingPayments.set(userId, { currency, amount: null });

      const cur = CURRENCIES[currency];
      const embed = new EmbedBuilder()
        .setTitle(`${cur.emoji}  ${cur.name} Selected`)
        .setDescription("**Step 2 / 2** — Choose an amount to deposit.")
        .setColor(cur.color)
        .setFooter({ text: FOOTER_TEXT });

      return interaction.update({ embeds: [embed], components: [buildAmountRow()] });
    }
  }

  // ──────────── MODAL SUBMITS ────────────
  if (interaction.isModalSubmit()) {

    if (interaction.customId === "modal_custom_amount") {
      const userId  = interaction.user.id;
      const pending = pendingPayments.get(userId);
      if (!pending) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⚠️  Session Expired")
              .setDescription("Your session timed out. Please use `/pay` to start again.")
              .setColor(WARNING_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ],
          ephemeral: true
        });
      }

      const amount = parseFloat(interaction.fields.getTextInputValue("custom_amount_input"));

      if (isNaN(amount) || amount < 1 || amount > 1000) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Invalid Amount")
              .setDescription("Please enter a valid amount **between $1 and $1000**.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ],
          ephemeral: true
        });
      }

      pending.amount = amount;
      pendingPayments.set(userId, pending);
      await interaction.deferReply({ ephemeral: true });
      await processPayment(interaction, userId, amount, pending.currency);
      return;
    }

    // modal_delete_key_<storageId>_<page>
    if (interaction.customId.startsWith("modal_delete_key_")) {
      await interaction.deferReply({ ephemeral: true });

      const withoutPrefix  = interaction.customId.slice("modal_delete_key_".length);
      const lastUnderscore = withoutPrefix.lastIndexOf("_");
      const storageId      = withoutPrefix.substring(0, lastUnderscore);
      const page           = parseInt(withoutPrefix.substring(lastUnderscore + 1));
      const perPage        = 10;

      const keyNumberRaw = interaction.fields.getTextInputValue("delete_key_number");
      const keyNumber    = parseInt(keyNumberRaw.trim());

      if (isNaN(keyNumber) || keyNumber < 1) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Invalid Number")
              .setDescription("Please enter a valid key number from the list.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const globalOffset = keyNumber - 1;
      const targetPage   = Math.floor(globalOffset / perPage) + 1;
      const localIndex   = globalOffset % perPage;

      const { keys, total } = await getAvailableProductKeys(storageId, targetPage, perPage);

      if (localIndex >= keys.length) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Key Not Found")
              .setDescription(`No available key #${keyNumber} exists. Total available: **${total}**.`)
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const keyRecord = keys[localIndex];
      const success   = await deleteKey(keyRecord.id);

      if (!success) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Delete Failed")
              .setDescription("Could not delete the key. Check server logs.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const { productId, tierDays } = parseStorageId(storageId);
      const product                 = PRODUCTS[productId];
      const tierLabel               = tierDays ? ` (${tierDays} Day${tierDays > 1 ? "s" : ""})` : "";
      const newStock                = await getAvailableKeyCount(storageId);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🗑️  Key Deleted")
            .setDescription(`Key **#${keyNumber}** has been permanently removed from **${product.name}${tierLabel}**.`)
            .addFields(
              { name: "🔑 Deleted Key",     value: `\`${keyRecord.key_value.substring(0, 30)}...\``, inline: false },
              { name: "📦 Remaining Stock", value: `\`${newStock}\` keys available`,                  inline: true  },
              { name: "🛠️ Deleted By",      value: `<@${interaction.user.id}>`,                      inline: true  }
            )
            .setColor(ERROR_COLOR)
            .setFooter({ text: FOOTER_TEXT })
            .setTimestamp()
        ]
      });

      return;
    }
  }
});

// ===== PARSE STORAGE ID =====
function parseStorageId(storageId) {
  const match = storageId.match(/^(.+?)_(\d+)$/);
  if (match && PRODUCTS[match[1]]) {
    return { productId: match[1], tierDays: parseInt(match[2]) };
  }
  return { productId: storageId, tierDays: null };
}

// ===== KEY LIST HELPERS =====
async function buildKeyListEmbedAndRow(storageId, productId, tierDays, page, perPage) {
  const { keys, total } = await getAvailableProductKeys(storageId, page, perPage);
  const totalPages      = Math.ceil(total / perPage) || 1;

  const product   = PRODUCTS[productId];
  const tierLabel = tierDays ? ` — ${tierDays} Day${tierDays > 1 ? "s" : ""}` : "";

  if (keys.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle(`📋  ${product.name}${tierLabel} — Available Keys`)
      .setDescription("No available keys found for this product/tier.")
      .setColor(NEUTRAL_COLOR)
      .setFooter({ text: FOOTER_TEXT });
    return { embed, row: null, totalPages };
  }

  const keyList = keys.map((key, idx) => {
    const num        = (page - 1) * perPage + idx + 1;
    const keyPreview = key.key_value.substring(0, 24) + "...";
    return `**${num}.** \`${keyPreview}\``;
  }).join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`📋  ${product.name}${tierLabel} — Available Keys`)
    .setDescription(keyList)
    .addFields(
      { name: "📦 Total Available", value: `\`${total}\``,               inline: true },
      { name: "📄 Page",           value: `\`${page} / ${totalPages}\``, inline: true }
    )
    .setColor(BRAND_COLOR)
    .setFooter({ text: `Use 🗑️ Delete Key to remove a key by its number • ${FOOTER_TEXT}` })
    .setTimestamp();

  const row = buildKeyListButtons(page, totalPages, storageId);
  return { embed, row, totalPages };
}

async function sendKeyListEmbed(interaction, storageId, productId, tierDays, page, perPage) {
  const { embed, row } = await buildKeyListEmbedAndRow(storageId, productId, tierDays, page, perPage);
  return interaction.editReply({
    embeds:     [embed],
    components: row ? [row] : []
  });
}

async function sendKeyListEdit(interaction, storageId, productId, tierDays, page, perPage) {
  const { embed, row } = await buildKeyListEmbedAndRow(storageId, productId, tierDays, page, perPage);
  return interaction.editReply({
    embeds:     [embed],
    components: row ? [row] : []
  });
}

// ===== LEGACY TEXT COMMAND /test (owner debug only) =====
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const args = message.content.trim().split(/\s+/);
  const cmd  = args[0].toLowerCase();

  if (cmd === "/test") {
    if (message.author.id !== OWNER_ID)
      return message.reply("⛔ Owner only.");

    const amount = parseFloat(args[1]);
    if (isNaN(amount) || amount <= 0)
      return message.reply("❌ Usage: `/test 10`");

    const success    = await addBalance(message.author.id, amount);
    const newBalance = await getBalance(message.author.id);

    const embed = new EmbedBuilder()
      .setTitle("🧪  Debug — Test Balance")
      .setColor(success ? SUCCESS_COLOR : ERROR_COLOR)
      .addFields(
        { name: "Added",       value: `\`+${amount} USD\``,              inline: true },
        { name: "New Balance", value: `\`${newBalance.toFixed(2)} USD\``, inline: true }
      )
      .setFooter({ text: FOOTER_TEXT });

    if (!success) embed.setDescription("❌ DB write error — check server logs.");
    return message.reply({ embeds: [embed] });
  }
});

// ===== PROCESS PAYMENT =====
async function processPayment(interaction, userId, amount, currency) {
  try {
    const payment = await createPayment(userId, amount, currency);
    const embed   = buildPaymentEmbed(payment, currency, "waiting");

    try {
      const user      = await client.users.fetch(userId);
      const dmMessage = await user.send({ embeds: [embed] });

      await savePaymentMessage(payment.payment_id, userId, dmMessage.id, dmMessage.channel.id);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("📬  Invoice Sent!")
            .setDescription("Check your **Direct Messages** for payment details.")
            .setColor(SUCCESS_COLOR)
            .setFooter({ text: FOOTER_TEXT })
        ],
        components: []
      });
    } catch {
      await interaction.editReply({ embeds: [embed], components: [] });
    }

    setTimeout(() => pendingPayments.delete(userId), 30 * 60 * 1000);
  } catch (err) {
    console.error("❌ Payment creation error:", err.response?.data || err.message);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("❌  Payment Failed")
          .setDescription("Could not create payment. Please try again later.")
          .setColor(ERROR_COLOR)
          .setFooter({ text: FOOTER_TEXT })
      ],
      components: []
    });
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

  const {
    payment_status: status,
    order_id:       userId,
    price_amount,
    pay_currency,
    payment_id
  } = req.body;

  const amount = parseFloat(price_amount || 0);
  console.log(`🔔 Webhook: status=${status}, userId=${userId}, amount=${amount}`);

  try {
    const cfg = STATUS_CONFIG[status];
    if (!cfg) return res.sendStatus(200);

    const msgInfo = await getPaymentMessage(payment_id);

    if (status === "finished") {
      const success    = await addBalance(userId, amount);
      const newBalance = await getBalance(userId);

      const embed = new EmbedBuilder()
        .setTitle(`${cfg.icon}  ${cfg.title}`)
        .setDescription(cfg.desc)
        .setColor(cfg.color)
        .setFooter({ text: `Payment ID: ${payment_id} • ${FOOTER_TEXT}` })
        .setTimestamp();

      embed.addFields(
        { name: "➕ Amount Added", value: `\`+${amount.toFixed(2)} USD\``,    inline: true },
        { name: "💰 New Balance",  value: `\`${newBalance.toFixed(2)} USD\``, inline: true }
      );

      if (!success) {
        embed.setColor(ERROR_COLOR)
             .setTitle("⚠️  Payment OK — Balance Update Failed")
             .setDescription("Payment received but balance update failed. Contact support.");
      }

      if (msgInfo) {
        try {
          const user    = await client.users.fetch(msgInfo.userId);
          const channel = await user.createDM();
          const message = await channel.messages.fetch(msgInfo.messageId);
          await message.edit({ embeds: [embed] });
          console.log(`✅ Updated payment message for ${payment_id}`);
        } catch (editErr) {
          console.error(`❌ Could not edit message for payment ${payment_id}:`, editErr.message);
          const payerUser = await client.users.fetch(userId).catch(() => null);
          if (payerUser) await payerUser.send({ embeds: [embed] }).catch(() => {});
        }
      } else {
        console.log(`⚠️ No saved message for payment ${payment_id}, sending new message`);
        const payerUser = await client.users.fetch(userId).catch(() => null);
        if (payerUser) await payerUser.send({ embeds: [embed] }).catch(() => {});
      }

      if (success) {
        const payerUser = await client.users.fetch(userId).catch(() => null);
        if (payerUser) {
          const notifyEmbed = buildPaymentNotifyEmbed(payerUser, amount, newBalance, payment_id);
          const plusUsers   = await getAccessPlusUsers();

          let notified = 0;
          for (const user of plusUsers) {
            if (user.id === userId) continue;
            try {
              await user.send({ embeds: [notifyEmbed] });
              notified++;
              console.log(`✅ Notified Pay Access+ user ${user.tag}`);
            } catch (err) {
              console.log(`⚠️ Could not DM Pay Access+ user ${user.tag}:`, err.message);
            }
          }
          console.log(`📣 Notified ${notified} Pay Access+ member(s) about payment by ${payerUser.tag}`);
        }
      }

    } else if (["confirming", "confirmed", "failed", "expired"].includes(status)) {
      const embed = new EmbedBuilder()
        .setTitle(`${cfg.icon}  ${cfg.title}`)
        .setDescription(cfg.desc)
        .setColor(cfg.color)
        .setFooter({ text: `Payment ID: ${payment_id} • ${FOOTER_TEXT}` })
        .setTimestamp();

      if (["confirming", "confirmed"].includes(status)) {
        embed.addFields(
          { name: "💵  Amount",   value: `\`${amount} USD\``,   inline: true },
          { name: "🪙  Currency", value: `\`${pay_currency}\``, inline: true }
        );
      }

      if (msgInfo) {
        try {
          const user    = await client.users.fetch(msgInfo.userId);
          const channel = await user.createDM();
          const message = await channel.messages.fetch(msgInfo.messageId);
          await message.edit({ embeds: [embed] });
          console.log(`✅ Updated payment message for ${payment_id} (status: ${status})`);
        } catch (editErr) {
          console.error(`❌ Could not edit message for payment ${payment_id}:`, editErr.message);
          const user = await client.users.fetch(userId).catch(() => null);
          if (user) await user.send({ embeds: [embed] }).catch(() => {});
        }
      } else {
        const user = await client.users.fetch(userId).catch(() => null);
        if (user) await user.send({ embeds: [embed] }).catch(() => {});
      }
    }

  } catch (err) {
    console.error("❌ Webhook processing error:", err.message);
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`🌐 Webhook server on port ${PORT}`));
client.login(DISCORD_TOKEN);
