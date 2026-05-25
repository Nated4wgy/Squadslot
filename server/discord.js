import { getSetting } from "./db.js";

function getWebhookUrl() {
  return getSetting("discordWebhookUrl", process.env.DISCORD_WEBHOOK_URL || "");
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

  const response = await fetch(getWebhookUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed with ${response.status}`);
  }

  return { sent: true, skipped: false };
}
