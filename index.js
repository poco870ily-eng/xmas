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
  ApplicationCommandOptionType
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
const GUILD_ID            = process.env.GUILD_ID; // ID твоего Discord сервера для быстрой регистрации команд

// ===== ROLE NAMES =====
const ROLE_ACCESS      = "Pay Access";
const ROLE_ACCESS_PLUS = "Pay Access+";

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
    name: "help",
    description: "📖 Show all available commands"
  },
  {
    name: "viewadmins",
    description: "🔍 [Owner] Debug — list all users with Pay Access / Pay Access+ roles",
    dm_permission: false,
    default_member_permissions: "0" // Только владелец сервера
  },
  {
    name: "forceadd",
    description: "🔧 [Pay Access] Manually add balance to a user",
    dm_permission: false, // Только на сервере, не в DM
    // Убрали default_member_permissions — команда видна ВСЕМ
    // Проверка прав происходит в коде
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
  }
];

// ===== REGISTER COMMANDS ON READY =====
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  try {
    console.log("🔄 Registering slash commands...");
    
    if (GUILD_ID) {
      // Регистрация для конкретного сервера (мгновенно)
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: SLASH_COMMANDS }
      );
      console.log(`✅ Slash commands registered for guild ${GUILD_ID}!`);
    } else {
      // Глобальная регистрация (может занять до 1 часа)
      await rest.put(
        Routes.applicationCommands(CLIENT_ID), 
        { body: SLASH_COMMANDS }
      );
      console.log("✅ Slash commands registered globally!");
    }
  } catch (err) {
    console.error("❌ Failed to register slash commands:", err);
  }

  client.user.setPresence({
    activities: [{ name: "💳 /pay  |  /balance  |  /help", type: 0 }],
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

    console.log(`[DEBUG] Guild "${guild.name}" — role "${role.name}" has ${role.members.size} member(s)`);

    for (const [, member] of role.members) {
      if (seen.has(member.id)) continue;
      seen.add(member.id);
      users.push(member.user);
    }
  }

  return users;
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
  BTC:  { emoji: "₿", name: "Bitcoin",       color: 0xF7931A },
  LTC:  { emoji: "Ł", name: "Litecoin",       color: 0xBFBBBB },
  ETH:  { emoji: "Ξ", name: "Ethereum",       color: 0x627EEA },
  USDT: { emoji: "₮", name: "Tether (TRC20)", color: 0x26A17B },
  SOL:  { emoji: "◎", name: "Solana",         color: 0x9945FF }
};

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

const FOOTER_TEXT = "⚡ Powered by NOWPayments • Instant Crypto Processing";

// ===== EMBEDS =====
function buildMainMenuEmbed() {
  return new EmbedBuilder()
    .setTitle("🏦  Crypto Payment Bot")
    .setDescription(
      "**Secure · Instant · Anonymous**\n" +
      "```\nTop up your balance using cryptocurrency\n```"
    )
    .addFields(
      {
        name: "💳  Payments",
        value: "`/pay` — Start a crypto top-up\n`/balance` — Check your balance",
        inline: true
      },
      {
        name: "🔧  Staff",
        value: "`/forceadd` — Add balance to a user\n`/help` — Show this menu",
        inline: true
      },
      {
        name: "🪙  Supported Currencies",
        value: Object.entries(CURRENCIES)
          .map(([code, c]) => `${c.emoji} **${code}** — ${c.name}`)
          .join("\n"),
        inline: false
      },
      {
        name: "🔑  Access Roles",
        value:
          `**${ROLE_ACCESS}** — Can use \`/forceadd\`\n` +
          `**${ROLE_ACCESS_PLUS}** — \`/forceadd\` + receives payment notifications`,
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

function buildPaymentEmbed(payment, currency) {
  const cur = CURRENCIES[currency] || { emoji: "🪙", name: currency, color: BRAND_COLOR };
  return new EmbedBuilder()
    .setTitle(`${cur.emoji}  Payment Invoice — ${cur.name}`)
    .setDescription(
      `> Send the **exact amount** below to complete your top-up.\n` +
      `> ⚠️ Only send **${currency}** — other coins will be lost.`
    )
    .addFields(
      {
        name: "📬  Deposit Address",
        value: payment.pay_address
          ? `\`\`\`\n${payment.pay_address}\n\`\`\``
          : "`Address pending...`"
      },
      { name: "💸  Amount",    value: `\`${payment.pay_amount} ${payment.pay_currency}\``, inline: true },
      { name: "💵  USD Value", value: `\`${payment.price_amount} USD\``,                   inline: true },
      {
        name: "⏱️  Expires",
        value: payment.expiration_estimate_date
          ? `<t:${Math.floor(new Date(payment.expiration_estimate_date).getTime() / 1000)}:R>`
          : "`~20 minutes`",
        inline: true
      },
      { name: "🔑  Payment ID", value: `\`${payment.payment_id}\``, inline: false }
    )
    .setColor(cur.color)
    .setFooter({ text: "📬 You'll receive a DM when payment is confirmed" })
    .setTimestamp();
}

function buildForceAddEmbed(targetUser, amount, newBalance, executedBy) {
  return new EmbedBuilder()
    .setTitle("🔧  Manual Balance Credit")
    .setDescription(`Balance credited to **@${targetUser.username}** by **@${executedBy.username}**`)
    .addFields(
      { name: "➕  Amount Added", value: `\`+${amount.toFixed(2)} USD\``,    inline: true  },
      { name: "💰  New Balance",  value: `\`${newBalance.toFixed(2)} USD\``,  inline: true  },
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
    desc: "> Your payment has been created. Send the exact amount to proceed."
  },
  confirming: {
    color: BRAND_COLOR, icon: "🔄", title: "Confirming Transaction",
    desc: "> Your payment has been detected on the network and is being confirmed."
  },
  confirmed: {
    color: 0x1ABC9C, icon: "💚", title: "Transaction Confirmed",
    desc: "> Your payment is confirmed. Waiting for final processing."
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

function buildAmountRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("amt_5").setLabel("$5").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("amt_10").setLabel("$10").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("amt_25").setLabel("$25").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("amt_50").setLabel("$50").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("amt_custom").setLabel("✏️ Custom").setStyle(ButtonStyle.Success)
  );
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
        new ButtonBuilder().setCustomId("btn_balance").setLabel("💰  Balance").setStyle(ButtonStyle.Primary)
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

    // /viewadmins — owner-only debug
    if (commandName === "viewadmins") {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⛔  Access Denied")
              .setDescription("This debug command is restricted to the **bot owner** only.")
              .setColor(ERROR_COLOR)
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

        console.log(
          `[DEBUG /viewadmins] Guild: "${guild.name}" | All roles:`,
          guild.roles.cache.map(r => `"${r.name}" (${r.id})`).join(", ")
        );
        console.log(
          `[DEBUG /viewadmins] roleBasic: ${roleBasic?.name ?? "NOT FOUND"} | rolePlus: ${rolePlus?.name ?? "NOT FOUND"}`
        );

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
            name: `🔑  ${ROLE_ACCESS} (${basicUsers.length})`,
            value: formatList(basicUsers),
            inline: false
          },
          {
            name: `👑  ${ROLE_ACCESS_PLUS} (${plusUsers.length})`,
            value: formatList(plusUsers),
            inline: false
          }
        )
        .setColor(0x3498DB)
        .setFooter({ text: `Owner debug • ${FOOTER_TEXT}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // /forceadd — requires Pay Access or Pay Access+
    if (commandName === "forceadd") {
      await interaction.deferReply({ ephemeral: true });

      const tier = await getAccessTier(interaction.user.id);

      if (!tier) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⛔  Access Denied")
              .setDescription(
                `This command requires the **${ROLE_ACCESS}** or **${ROLE_ACCESS_PLUS}** role.`
              )
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
          ]
        });
      }

      await interaction.editReply({
        embeds: [buildForceAddEmbed(targetUser, amount, newBalance, interaction.user)]
      });

      // DM the credited user
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
  if (interaction.isStringSelectMenu() && interaction.customId === "pay_currency") {
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

  // ──────────── MODAL SUBMITS ────────────
  if (interaction.isModalSubmit() && interaction.customId === "modal_custom_amount") {
    const userId  = interaction.user.id;
    const pending = pendingPayments.get(userId);
    if (!pending) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⚠️  Session Expired")
            .setDescription("Your session timed out. Please use `/pay` to start again.")
            .setColor(WARNING_COLOR)
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
        ],
        ephemeral: true
      });
    }

    pending.amount = amount;
    pendingPayments.set(userId, pending);
    await interaction.deferReply({ ephemeral: true });
    await processPayment(interaction, userId, amount, pending.currency);
  }
});

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
      );

    if (!success) embed.setDescription("❌ DB write error — check server logs.");
    return message.reply({ embeds: [embed] });
  }
});

// ===== PROCESS PAYMENT =====
async function processPayment(interaction, userId, amount, currency) {
  try {
    const payment = await createPayment(userId, amount, currency);
    const embed   = buildPaymentEmbed(payment, currency);

    try {
      const user = await client.users.fetch(userId);
      await user.send({ embeds: [embed] });
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

    const embed = new EmbedBuilder()
      .setTitle(`${cfg.icon}  ${cfg.title}`)
      .setDescription(cfg.desc)
      .setColor(cfg.color)
      .setFooter({ text: `Payment ID: ${payment_id} • ${FOOTER_TEXT}` })
      .setTimestamp();

    if (status === "finished") {
      const success    = await addBalance(userId, amount);
      const newBalance = await getBalance(userId);

      embed.addFields(
        { name: "➕ Amount Added", value: `\`+${amount.toFixed(2)} USD\``,    inline: true },
        { name: "💰 New Balance",  value: `\`${newBalance.toFixed(2)} USD\``, inline: true }
      );

      if (!success) {
        embed.setColor(ERROR_COLOR)
             .setTitle("⚠️  Payment OK — Balance Update Failed")
             .setDescription("Payment received but balance update failed. Contact support.");
      }

      const payerUser = await client.users.fetch(userId).catch(() => null);
      if (payerUser) {
        await payerUser.send({ embeds: [embed] }).catch(() => {});
      }

      if (success && payerUser) {
        const notifyEmbed = buildPaymentNotifyEmbed(payerUser, amount, newBalance, payment_id);
        const plusUsers   = await getAccessPlusUsers();

        let notified = 0;
        for (const user of plusUsers) {
          if (user.id === userId) continue;
          try {
            await user.send({ embeds: [notifyEmbed] });
            notified++;
          } catch {
            console.log(`⚠️ Could not DM Pay Access+ user ${user.tag}`);
          }
        }
        console.log(`📣 Notified ${notified} Pay Access+ member(s) about payment by ${payerUser.tag}`);
      }

    } else {
      if (["waiting", "confirming", "confirmed"].includes(status)) {
        embed.addFields(
          { name: "💵 Amount",   value: `\`${amount} USD\``,  inline: true },
          { name: "🪙 Currency", value: `\`${pay_currency}\``, inline: true }
        );
      }

      const user = await client.users.fetch(userId).catch(() => null);
      if (user) await user.send({ embeds: [embed] }).catch(() => {});
    }

  } catch (err) {
    console.error("❌ Webhook processing error:", err.message);
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`🌐 Webhook server on port ${PORT}`));
client.login(DISCORD_TOKEN);
