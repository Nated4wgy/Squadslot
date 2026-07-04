import { getSetting } from "./db.js";

export function isValidDiscordWebhookUrl(value) {
  if (!value) return true;

  try {
    const url = new URL(value);
    const allowedHosts = new Set(["discord.com", "discordapp.com"]);
    return url.protocol === "https:" && allowedHosts.has(url.hostname) && url.pathname.startsWith("/api/webhooks/");
  } catch {
    return false;
  }
}

function getWebhookUrl() {
  const value = getSetting("discordWebhookUrl", process.env.DISCORD_WEBHOOK_URL || "");
  return isValidDiscordWebhookUrl(value) ? value : "";
}

function getWebhookName() {
  return getSetting("discordBotName", process.env.DISCORD_BOT_NAME || "SquadSlot");
}

function getAppUrl() {
  return getSetting("appUrl", process.env.APP_URL || "http://localhost:8080");
}

function getBotConfig() {
  return {
    token: getSetting("discordBotToken", process.env.DISCORD_BOT_TOKEN || ""),
    channelId: getSetting("discordChannelId", process.env.DISCORD_CHANNEL_ID || "")
  };
}

export function discordConfigured() {
  return Boolean(getWebhookUrl());
}

export async function postDiscordUpdate({ title, description, fields = [], color = 0x2fd3ba, components = [] }) {
  const bot = getBotConfig();
  const useBot = Boolean(bot.token && bot.channelId);
  if (!useBot && !discordConfigured()) return { sent: false, skipped: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  const response = await fetch(
    useBot ? `https://discord.com/api/v10/channels/${bot.channelId}/messages` : getWebhookUrl(),
    {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(useBot ? { Authorization: `Bot ${bot.token}` } : {})
    },
    signal: controller.signal,
    body: JSON.stringify({
      ...(!useBot ? { username: getWebhookName() } : {}),
      embeds: [
        {
          title,
          description,
          color,
          fields: [
            ...fields,
            { name: "Open calendar", value: getAppUrl(), inline: false }
          ],
          timestamp: new Date().toISOString()
        }
      ],
      ...(useBot && components.length ? { components } : {})
    })
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Discord message failed with ${response.status}`);
  }

  return { sent: true, skipped: false };
}
