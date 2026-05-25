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

export function discordConfigured() {
  return Boolean(getWebhookUrl());
}

export async function postDiscordUpdate({ title, description, fields = [], color = 0x2fd3ba }) {
  if (!discordConfigured()) return { sent: false, skipped: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  const response = await fetch(getWebhookUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      username: getWebhookName(),
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
      ]
    })
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Discord webhook failed with ${response.status}`);
  }

  return { sent: true, skipped: false };
}
