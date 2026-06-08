import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, child, output) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    assert(child.exitCode === null, `Server exited early.\n${output.text}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for server health.\n${output.text}`);
}

async function main() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const origin = `https://127.0.0.1:${port}`;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "squadslot-admin-test-"));
  const output = { text: "" };
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DATABASE_PATH: path.join(tempDir, "squadslot.db"),
      SESSION_SECRET: "admin-settings-smoke-secret-1234567890"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    output.text += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output.text += chunk.toString();
  });

  let cookie = "";

  async function request(route, options = {}) {
    const headers = {
      Origin: origin,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {})
    };
    const response = await fetch(`${baseUrl}${route}`, { ...options, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }

  try {
    await waitForHealth(baseUrl, child, output);

    let result = await request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username: "admin", displayName: "Admin", password: "password123" })
    });
    assert(result.response.status === 201, `Admin registration failed: ${JSON.stringify(result.payload)}`);
    assert(cookie.includes("squadslot_session="), "Registration did not set a session cookie.");

    const webhookUrl = "https://discord.com/api/webhooks/123456789012345678/fake-token";
    result = await request("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        appUrl: "https://calendar.example.test",
        discordWebhookUrl: webhookUrl,
        discordBotName: "SquadSlot Test"
      })
    });
    assert(result.response.ok, `Saving Discord settings failed: ${JSON.stringify(result.payload)}`);

    result = await request("/api/admin/settings");
    assert(result.payload.settings.discordWebhookUrl === webhookUrl, "Saved webhook URL was not returned.");
    assert(result.payload.settings.discordBotName === "SquadSlot Test", "Saved bot name was not returned.");

    result = await request("/api/admin/notifications");
    assert(result.response.ok, `Loading notification rules failed: ${JSON.stringify(result.payload)}`);
    const changedNotifications = result.payload.notifications.map((notification) => (
      notification.type === "availabilityAdded"
        ? { ...notification, enabled: false, title: "Free time changed", message: "{actor} can play on {date}." }
        : notification
    ));

    result = await request("/api/admin/notifications", {
      method: "PUT",
      body: JSON.stringify({ notifications: changedNotifications })
    });
    assert(result.response.ok, `Saving notification rules failed: ${JSON.stringify(result.payload)}`);

    result = await request("/api/admin/notifications");
    const availabilityRule = result.payload.notifications.find((notification) => notification.type === "availabilityAdded");
    assert(availabilityRule.enabled === false, "Notification enabled flag was not saved.");
    assert(availabilityRule.title === "Free time changed", "Notification title template was not saved.");
    assert(availabilityRule.message === "{actor} can play on {date}.", "Notification message template was not saved.");

    result = await request("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        appUrl: "https://calendar.example.test",
        discordWebhookUrl: "https://example.com/not-a-discord-webhook",
        discordBotName: "SquadSlot Test"
      })
    });
    assert(result.response.status === 400, "Invalid Discord webhook URL should be rejected.");

    console.log("Admin settings smoke test passed.");
  } finally {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
    });
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
