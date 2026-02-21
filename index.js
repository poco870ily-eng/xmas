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

// ===== RESTRICTED GUILD SETTINGS =====
const RESTRICTED_GUILD_ID = "1418749872848375962";

// ===== STOCK SETTINGS =====
const MAX_NOTIFIER_STOCK = 15;
const STOCK_CHANNEL_ID   = "1474349576814334047";

// ===== ROLE NAMES =====
const ROLE_ACCESS           = "Pay Access";
const ROLE_ACCESS_PLUS      = "Pay Access+";
const ROLE_NOTIFIER_ACCESS  = "Access";

// ===== (ОПЦИОНАЛЬНО) ROLE IDs =====
const USE_ROLE_IDS        = false;
const ROLE_ID_ACCESS      = process.env.ROLE_ID_ACCESS || "";
const ROLE_ID_ACCESS_PLUS = process.env.ROLE_ID_ACCESS_PLUS || "";

// ===== PAUSE STATE =====
let isPaused       = false;
let pauseStartTime = null;

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

// ===== SLASH COMMANDS =====
const SLASH_COMMANDS = [
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
  },
  {
    name: "checktime",
    description: "⏰ Check your remaining Notifier subscription time"
  },
  {
    name: "redeem",
    description: "🎟️ Redeem a coupon for balance",
    options: [
      {
        name: "code",
        description: "Your coupon code (e.g. COUP-XXXXXXXX)",
        type: ApplicationCommandOptionType.String,
        required: true
      }
    ]
  },
  {
    name: "generate",
    description: "🎟️ [Owner] Generate balance coupons",
    options: [
      {
        name: "amount",
        description: "USD amount per coupon (e.g. 25.00)",
        type: ApplicationCommandOptionType.Number,
        required: true,
        min_value: 0.01
      },
      {
        name: "count",
        description: "Number of coupons to generate (1-100)",
        type: ApplicationCommandOptionType.Integer,
        required: true,
        min_value: 1,
        max_value: 100
      }
    ]
  },
  {
    name: "viewadmins",
    description: "🔍 [Owner] Debug — list all users with Pay Access / Pay Access+ roles",
    dm_permission: false,
    default_member_permissions: "0"
  },
  {
    name: "userlist",
    description: "📋 [Pay Access] Show all users with active Notifier access and time remaining",
    dm_permission: false
  },
  {
    name: "ban",
    description: "🔨 [Pay Access] Remove Notifier Access role from a user immediately",
    dm_permission: false,
    options: [
      {
        name: "user",
        description: "The user to revoke access from",
        type: ApplicationCommandOptionType.User,
        required: true
      }
    ]
  },
  {
    name: "addtime",
    description: "⏰ [Pay Access] Add time to a specific Notifier subscriber",
    dm_permission: false,
    options: [
      {
        name: "user",
        description: "The user to add time to",
        type: ApplicationCommandOptionType.User,
        required: true
      },
      {
        name: "days",
        description: "Days to add (0 or more)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 0,
        max_value: 365
      },
      {
        name: "hours",
        description: "Hours to add (0 or more)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 0,
        max_value: 23
      },
      {
        name: "minutes",
        description: "Minutes to add (0 or more)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 0,
        max_value: 59
      }
    ]
  },
  {
    name: "changetime",
    description: "🕐 [Pay Access] Set a custom expiry time for a Notifier subscriber",
    dm_permission: false,
    options: [
      {
        name: "user",
        description: "The user to set time for",
        type: ApplicationCommandOptionType.User,
        required: true
      }
    ]
  },
  {
    name: "pause",
    description: "⏸️ [Pay Access] Pause / Resume subscription countdown for all Notifier subscribers",
    dm_permission: false
  },
  {
    name: "compensate",
    description: "⏰ [Pay Access] Add extra time to ALL active Notifier subscribers",
    dm_permission: false,
    options: [
      {
        name: "days",
        description: "Days to add (0 or more)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 0,
        max_value: 365
      },
      {
        name: "hours",
        description: "Hours to add (0 or more)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 0,
        max_value: 23
      },
      {
        name: "minutes",
        description: "Minutes to add (0 or more)",
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 0,
        max_value: 59
      }
    ]
  },
  {
    name: "forceadd",
    description: "🔧 [Pay Access] Manually add balance to a user",
    dm_permission: false,
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
    options: [
      {
        name: "product",
        description: "Product to add keys for",
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: "Auto Joiner", value: "auto_joiner" }
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
    options: [
      {
        name: "product",
        description: "Product to view keys for",
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: "Auto Joiner", value: "auto_joiner" }
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

// ===== GLOBAL ERROR HANDLER =====
client.on("error", (err) => {
  console.error("❌ Discord client error:", err.message);
});

process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled rejection:", err?.message || err);
});

// ===== REGISTER COMMANDS GLOBALLY =====
async function registerGlobalCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  try {
    for (const [guildId] of client.guilds.cache) {
      try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: [] });
        console.log(`🧹 Очищены guild-команды для сервера ${guildId}`);
      } catch { /* игнорируем */ }
    }
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: SLASH_COMMANDS });
    console.log("✅ Slash-команды зарегистрированы глобально");
  } catch (err) {
    console.error("❌ Ошибка регистрации команд:", err.message);
  }
}

// ===== REGISTER COMMANDS ON READY =====
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📡 Бот находится на ${client.guilds.cache.size} сервере(ах)`);

  await registerGlobalCommands();

  client.user.setPresence({
    activities: [{ name: "💳 /pay  |  /buy  |  /balance", type: 0 }],
    status: "online"
  });

  setInterval(checkExpiredSubscriptions, 5 * 60 * 1000);
  checkExpiredSubscriptions();

  setTimeout(() => updateStockChannel(), 5000);
  setInterval(updateStockChannel, 5 * 60 * 1000);
});

client.on("guildCreate", (guild) => {
  console.log(`➕ Бот добавлен на новый сервер: "${guild.name}" (${guild.id})`);
});

// ===== STOCK HELPERS =====
async function getNotifierCurrentCount() {
  const seen = new Set();
  for (const [, guild] of client.guilds.cache) {
    try {
      await guild.members.fetch({ force: true });
    } catch { /* ignore */ }
    const role = guild.roles.cache.find(
      r => normalizeRoleName(r.name) === normalizeRoleName(ROLE_NOTIFIER_ACCESS)
    );
    if (!role) continue;
    for (const [, member] of guild.members.cache) {
      if (member.roles.cache.has(role.id)) {
        seen.add(member.id);
      }
    }
  }
  return seen.size;
}

async function updateStockChannel() {
  try {
    const channel = await client.channels.fetch(STOCK_CHANNEL_ID).catch(() => null);
    if (!channel) {
      console.warn(`⚠️ Stock channel ${STOCK_CHANNEL_ID} not found`);
      return;
    }

    const currentCount = await getNotifierCurrentCount();
    const available    = MAX_NOTIFIER_STOCK - currentCount;
    const isFull       = available <= 0;

    const newName = isFull ? `🛑—stock-info` : `🟢—stock-info`;

    if (channel.name !== newName) {
      await channel.setName(newName);
      console.log(`📊 Stock channel updated → "${newName}" (${currentCount}/${MAX_NOTIFIER_STOCK})`);
    }
  } catch (e) {
    console.error("❌ Could not update stock channel:", e.message);
  }
}

// ===== WELCOME MESSAGE FOR NEW TICKET CHANNELS =====
client.on("channelCreate", async (channel) => {
  try {
    if (!channel.isTextBased() || !channel.guild) return;
    const channelName = channel.name.toLowerCase();
    if (!channelName.includes("ticket")) return;

    console.log(`🎫 New ticket channel created: "${channel.name}" in guild "${channel.guild.name}"`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    const welcomeEmbed = new EmbedBuilder()
      .setTitle("🎫  Welcome to the Ticket System!")
      .setDescription(
        "**Hello!** I'm here to help you with purchases and account management.\n\n" +
        "**Quick Start Guide:**"
      )
      .addFields(
        { name: "💳  Top Up Your Balance",      value: "Use `/pay` to add funds via cryptocurrency", inline: false },
        { name: "🛒  Purchase Products",         value: "Use `/buy` to browse and purchase available products", inline: false },
        { name: "💰  Check Balance",             value: "Use `/balance` to view your current account balance", inline: false },
        { name: "📖  All Commands",              value: "Use `/help` to see the complete list of available commands", inline: false },
        { name: "🪙  Accepted Cryptocurrencies", value: "₿ Bitcoin • Ł Litecoin • ₮ USDT (TRC20) • 🔺 TRON • 🟡 BNB", inline: false }
      )
      .setColor(BRAND_COLOR)
      .setFooter({ text: FOOTER_TEXT })
      .setTimestamp();

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("btn_pay").setLabel("💳 Top Up Balance").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("btn_buy").setLabel("🛒 Shop").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("btn_balance").setLabel("💰 Balance").setStyle(ButtonStyle.Secondary)
    );

    await channel.send({ embeds: [welcomeEmbed], components: [actionRow] });
    console.log(`✅ Sent welcome message to channel "${channel.name}"`);
  } catch (error) {
    console.error(`❌ Error sending welcome message to new channel:`, error.message);
  }
});

// ===== CHANNEL RESTRICTION HELPERS =====
function isAllowedChannel(interaction) {
  if (!interaction.guildId) return true;
  if (interaction.guildId !== RESTRICTED_GUILD_ID) return true;
  const channelName = interaction.channel?.name?.toLowerCase() ?? "";
  return channelName.includes("ticket");
}

function getAvailableProducts(guildId) {
  if (guildId === RESTRICTED_GUILD_ID) {
    return Object.fromEntries(
      Object.entries(PRODUCTS).filter(([id]) => id === "notifier")
    );
  }
  return PRODUCTS;
}

function getNotifierChannelName(guildId) {
  if (guildId === RESTRICTED_GUILD_ID) return "💎︱10m-inf";
  return "#no";
}

// ===== ROLE HELPERS =====
function normalizeRoleName(name) {
  return name.trim().toLowerCase();
}

function memberHasRole(member, roleName, roleId = "") {
  if (USE_ROLE_IDS && roleId) return member.roles.cache.has(roleId);
  const target = normalizeRoleName(roleName);
  return member.roles.cache.some(r => normalizeRoleName(r.name) === target);
}

async function getAccessTier(userId) {
  if (userId === OWNER_ID) return "plus";

  for (const [, guild] of client.guilds.cache) {
    try {
      await guild.roles.fetch();
      const member = await guild.members.fetch({ user: userId, force: true });

      console.log(
        `[DEBUG getAccessTier] User ${userId} in "${guild.name}" roles:`,
        member.roles.cache.map(r => `"${r.name}"`).join(", ") || "none"
      );
      console.log(
        `[DEBUG getAccessTier] Guild "${guild.name}" all roles:`,
        guild.roles.cache.map(r => `"${r.name}"`).join(", ")
      );

      if (memberHasRole(member, ROLE_ACCESS_PLUS, ROLE_ID_ACCESS_PLUS)) return "plus";
      if (memberHasRole(member, ROLE_ACCESS,      ROLE_ID_ACCESS))      return "basic";
    } catch (e) {
      console.error(`[DEBUG getAccessTier] Error in guild "${guild.name}":`, e.message);
      continue;
    }
  }

  return null;
}

async function getAccessPlusUsers() {
  const seen  = new Set();
  const users = [];

  for (const [, guild] of client.guilds.cache) {
    try {
      await guild.roles.fetch();
      await guild.members.fetch({ force: true });
    } catch (e) {
      console.error(`❌ Could not fetch data for guild "${guild.name}":`, e.message);
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
      console.warn(`⚠️ Role "${ROLE_ACCESS_PLUS}" not found in guild "${guild.name}". Available: ${guild.roles.cache.map(r => r.name).join(", ")}`);
      continue;
    }

    console.log(`✅ Found Pay Access+ role "${role.name}" (${role.id}) in "${guild.name}"`);

    for (const [, member] of guild.members.cache) {
      if (!member.roles.cache.has(role.id)) continue;
      if (seen.has(member.id)) continue;
      seen.add(member.id);
      users.push(member.user);
      console.log(`👤 Pay Access+ user found: ${member.user.tag}`);
    }
  }

  console.log(`📊 Total Pay Access+ users found: ${users.length}`);
  return users;
}

// ===== NOTIFIER ACCESS ROLE HELPERS =====
async function findNotifierRole(guild) {
  if (!guild) return null;
  if (guild.roles.cache.size <= 1) await guild.roles.fetch();
  const role = guild.roles.cache.find(
    r => normalizeRoleName(r.name) === normalizeRoleName(ROLE_NOTIFIER_ACCESS)
  );
  if (!role) {
    console.warn(`⚠️ Role "${ROLE_NOTIFIER_ACCESS}" not found in "${guild.name}". Roles: ${guild.roles.cache.map(r => r.name).join(", ")}`);
  } else {
    console.log(`✅ Found role "${role.name}" (ID: ${role.id})`);
  }
  return role || null;
}

async function giveNotifierRole(userId, guild) {
  if (!guild) {
    for (const [, g] of client.guilds.cache) {
      const result = await giveNotifierRole(userId, g);
      if (result) return true;
    }
    console.error(`❌ giveNotifierRole: no guild available for userId=${userId}`);
    return false;
  }
  const role = await findNotifierRole(guild);
  if (!role) return false;
  try {
    const member = await guild.members.fetch({ user: userId, force: true });
    await member.roles.add(role.id);
    console.log(`✅ Gave "${ROLE_NOTIFIER_ACCESS}" role (${role.id}) to ${userId}`);
    await updateStockChannel();
    return true;
  } catch (e) {
    console.error(`❌ Could not give role to ${userId}:`, e.message);
    return false;
  }
}

async function removeNotifierRole(userId, guild) {
  if (!guild) {
    for (const [, g] of client.guilds.cache) {
      await removeNotifierRole(userId, g);
    }
    await updateStockChannel();
    return true;
  }
  const role = await findNotifierRole(guild);
  if (!role) return false;
  try {
    const member = await guild.members.fetch({ user: userId, force: true });
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role.id);
      console.log(`✅ Removed "${ROLE_NOTIFIER_ACCESS}" role from ${userId}`);
    }
    await updateStockChannel();
    return true;
  } catch (e) {
    console.error(`❌ Could not remove role from ${userId}:`, e.message);
    return false;
  }
}

// ===== SUBSCRIPTION HELPERS =====
async function addSubscription(userId, days) {
  const userIdStr = userId.toString();

  const { data, error: selectError } = await supabase
    .from("subscriptions")
    .select("expires_at")
    .eq("user_id", userIdStr)
    .single();

  let baseDate = new Date();

  if (data) {
    const existing = new Date(data.expires_at);
    if (existing > baseDate) baseDate = existing;
  } else if (selectError && selectError.code !== "PGRST116") {
    console.error("❌ Subscription select error:", selectError.message);
    return false;
  }

  const newExpiry = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

  if (data) {
    const { error } = await supabase
      .from("subscriptions")
      .update({ expires_at: newExpiry.toISOString() })
      .eq("user_id", userIdStr);
    if (error) { console.error("❌ Subscription update error:", error.message); return false; }
  } else {
    const { error } = await supabase
      .from("subscriptions")
      .insert({ user_id: userIdStr, expires_at: newExpiry.toISOString() });
    if (error) { console.error("❌ Subscription insert error:", error.message); return false; }
  }

  console.log(`✅ Subscription set for ${userIdStr} until ${newExpiry.toISOString()}`);
  return true;
}

async function addSubscriptionMs(userId, ms) {
  const userIdStr = userId.toString();

  const { data, error: selectError } = await supabase
    .from("subscriptions")
    .select("expires_at")
    .eq("user_id", userIdStr)
    .single();

  let baseDate = new Date();

  if (data) {
    const existing = new Date(data.expires_at);
    if (existing > baseDate) baseDate = existing;
  } else if (selectError && selectError.code !== "PGRST116") {
    console.error("❌ Subscription select error:", selectError.message);
    return false;
  }

  const newExpiry = new Date(baseDate.getTime() + ms);

  if (data) {
    const { error } = await supabase
      .from("subscriptions")
      .update({ expires_at: newExpiry.toISOString() })
      .eq("user_id", userIdStr);
    if (error) { console.error("❌ Subscription update error:", error.message); return false; }
  } else {
    const { error } = await supabase
      .from("subscriptions")
      .insert({ user_id: userIdStr, expires_at: newExpiry.toISOString() });
    if (error) { console.error("❌ Subscription insert error:", error.message); return false; }
  }

  console.log(`✅ Subscription set for ${userIdStr} until ${newExpiry.toISOString()}`);
  return true;
}

async function addTimeToUserSubscription(userId, ms) {
  const userIdStr = userId.toString();

  const { data, error: selectError } = await supabase
    .from("subscriptions")
    .select("expires_at")
    .eq("user_id", userIdStr)
    .single();

  if (selectError && selectError.code !== "PGRST116") {
    console.error("❌ Subscription select error:", selectError.message);
    return false;
  }

  if (!data) {
    console.log(`⚠️ No subscription found for user ${userIdStr}`);
    return false;
  }

  const currentExpiry = new Date(data.expires_at);
  const newExpiry = new Date(currentExpiry.getTime() + ms);

  const { error } = await supabase
    .from("subscriptions")
    .update({ expires_at: newExpiry.toISOString() })
    .eq("user_id", userIdStr);

  if (error) { console.error("❌ Subscription update error:", error.message); return false; }
  console.log(`✅ Added time to ${userIdStr}. New expiry: ${newExpiry.toISOString()}`);
  return true;
}

async function setSubscriptionExpiry(userId, ms) {
  const userIdStr = userId.toString();
  const newExpiry = new Date(Date.now() + ms);

  const { data, error: selectError } = await supabase
    .from("subscriptions")
    .select("expires_at")
    .eq("user_id", userIdStr)
    .single();

  if (selectError && selectError.code !== "PGRST116") {
    console.error("❌ Subscription select error:", selectError.message);
    return false;
  }

  if (!data) {
    console.log(`⚠️ No subscription found for user ${userIdStr}`);
    return false;
  }

  const { error } = await supabase
    .from("subscriptions")
    .update({ expires_at: newExpiry.toISOString() })
    .eq("user_id", userIdStr);

  if (error) { console.error("❌ Subscription set-expiry error:", error.message); return false; }
  console.log(`✅ Set expiry for ${userIdStr} to ${newExpiry.toISOString()}`);
  return true;
}

async function getSubscription(userId) {
  const { data } = await supabase
    .from("subscriptions")
    .select("expires_at")
    .eq("user_id", userId.toString())
    .single();

  if (!data) return null;
  const expires = new Date(data.expires_at);
  if (expires <= new Date()) return null;
  return { expires_at: expires };
}

async function removeSubscription(userId) {
  const { error } = await supabase
    .from("subscriptions")
    .delete()
    .eq("user_id", userId.toString());
  if (error) console.error("❌ Subscription delete error:", error.message);
  return !error;
}

async function getAllActiveSubscriptions() {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("user_id, expires_at")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true });

  if (error) {
    console.error("❌ Error fetching subscriptions:", error.message);
    return [];
  }
  return data || [];
}

async function addTimeToAllSubscriptions(ms) {
  const subs = await getAllActiveSubscriptions();
  if (subs.length === 0) return 0;

  let updated = 0;
  for (const sub of subs) {
    const newExpiry = new Date(new Date(sub.expires_at).getTime() + ms);
    const { error } = await supabase
      .from("subscriptions")
      .update({ expires_at: newExpiry.toISOString() })
      .eq("user_id", sub.user_id);
    if (!error) updated++;
  }
  console.log(`✅ Compensated ${updated} subscribers`);
  return updated;
}

async function checkExpiredSubscriptions() {
  if (isPaused) {
    console.log("⏸️ Subscriptions paused — skipping expiry check.");
    return;
  }

  console.log("🔍 Checking for expired Notifier subscriptions...");

  const { data, error } = await supabase
    .from("subscriptions")
    .select("user_id, expires_at")
    .lte("expires_at", new Date().toISOString());

  if (error) { console.error("❌ Error checking expired subscriptions:", error.message); return; }
  if (!data || data.length === 0) { console.log("✅ No expired subscriptions found."); return; }

  for (const sub of data) {
    console.log(`⏰ Subscription expired for user ${sub.user_id}`);
    await removeNotifierRole(sub.user_id);
    await removeSubscription(sub.user_id);

    try {
      const user = await client.users.fetch(sub.user_id);
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("⏰  Notifier Access Expired")
            .setDescription(
              "Your **Notifier** subscription has expired and your **Access** role has been removed.\n\n" +
              "Use `/buy` to renew your access!"
            )
            .setColor(ERROR_COLOR)
            .setFooter({ text: FOOTER_TEXT })
            .setTimestamp()
        ]
      });
    } catch {
      console.log(`⚠️ Could not DM user ${sub.user_id} about expiry`);
    }
  }

  console.log(`✅ Processed ${data.length} expired subscription(s).`);
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

  if (!data) { console.log("⚠️ User not found in database"); return false; }

  const currentBalance = parseFloat(data.balance || 0);
  if (currentBalance < amount) { console.log("⚠️ Insufficient balance"); return false; }

  const newBalance = currentBalance - amount;
  const { error } = await supabase.from("users").update({ balance: newBalance }).eq("user_id", userIdStr);

  if (error) { console.error("❌ Deduct error:", error.message); return false; }
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

// ===== COUPON HELPERS =====
function generateCouponCode() {
  const bytes = crypto.randomBytes(5).toString("hex").toUpperCase();
  return `COUP-${bytes}`;
}

async function createCoupons(amount, count, createdBy) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(generateCouponCode());
  }

  const records = codes.map(code => ({
    code,
    amount,
    is_used: false,
    created_by: createdBy.toString()
  }));

  const { error } = await supabase.from("coupons").insert(records);
  if (error) {
    console.error("❌ Error creating coupons:", error.message);
    return null;
  }

  console.log(`✅ Created ${count} coupons worth $${amount} each`);
  return codes;
}

async function redeemCoupon(code, userId) {
  const userIdStr = userId.toString();
  const normalizedCode = code.trim().toUpperCase();

  const { data, error: selectError } = await supabase
    .from("coupons")
    .select("*")
    .eq("code", normalizedCode)
    .single();

  if (selectError || !data) {
    return { success: false, reason: "not_found" };
  }

  if (data.is_used) {
    return { success: false, reason: "already_used" };
  }

  const { error: updateError } = await supabase
    .from("coupons")
    .update({
      is_used: true,
      used_by_user_id: userIdStr,
      used_at: new Date().toISOString()
    })
    .eq("code", normalizedCode);

  if (updateError) {
    console.error("❌ Coupon redeem update error:", updateError.message);
    return { success: false, reason: "db_error" };
  }

  const success = await addBalance(userId, data.amount);
  if (!success) {
    return { success: false, reason: "balance_error" };
  }

  return { success: true, amount: data.amount };
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
  const { count, error } = await supabase
    .from("keys")
    .select("*", { count: "exact", head: true })
    .eq("product_id", storageId)
    .eq("is_used", false);

  if (error) { console.error("❌ Error counting keys:", error.message); return 0; }
  return count || 0;
}

async function getRandomAvailableKey(storageId) {
  const { data, error } = await supabase
    .from("keys")
    .select("*")
    .eq("product_id", storageId)
    .eq("is_used", false)
    .limit(1);

  if (error) { console.error("❌ Error fetching key:", error.message); return null; }
  if (!data || data.length === 0) return null;
  return data[0];
}

async function markKeyAsUsed(keyId, userId) {
  const { error } = await supabase
    .from("keys")
    .update({
      is_used: true,
      used_by_user_id: userId.toString(),
      used_at: new Date().toISOString()
    })
    .eq("id", keyId);

  if (error) { console.error("❌ Error marking key as used:", error.message); return false; }
  return true;
}

async function addKeys(storageId, keys) {
  const keyRecords = keys.map(key => ({
    product_id: storageId,
    key_value:  key.trim(),
    is_used:    false
  }));

  const { error } = await supabase.from("keys").insert(keyRecords);
  if (error) { console.error("❌ Error adding keys:", error.message); return false; }
  return true;
}

async function getAvailableProductKeys(storageId, page = 1, perPage = 10) {
  const from = (page - 1) * perPage;
  const to   = from + perPage - 1;

  const { data, error, count } = await supabase
    .from("keys")
    .select("*", { count: "exact" })
    .eq("product_id", storageId)
    .eq("is_used", false)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) { console.error("❌ Error getting keys:", error.message); return { keys: [], total: 0 }; }
  return { keys: data || [], total: count || 0 };
}

async function deleteKey(keyId) {
  const { error } = await supabase.from("keys").delete().eq("id", keyId);
  if (error) { console.error("❌ Error deleting key:", error.message); return false; }
  return true;
}

// ===== PRODUCT CONFIG =====
const PRODUCTS = {
  auto_joiner: {
    id:          "auto_joiner",
    name:        "Auto Joiner",
    emoji:       "🤖",
    description: "Automatically join rich servers",
    isAccess:    false,
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
    description: "Get access to real-time alerts channel",
    isAccess:    true,
    tiers: [
      { days: 3,  price: 20 },
      { days: 7,  price: 50 },
      { days: 14, price: 80 }
    ]
  }
};

// ===== CURRENCY CONFIG =====
const CURRENCIES = {
  BTC:  { emoji: "₿",  name: "Bitcoin",       color: 0xF7931A },
  LTC:  { emoji: "Ł",  name: "Litecoin",       color: 0xBFBBBB },
  USDT: { emoji: "₮",  name: "Tether (TRC20)", color: 0x26A17B },
  TRX:  { emoji: "🔺", name: "TRON",           color: 0xFF0013 },
  BNB:  { emoji: "🟡", name: "BNB",            color: 0xF3BA2F }
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
const BRAND_COLOR    = 0x5865F2;
const SUCCESS_COLOR  = 0x2ECC71;
const WARNING_COLOR  = 0xF1C40F;
const ERROR_COLOR    = 0xE74C3C;
const NEUTRAL_COLOR  = 0x99AAB5;
const ADMIN_COLOR    = 0xE67E22;
const PLUS_COLOR     = 0xA855F7;
const FUNPAY_COLOR   = 0xFF6B35;
const ACCESS_COLOR   = 0x00BCD4;
const PAUSE_COLOR    = 0xFF8C00;
const COUPON_COLOR   = 0x1ABC9C;

const FOOTER_TEXT = "⚡ Nameless Paysystem";

// ===== UTILITY =====
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days    = Math.floor(totalSeconds / 86400);
  const hours   = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];
  if (days)    parts.push(`${days}д`);
  if (hours)   parts.push(`${hours}ч`);
  if (minutes) parts.push(`${minutes}м`);
  return parts.length > 0 ? parts.join(" ") : "< 1м";
}

function parseTimeString(str) {
  let totalMs = 0;
  const dMatch = str.match(/(\d+)\s*d/i);
  const hMatch = str.match(/(\d+)\s*h/i);
  const mMatch = str.match(/(\d+)\s*m(?!s)/i);
  if (dMatch) totalMs += parseInt(dMatch[1]) * 24 * 60 * 60 * 1000;
  if (hMatch) totalMs += parseInt(hMatch[1]) * 60 * 60 * 1000;
  if (mMatch) totalMs += parseInt(mMatch[1]) * 60 * 1000;
  return totalMs;
}

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
        value:  "`/pay` — Start a crypto top-up\n`/balance` — Check your balance\n`/buy` — Purchase products\n`/checktime` — Check Notifier time\n`/redeem` — Redeem a coupon",
        inline: true
      },
      {
        name:   "🔧  Staff",
        value:  "`/forceadd` — Add balance to a user\n`/addtime` — Add time to user\n`/changetime` — Set custom time\n`/pause` — Pause/Resume timers\n`/addkey` — Add product keys\n`/keylist` — Manage keys\n`/userlist` — Active subscribers\n`/ban` — Revoke access\n`/compensate` — Add time to all\n`/generate` — Generate coupons",
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
          `**${ROLE_ACCESS}** — Can use staff commands\n` +
          `**${ROLE_ACCESS_PLUS}** — All above + receives payment notifications\n` +
          `**${ROLE_NOTIFIER_ACCESS}** — Given to Notifier subscribers`,
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

async function buildShopEmbed(guildId) {
  const embed = new EmbedBuilder()
    .setTitle("🛒  Product Shop")
    .setDescription("Select a product to view pricing and purchase options.")
    .setColor(BRAND_COLOR)
    .setFooter({ text: FOOTER_TEXT })
    .setTimestamp();

  const products = getAvailableProducts(guildId);

  for (const [, product] of Object.entries(products)) {
    if (product.isAccess) {
      const currentCount = await getNotifierCurrentCount();
      const available    = MAX_NOTIFIER_STOCK - currentCount;
      const stockStr     = available <= 0 ? "🛑 **SOLD OUT**" : `🟢 **${available}/${MAX_NOTIFIER_STOCK}** slots free`;
      const tierInfo = product.tiers.map(t =>
        `**${t.days} day${t.days > 1 ? "s" : ""}** — **$${t.price}**  🔔 Role access`
      );
      embed.addFields({
        name:   `${product.emoji}  ${product.name}  •  ${stockStr}`,
        value:  `${product.description}\n${tierInfo.join("\n")}`,
        inline: false
      });
    } else {
      const tierInfo = await Promise.all(
        product.tiers.map(async t => {
          const stock = await getAvailableKeyCount(resolveStorageId(product.id, t.days));
          const orig  = t.originalPrice ? ` ~~$${t.originalPrice}~~` : "";
          return `**${t.days} day${t.days > 1 ? "s" : ""}** —${orig} **$${t.price}** 🔥  📦 \`${stock}\` in stock`;
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
        value: payment.pay_address ? `\`${payment.pay_address}\`` : "`Address pending...`"
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

function buildProductMenu(guildId) {
  const products = getAvailableProducts(guildId);
  const options = Object.entries(products).map(([id, product]) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(product.name)
      .setDescription(product.description)
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
  if (!product) return null;

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

  // ──────────── CHANNEL RESTRICTION CHECK ────────────
  if (!isAllowedChannel(interaction)) {
    try {
      if (interaction.isRepliable()) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🎫  Ticket-Only")
              .setDescription("This bot can only be used inside **ticket** channels on this server.")
              .setColor(WARNING_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ],
          ephemeral: true
        });
      }
    } catch { /* игнорируем */ }
    return;
  }

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

    // /checktime
    if (commandName === "checktime") {
      await interaction.deferReply({ flags: 64 });

      const sub = await getSubscription(interaction.user.id);

      if (!sub) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⏰  No Active Subscription")
              .setDescription(
                "You don't have an active **Notifier** subscription.\n\n" +
                "Use `/buy` to purchase access!"
              )
              .setColor(NEUTRAL_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const now = new Date();
      const expires = new Date(sub.expires_at);
      const remaining = expires - now;
      const timeLeft = formatDuration(remaining);
      const unixExpiry = Math.floor(expires.getTime() / 1000);

      const pauseNote = isPaused
        ? "\n\n⏸️ **Subscriptions are currently paused.** Your timer is frozen."
        : "";

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⏰  Notifier Subscription Status")
            .setDescription(`Your **Notifier** access is active!${pauseNote}`)
            .addFields(
              { name: "⏱️ Time Remaining", value: `\`${timeLeft}\``,                           inline: true },
              { name: "📅 Expires",        value: `<t:${unixExpiry}:F>`,                       inline: true },
              { name: "🔔 Status",         value: `**Active** — ${ROLE_NOTIFIER_ACCESS} role`, inline: false }
            )
            .setColor(isPaused ? PAUSE_COLOR : ACCESS_COLOR)
            .setFooter({ text: FOOTER_TEXT })
            .setTimestamp()
        ]
      });
    }

    // /redeem
    if (commandName === "redeem") {
      await interaction.deferReply({ flags: 64 });

      const code = interaction.options.getString("code");
      const result = await redeemCoupon(code, interaction.user.id);

      if (!result.success) {
        const reasonMap = {
          not_found:    "❌ This coupon code does not exist. Please check the code and try again.",
          already_used: "⚠️ This coupon has already been redeemed.",
          db_error:     "❌ A database error occurred. Please try again later.",
          balance_error:"❌ Failed to apply balance. Please contact support."
        };

        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🎟️  Coupon Redemption Failed")
              .setDescription(reasonMap[result.reason] || "Unknown error occurred.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
              .setTimestamp()
          ]
        });
      }

      const newBalance = await getBalance(interaction.user.id);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎟️  Coupon Redeemed!")
            .setDescription(`Successfully added **$${result.amount.toFixed(2)}** to your balance!`)
            .addFields(
              { name: "🎟️ Code",         value: `\`${code.toUpperCase()}\``,          inline: true },
              { name: "➕ Amount Added",  value: `\`+$${result.amount.toFixed(2)}\``,  inline: true },
              { name: "💰 New Balance",   value: `\`$${newBalance.toFixed(2)}\``,      inline: true }
            )
            .setColor(COUPON_COLOR)
            .setFooter({ text: FOOTER_TEXT })
            .setTimestamp()
        ]
      });
    }

    // /generate (owner only)
    if (commandName === "generate") {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⛔  Access Denied")
              .setDescription("This command is restricted to the **bot owner** only.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ],
          ephemeral: true
        });
      }

      await interaction.deferReply({ flags: 64 });

      const amount = interaction.options.getNumber("amount");
      const count  = interaction.options.getInteger("count");

      const codes = await createCoupons(amount, count, interaction.user.id);

      if (!codes) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Generation Failed")
              .setDescription("Failed to generate coupons. Check server logs.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const fileContent =
        `Nameless Paysystem — Balance Coupons\n` +
        `======================================\n` +
        `Amount per coupon: $${amount.toFixed(2)} USD\n` +
        `Total coupons: ${count}\n` +
        `Generated: ${new Date().toISOString()}\n` +
        `Generated by: ${interaction.user.tag}\n` +
        `======================================\n\n` +
        `COUPON CODES (use /redeem <code>):\n\n` +
        codes.map((c, i) => `${i + 1}. ${c}`).join("\n") +
        `\n\n======================================\n` +
        `Keep these codes safe and secure.\n`;

      const attachment = new AttachmentBuilder(
        Buffer.from(fileContent, "utf-8"),
        { name: `Coupons_${amount}USD_${Date.now()}.txt` }
      );

      try {
        await interaction.user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🎟️  Coupons Generated")
              .setDescription(`Your **${count}** coupon(s) worth **$${amount.toFixed(2)}** each are attached below.`)
              .addFields(
                { name: "💵 Value Each", value: `\`$${amount.toFixed(2)} USD\``, inline: true },
                { name: "🔢 Count",      value: `\`${count}\``,                  inline: true }
              )
              .setColor(COUPON_COLOR)
              .setFooter({ text: FOOTER_TEXT })
              .setTimestamp()
          ],
          files: [attachment]
        });
      } catch {
        console.log("⚠️ Could not DM owner — replying directly");
      }

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅  Coupons Generated Successfully")
            .setDescription(`**${count}** coupon(s) worth **$${amount.toFixed(2)}** each have been sent to your DMs.`)
            .addFields(
              { name: "💵 Value Each", value: `\`$${amount.toFixed(2)} USD\``, inline: true },
              { name: "🔢 Count",      value: `\`${count}\``,                  inline: true },
              { name: "📬 Delivery",   value: "Sent to your DMs as a `.txt` file", inline: false }
            )
            .setColor(COUPON_COLOR)
            .setFooter({ text: FOOTER_TEXT })
            .setTimestamp()
        ]
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

    // /userlist
    if (commandName === "userlist") {
      await interaction.deferReply({ flags: 64 });

      const accessTier = await getAccessTier(interaction.user.id);
      if (!accessTier) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⛔  Access Denied")
              .setDescription(`This command requires the **${ROLE_ACCESS}** or **${ROLE_ACCESS_PLUS}** role.`)
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const subs = await getAllActiveSubscriptions();

      if (subs.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("📋  Active Notifier Subscribers")
              .setDescription("No active subscribers found.")
              .setColor(NEUTRAL_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const now = new Date();
      const lines = subs.map((sub, i) => {
        const expires   = new Date(sub.expires_at);
        const remaining = expires - now;
        const timeLeft  = formatDuration(remaining);
        const unixTs    = Math.floor(expires.getTime() / 1000);
        return `**${i + 1}.** <@${sub.user_id}> — ⏱️ \`${timeLeft}\` remaining (<t:${unixTs}:R>)`;
      });

      const chunks = [];
      for (let i = 0; i < lines.length; i += 20) {
        chunks.push(lines.slice(i, i + 20).join("\n"));
      }

      const pauseNote = isPaused ? "\n\n⏸️ **Timers are currently PAUSED.**" : "";

      const embeds = chunks.map((chunk, idx) =>
        new EmbedBuilder()
          .setTitle(idx === 0 ? `📋  Active Notifier Subscribers (${subs.length})${pauseNote}` : "📋  (continued)")
          .setDescription(chunk)
          .setColor(isPaused ? PAUSE_COLOR : ACCESS_COLOR)
          .setFooter({ text: FOOTER_TEXT })
          .setTimestamp()
      );

      return interaction.editReply({ embeds });
    }

    // /ban
    if (commandName === "ban") {
      await interaction.deferReply({ flags: 64 });

      const accessTier = await getAccessTier(interaction.user.id);
      if (!accessTier) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⛔  Access Denied")
              .setDescription(`This command requires the **${ROLE_ACCESS}** or **${ROLE_ACCESS_PLUS}** role.`)
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const targetUser = interaction.options.getUser("user");
      const sub = await getSubscription(targetUser.id);

      await removeNotifierRole(targetUser.id, interaction.guild);
      await removeSubscription(targetUser.id);

      try {
        await targetUser.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🔨  Access Revoked")
              .setDescription("Your **Notifier** access has been revoked by an administrator.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
              .setTimestamp()
          ]
        });
      } catch {
        console.log(`⚠️ Could not DM ${targetUser.tag} about revocation`);
      }

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🔨  Access Revoked")
            .setDescription(
              sub
                ? `Revoked access from <@${targetUser.id}> — they had \`${formatDuration(new Date(sub.expires_at) - new Date())}\` remaining.`
                : `Revoked access from <@${targetUser.id}>. (No active subscription was found in DB.)`
            )
            .addFields(
              { name: "👤 User", value: `<@${targetUser.id}> (\`${targetUser.tag}\`)`, inline: true },
              { name: "🛠️ By",  value: `<@${interaction.user.id}>`,                   inline: true }
            )
            .setColor(ERROR_COLOR)
            .setFooter({ text: FOOTER_TEXT })
            .setTimestamp()
        ]
      });
    }

    // /addtime
    if (commandName === "addtime") {
      await interaction.deferReply({ flags: 64 });

      const accessTier = await getAccessTier(interaction.user.id);
      if (!accessTier) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⛔  Access Denied")
              .setDescription(`This command requires the **${ROLE_ACCESS}** or **${ROLE_ACCESS_PLUS}** role.`)
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const targetUser = interaction.options.getUser("user");
      const days       = interaction.options.getInteger("days")    || 0;
      const hours      = interaction.options.getInteger("hours")   || 0;
      const minutes    = interaction.options.getInteger("minutes") || 0;

      if (days === 0 && hours === 0 && minutes === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Invalid Input")
              .setDescription("Please specify at least 1 day, 1 hour, or 1 minute to add.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const sub = await getSubscription(targetUser.id);
      if (!sub) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  No Active Subscription")
              .setDescription(
                `<@${targetUser.id}> doesn't have an active **Notifier** subscription.\n\n` +
                `They need to purchase access first using \`/buy\`.`
              )
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const totalMs = (days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60) * 1000;
      const success = await addTimeToUserSubscription(targetUser.id, totalMs);

      if (!success) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Database Error")
              .setDescription("Failed to add time. Check server logs.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const updatedSub = await getSubscription(targetUser.id);
      const unixExpiry = updatedSub ? Math.floor(new Date(updatedSub.expires_at).getTime() / 1000) : null;

      const parts = [];
      if (days > 0)    parts.push(`${days}d`);
      if (hours > 0)   parts.push(`${hours}h`);
      if (minutes > 0) parts.push(`${minutes}м`);
      const label = parts.join(" ");

      try {
        await targetUser.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🎁  Extra Time Added!")
              .setDescription(`An administrator has added **+${label}** to your Notifier subscription!`)
              .addFields(
                { name: "⏱️ Time Added", value: `\`+${label}\``,                               inline: true },
                { name: "📅 New Expiry", value: unixExpiry ? `<t:${unixExpiry}:F>` : "Unknown", inline: true }
              )
              .setColor(SUCCESS_COLOR)
              .setFooter({ text: FOOTER_TEXT })
              .setTimestamp()
          ]
        });
      } catch {
        console.log(`⚠️ Could not DM ${targetUser.tag} about time addition`);
      }

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⏰  Time Added Successfully")
            .setDescription(`Added **+${label}** to <@${targetUser.id}>'s Notifier subscription.`)
            .addFields(
              { name: "👤 Target User", value: `<@${targetUser.id}> (\`${targetUser.tag}\`)`,    inline: true  },
              { name: "⏱️ Time Added",  value: `\`+${label}\``,                                  inline: true  },
              { name: "📅 New Expiry",  value: unixExpiry ? `<t:${unixExpiry}:F>` : "Unknown",   inline: false },
              { name: "🛠️ By",         value: `<@${interaction.user.id}>`,                       inline: true  }
            )
            .setColor(SUCCESS_COLOR)
            .setFooter({ text: FOOTER_TEXT })
            .setTimestamp()
        ]
      });
    }

    // /changetime
    if (commandName === "changetime") {
      try {
        const targetUser = interaction.options.getUser("user");

        const modal = new ModalBuilder()
          .setCustomId(`modal_changetime_${targetUser.id}`)
          .setTitle(`Set Time — ${targetUser.username}`);

        const input = new TextInputBuilder()
          .setCustomId("changetime_input")
          .setLabel("From now (e.g. 7d / 3h / 1d 12h / 30m)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Examples: 7d  |  3h  |  1d 12h  |  30m  |  2d 6h 30m")
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return await interaction.showModal(modal);
      } catch (err) {
        console.error("❌ /changetime showModal error:", err.message);
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              embeds: [
                new EmbedBuilder()
                  .setTitle("❌  Error")
                  .setDescription("Failed to open the dialog. Please try again.")
                  .setColor(ERROR_COLOR)
                  .setFooter({ text: FOOTER_TEXT })
              ],
              ephemeral: true
            });
          }
        } catch { /* ignore */ }
      }
      return;
    }

    // /pause
    if (commandName === "pause") {
      await interaction.deferReply({ flags: 64 });

      const accessTier = await getAccessTier(interaction.user.id);
      if (!accessTier) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⛔  Access Denied")
              .setDescription(`This command requires the **${ROLE_ACCESS}** or **${ROLE_ACCESS_PLUS}** role.`)
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      if (!isPaused) {
        isPaused       = true;
        pauseStartTime = new Date();
        const subs     = await getAllActiveSubscriptions();

        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⏸️  Subscriptions Paused")
              .setDescription(
                "All Notifier subscription timers have been **frozen**.\n\n" +
                "Time will not count down until you run `/pause` again to resume.\n" +
                "When resumed, the paused duration will be **automatically added back** to all subscribers."
              )
              .addFields(
                { name: "👥 Active Subscribers", value: `\`${subs.length}\``,                                    inline: true  },
                { name: "🕐 Paused At",          value: `<t:${Math.floor(pauseStartTime.getTime() / 1000)}:F>`, inline: true  },
                { name: "🛠️ By",                 value: `<@${interaction.user.id}>`,                            inline: false }
              )
              .setColor(PAUSE_COLOR)
              .setFooter({ text: FOOTER_TEXT })
              .setTimestamp()
          ]
        });

      } else {
        const elapsed      = new Date() - pauseStartTime;
        const elapsedLabel = formatDuration(elapsed);
        isPaused           = false;
        pauseStartTime     = null;

        const count = await addTimeToAllSubscriptions(elapsed);
        const subs  = await getAllActiveSubscriptions();
        let dmsOk   = 0;

        for (const sub of subs) {
          try {
            const user = await client.users.fetch(sub.user_id);
            await user.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle("▶️  Subscriptions Resumed!")
                  .setDescription(
                    `The Notifier pause has been lifted.\n` +
                    `**\`+${elapsedLabel}\`** was added to your subscription to compensate for downtime.`
                  )
                  .setColor(SUCCESS_COLOR)
                  .setFooter({ text: FOOTER_TEXT })
                  .setTimestamp()
              ]
            });
            dmsOk++;
          } catch {
            console.log(`⚠️ Could not DM ${sub.user_id} about resume`);
          }
        }

        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("▶️  Subscriptions Resumed")
              .setDescription(
                `Timers have been **unfrozen**.\n` +
                `All active subscribers received **\`+${elapsedLabel}\`** compensation.`
              )
              .addFields(
                { name: "⏸️ Paused Duration",   value: `\`${elapsedLabel}\``,       inline: true  },
                { name: "👥 Users Compensated", value: `\`${count}\``,              inline: true  },
                { name: "📬 DMs Sent",           value: `\`${dmsOk}\``,             inline: true  },
                { name: "🛠️ By",                value: `<@${interaction.user.id}>`, inline: false }
              )
              .setColor(SUCCESS_COLOR)
              .setFooter({ text: FOOTER_TEXT })
              .setTimestamp()
          ]
        });
      }
    }

    // /compensate
    if (commandName === "compensate") {
      await interaction.deferReply({ flags: 64 });

      const accessTier = await getAccessTier(interaction.user.id);
      if (!accessTier) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⛔  Access Denied")
              .setDescription(`This command requires the **${ROLE_ACCESS}** or **${ROLE_ACCESS_PLUS}** role.`)
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const days    = interaction.options.getInteger("days")    || 0;
      const hours   = interaction.options.getInteger("hours")   || 0;
      const minutes = interaction.options.getInteger("minutes") || 0;

      if (days === 0 && hours === 0 && minutes === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Invalid Input")
              .setDescription("Please specify at least 1 day, 1 hour, or 1 minute to compensate.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const totalMs    = (days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60) * 1000;
      const subsBefore = await getAllActiveSubscriptions();
      const count      = await addTimeToAllSubscriptions(totalMs);

      let dmsOk = 0;
      for (const sub of subsBefore) {
        try {
          const user = await client.users.fetch(sub.user_id);
          const parts = [];
          if (days > 0)    parts.push(`${days} day${days > 1 ? "s" : ""}`);
          if (hours > 0)   parts.push(`${hours} hour${hours > 1 ? "s" : ""}`);
          if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? "s" : ""}`);
          const fullLabel = parts.join(" and ");

          await user.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("🎁  Time Compensation!")
                .setDescription(`An administrator has added **${fullLabel}** to your Notifier subscription!`)
                .setColor(SUCCESS_COLOR)
                .setFooter({ text: FOOTER_TEXT })
                .setTimestamp()
            ]
          });
          dmsOk++;
        } catch {
          console.log(`⚠️ Could not DM ${sub.user_id} about compensation`);
        }
      }

      const parts = [];
      if (days > 0)    parts.push(`${days}d`);
      if (hours > 0)   parts.push(`${hours}h`);
      if (minutes > 0) parts.push(`${minutes}м`);
      const label = parts.join(" ");

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⏰  Compensation Applied")
            .setDescription(`Added **+${label}** to **${count}** active subscriber(s).`)
            .addFields(
              { name: "⏱️ Time Added",    value: `\`+${label}\``,              inline: true },
              { name: "👥 Users Updated", value: `\`${count}\``,               inline: true },
              { name: "📬 DMs Sent",      value: `\`${dmsOk}\``,              inline: true },
              { name: "🛠️ Executed By",   value: `<@${interaction.user.id}>`, inline: false }
            )
            .setColor(SUCCESS_COLOR)
            .setFooter({ text: FOOTER_TEXT })
            .setTimestamp()
        ]
      });
    }

    // /addkey
    if (commandName === "addkey") {
      await interaction.deferReply({ flags: 64 });

      const tier = await getAccessTier(interaction.user.id);
      if (!tier) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⛔  Access Denied")
              .setDescription(`This command requires the **${ROLE_ACCESS}** or **${ROLE_ACCESS_PLUS}** role.`)
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

      const productId = interaction.options.getString("product");
      const tierDays  = interaction.options.getInteger("tier");
      const keysText  = interaction.options.getString("keys");
      const file      = interaction.options.getAttachment("file");

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
        } catch {
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

      const product   = PRODUCTS[productId];
      const newStock  = await getAvailableKeyCount(storageId);
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
      await interaction.deferReply({ flags: 64 });

      const accessTier = await getAccessTier(interaction.user.id);
      if (!accessTier) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⛔  Access Denied")
              .setDescription(`This command requires the **${ROLE_ACCESS}** or **${ROLE_ACCESS_PLUS}** role.`)
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

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

      await interaction.deferReply({ flags: 64 });

      const basicUsers = [];
      const plusUsers  = [];
      const seen       = new Set();

      for (const [, guild] of client.guilds.cache) {
        try {
          await guild.roles.fetch();
          await guild.members.fetch();
        } catch (e) {
          console.error(`❌ Could not fetch data for guild "${guild.name}":`, e.message);
          continue;
        }

        console.log(`[viewadmins] Guild "${guild.name}" roles: ${guild.roles.cache.map(r => r.name).join(", ")}`);

        let roleBasic, rolePlus;

        if (USE_ROLE_IDS) {
          roleBasic = ROLE_ID_ACCESS      ? guild.roles.cache.get(ROLE_ID_ACCESS)      : null;
          rolePlus  = ROLE_ID_ACCESS_PLUS ? guild.roles.cache.get(ROLE_ID_ACCESS_PLUS) : null;
        } else {
          roleBasic = guild.roles.cache.find(r => normalizeRoleName(r.name) === normalizeRoleName(ROLE_ACCESS));
          rolePlus  = guild.roles.cache.find(r => normalizeRoleName(r.name) === normalizeRoleName(ROLE_ACCESS_PLUS));
        }

        console.log(`[viewadmins] roleBasic=${roleBasic?.name}, rolePlus=${rolePlus?.name}`);

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
          { name: `🔑  ${ROLE_ACCESS} (${basicUsers.length})`,     value: formatList(basicUsers), inline: false },
          { name: `👑  ${ROLE_ACCESS_PLUS} (${plusUsers.length})`, value: formatList(plusUsers),  inline: false }
        )
        .setColor(0x3498DB)
        .setFooter({ text: `Owner debug • ${FOOTER_TEXT}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // /forceadd
    if (commandName === "forceadd") {
      await interaction.deferReply({ flags: 64 });

      const accessTierLevel = await getAccessTier(interaction.user.id);
      if (!accessTierLevel) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⛔  Access Denied")
              .setDescription(`This command requires the **${ROLE_ACCESS}** or **${ROLE_ACCESS_PLUS}** role.`)
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ]
        });
      }

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

    // ── Buy product buttons ──
    if (interaction.customId.startsWith("buy_")) {
      console.log(`🛒 Purchase initiated by ${interaction.user.tag}: ${interaction.customId}`);
      await interaction.deferReply({ flags: 64 });

      try {
        const withoutPrefix  = interaction.customId.slice("buy_".length);
        const lastUnderscore = withoutPrefix.lastIndexOf("_");
        const productId      = withoutPrefix.substring(0, lastUnderscore);
        const days           = parseInt(withoutPrefix.substring(lastUnderscore + 1));

        const availableProducts = getAvailableProducts(interaction.guildId);
        if (!availableProducts[productId]) {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("❌  Product Not Available")
                .setDescription("This product is not available on this server.")
                .setColor(ERROR_COLOR)
                .setFooter({ text: FOOTER_TEXT })
            ]
          });
        }

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

        // ── NOTIFIER: role-based purchase ──
        if (product.isAccess) {
          const currentCount = await getNotifierCurrentCount();
          const available    = MAX_NOTIFIER_STOCK - currentCount;

          if (available <= 0) {
            return interaction.editReply({
              embeds: [
                new EmbedBuilder()
                  .setTitle("🛑  No Slots Available")
                  .setDescription(
                    `**Notifier** is currently full! (**${currentCount}/${MAX_NOTIFIER_STOCK}** slots occupied)\n\n` +
                    `Please check back later when a slot opens up.`
                  )
                  .setColor(ERROR_COLOR)
                  .setFooter({ text: FOOTER_TEXT })
                  .setTimestamp()
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

          await addSubscription(interaction.user.id, days);
          await giveNotifierRole(interaction.user.id, interaction.guild);

          const newBalance = await getBalance(interaction.user.id);
          const sub        = await supabase
            .from("subscriptions")
            .select("expires_at")
            .eq("user_id", interaction.user.id.toString())
            .single();

          const expiresAt  = sub.data ? new Date(sub.data.expires_at) : null;
          const unixExpiry = expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null;
          const channelName = getNotifierChannelName(interaction.guildId);

          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("✅  Notifier Access Granted!")
                .setDescription(
                  `You now have access to the **${channelName}** channel!\n` +
                  `The **${ROLE_NOTIFIER_ACCESS}** role has been given to you.`
                )
                .addFields(
                  { name: "📅 Duration",    value: `\`${days} day${days > 1 ? "s" : ""}\``,                 inline: true },
                  { name: "💵 Price",       value: `\`$${tier.price}\``,                                     inline: true },
                  { name: "💰 New Balance", value: `\`$${newBalance.toFixed(2)}\``,                          inline: true },
                  {
                    name:  "⏰ Access Until",
                    value: unixExpiry ? `<t:${unixExpiry}:F> (<t:${unixExpiry}:R>)` : "Unknown",
                    inline: false
                  }
                )
                .setColor(ACCESS_COLOR)
                .setFooter({ text: "Your role has been assigned • " + FOOTER_TEXT })
                .setTimestamp()
            ]
          });

          try {
            await interaction.user.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle("🔔  Notifier Access Confirmation")
                  .setDescription(
                    `You've purchased **${product.name}** — **${days} day${days > 1 ? "s" : ""}** access to **${channelName}**!\n\n` +
                    `Your **${ROLE_NOTIFIER_ACCESS}** role is now active.`
                  )
                  .addFields(
                    { name: "📅 Duration", value: `\`${days} day${days > 1 ? "s" : ""}\``, inline: true },
                    { name: "💵 Price",    value: `\`$${tier.price}\``,                     inline: true },
                    {
                      name:  "⏰ Expires",
                      value: unixExpiry ? `<t:${unixExpiry}:F> (<t:${unixExpiry}:R>)` : "Unknown",
                      inline: false
                    }
                  )
                  .setColor(ACCESS_COLOR)
                  .setFooter({ text: FOOTER_TEXT })
                  .setTimestamp()
              ]
            });
          } catch {
            console.log(`⚠️ Could not DM ${interaction.user.tag} about Notifier purchase`);
          }

          return;
        }

        // ── AUTO JOINER: key-based purchase ──
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
                  { name: "🔐 License Key", value: `\`${key.key_value}\``,                            inline: false },
                  { name: "⏱️ Duration",    value: `\`${tier.days} day${tier.days > 1 ? "s" : ""}\``, inline: true  },
                  { name: "💵 Price",       value: `\`$${tier.price}\``,                               inline: true  }
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

    // ── Key list: delete button ──
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

    // ── Key list: pagination / refresh ──
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

    // ── Amount buttons ──
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

      await interaction.deferReply({ flags: 64 });
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
        if (interaction.guildId === RESTRICTED_GUILD_ID) {
          const product  = PRODUCTS["notifier"];
          const currentCount = await getNotifierCurrentCount();
          const available    = MAX_NOTIFIER_STOCK - currentCount;
          const stockStr     = available <= 0
            ? "🛑 **SOLD OUT** — No slots available"
            : `🟢 **${available}/${MAX_NOTIFIER_STOCK}** slots available`;

          const tierInfo = product.tiers.map(t =>
            `**${t.days} day${t.days > 1 ? "s" : ""}** — **$${t.price}**  🔔 Grants **${ROLE_NOTIFIER_ACCESS}** role`
          );

          const existingSub = await getSubscription(interaction.user.id);
          const subNote = existingSub
            ? `\n\n> ℹ️ You currently have **${formatDuration(new Date(existingSub.expires_at) - new Date())}** remaining. Purchasing again will **extend** your access.`
            : "";

          const embed = new EmbedBuilder()
            .setTitle(`${product.emoji}  ${product.name}  •  ${stockStr}`)
            .setDescription(
              `${product.description}\n\n` +
              `**💰 Pricing:**\n${tierInfo.join("\n")}` +
              subNote
            )
            .setColor(available <= 0 ? ERROR_COLOR : ACCESS_COLOR)
            .setFooter({ text: "Select a duration below to purchase • " + FOOTER_TEXT })
            .setTimestamp();

          const row = buildTierButtons("notifier");

          if (available <= 0) {
            const disabledRow = new ActionRowBuilder().addComponents(
              product.tiers.map(t =>
                new ButtonBuilder()
                  .setCustomId(`buy_notifier_${t.days}`)
                  .setLabel(`${t.days} Day${t.days > 1 ? "s" : ""} - $${t.price}`)
                  .setStyle(ButtonStyle.Danger)
                  .setEmoji("🛑")
                  .setDisabled(true)
              )
            );
            return interaction.update({ embeds: [embed], components: [disabledRow] });
          }

          return interaction.update({ embeds: [embed], components: row ? [row] : [] });
        }

        const embed = await buildShopEmbed(interaction.guildId);
        return interaction.update({
          embeds: [embed],
          components: [buildProductMenu(interaction.guildId)]
        });
      }
    }

    if (interaction.customId === "select_product") {
      const productId = interaction.values[0];

      const availableProducts = getAvailableProducts(interaction.guildId);
      if (!availableProducts[productId]) {
        return interaction.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌  Product Not Available")
              .setDescription("This product is not available on this server.")
              .setColor(ERROR_COLOR)
              .setFooter({ text: FOOTER_TEXT })
          ],
          components: []
        });
      }

      const product = PRODUCTS[productId];

      if (product.isAccess) {
        const currentCount = await getNotifierCurrentCount();
        const available    = MAX_NOTIFIER_STOCK - currentCount;
        const stockStr     = available <= 0
          ? "🛑 **SOLD OUT** — No slots available"
          : `🟢 **${available}/${MAX_NOTIFIER_STOCK}** slots available`;

        const tierInfo = product.tiers.map(t =>
          `**${t.days} day${t.days > 1 ? "s" : ""}** — **$${t.price}**  🔔 Grants **${ROLE_NOTIFIER_ACCESS}** role`
        );

        const existingSub = await getSubscription(interaction.user.id);
        const subNote = existingSub
          ? `\n\n> ℹ️ You currently have **${formatDuration(new Date(existingSub.expires_at) - new Date())}** remaining. Purchasing again will **extend** your access.`
          : "";

        const embed = new EmbedBuilder()
          .setTitle(`${product.emoji}  ${product.name}  •  ${stockStr}`)
          .setDescription(
            `${product.description}\n\n` +
            `**💰 Pricing:**\n${tierInfo.join("\n")}` +
            subNote
          )
          .setColor(available <= 0 ? ERROR_COLOR : ACCESS_COLOR)
          .setFooter({ text: "Select a duration below to purchase • " + FOOTER_TEXT })
          .setTimestamp();

        if (available <= 0) {
          const disabledRow = new ActionRowBuilder().addComponents(
            product.tiers.map(t =>
              new ButtonBuilder()
                .setCustomId(`buy_notifier_${t.days}`)
                .setLabel(`${t.days} Day${t.days > 1 ? "s" : ""} - $${t.price}`)
                .setStyle(ButtonStyle.Danger)
                .setEmoji("🛑")
                .setDisabled(true)
            )
          );
          return interaction.update({ embeds: [embed], components: [disabledRow] });
        }

        const row = buildTierButtons(productId);
        return interaction.update({ embeds: [embed], components: row ? [row] : [] });
      }

      const tierInfo = await Promise.all(
        product.tiers.map(async t => {
          const stock = await getAvailableKeyCount(resolveStorageId(product.id, t.days));
          const orig  = t.originalPrice ? ` ~~$${t.originalPrice}~~` : "";
          return `**${t.days} day${t.days > 1 ? "s" : ""}** —${orig} **$${t.price}** 🔥  📦 \`${stock}\` in stock`;
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
      return interaction.update({ embeds: [embed], components: row ? [row] : [] });
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
      await interaction.deferReply({ flags: 64 });
      await processPayment(interaction, userId, amount, pending.currency);
      return;
    }

    // ===== MODAL: changetime =====
    if (interaction.customId.startsWith("modal_changetime_")) {
      try {
        await interaction.deferReply({ flags: 64 });

        const accessTier = await getAccessTier(interaction.user.id);
        if (!accessTier) {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("⛔  Access Denied")
                .setDescription(`This command requires the **${ROLE_ACCESS}** or **${ROLE_ACCESS_PLUS}** role.`)
                .setColor(ERROR_COLOR)
                .setFooter({ text: FOOTER_TEXT })
            ]
          });
        }

        const targetUserId = interaction.customId.slice("modal_changetime_".length);
        const timeStr      = interaction.fields.getTextInputValue("changetime_input").trim();
        const totalMs      = parseTimeString(timeStr);

        if (!totalMs || totalMs <= 0) {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("❌  Invalid Format")
                .setDescription(
                  "Could not parse the time. Use formats like:\n" +
                  "`7d` — 7 days\n`3h` — 3 hours\n`30m` — 30 minutes\n`1d 12h` — 1 day 12 hours\n`2d 6h 30m` — 2 days 6 hours 30 minutes"
                )
                .setColor(ERROR_COLOR)
                .setFooter({ text: FOOTER_TEXT })
            ]
          });
        }

        const newExpiry  = new Date(Date.now() + totalMs);
        const unixExpiry = Math.floor(newExpiry.getTime() / 1000);
        const timeLabel  = formatDuration(totalMs);

        const { error: upsertError } = await supabase
          .from("subscriptions")
          .upsert(
            { user_id: targetUserId.toString(), expires_at: newExpiry.toISOString() },
            { onConflict: "user_id" }
          );

        if (upsertError) {
          console.error("❌ changetime upsert error:", upsertError.message);
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("❌  Database Error")
                .setDescription(`Failed to update subscription time.\n\`${upsertError.message}\``)
                .setColor(ERROR_COLOR)
                .setFooter({ text: FOOTER_TEXT })
            ]
          });
        }

        try {
          const targetUser = await client.users.fetch(targetUserId);
          await targetUser.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("🕐  Subscription Time Updated")
                .setDescription(
                  `An administrator has set your Notifier subscription to **${timeLabel}** from now.`
                )
                .addFields(
                  { name: "⏱️ New Duration", value: `\`${timeLabel}\``,    inline: true },
                  { name: "📅 Expires",      value: `<t:${unixExpiry}:F>`, inline: true }
                )
                .setColor(ACCESS_COLOR)
                .setFooter({ text: FOOTER_TEXT })
                .setTimestamp()
            ]
          });
        } catch {
          console.log(`⚠️ Could not DM ${targetUserId} about changetime`);
        }

        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🕐  Time Set Successfully")
              .setDescription(`<@${targetUserId}>'s subscription has been set to **${timeLabel}** from now.`)
              .addFields(
                { name: "👤 Target User", value: `<@${targetUserId}>`,                            inline: true  },
                { name: "⏱️ New Time",    value: `\`${timeLabel}\``,                              inline: true  },
                { name: "📅 Expires",     value: `<t:${unixExpiry}:F> (<t:${unixExpiry}:R>)`,    inline: false },
                { name: "🛠️ By",         value: `<@${interaction.user.id}>`,                     inline: true  }
              )
              .setColor(SUCCESS_COLOR)
              .setFooter({ text: FOOTER_TEXT })
              .setTimestamp()
          ]
        });
      } catch (err) {
        console.error("❌ modal_changetime_ error:", err.message);
        try {
          const reply = {
            embeds: [
              new EmbedBuilder()
                .setTitle("❌  Unexpected Error")
                .setDescription(`\`${err.message}\`\nPlease try again.`)
                .setColor(ERROR_COLOR)
                .setFooter({ text: FOOTER_TEXT })
            ]
          };
          if (interaction.deferred) {
            await interaction.editReply(reply);
          } else {
            await interaction.reply({ ...reply, ephemeral: true });
          }
        } catch { /* ignore */ }
      }
      return;
    }

    // ===== MODAL: delete key =====
    if (interaction.customId.startsWith("modal_delete_key_")) {
      await interaction.deferReply({ flags: 64 });

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
              { name: "📦 Remaining Stock", value: `\`${newStock}\` keys available`,                 inline: true  },
              { name: "🛠️ Deleted By",      value: `<@${interaction.user.id}>`,                     inline: true  }
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
  return interaction.editReply({ embeds: [embed], components: row ? [row] : [] });
}

async function sendKeyListEdit(interaction, storageId, productId, tierDays, page, perPage) {
  const { embed, row } = await buildKeyListEmbedAndRow(storageId, productId, tierDays, page, perPage);
  return interaction.editReply({ embeds: [embed], components: row ? [row] : [] });
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
