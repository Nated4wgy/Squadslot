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

function dateAfter(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function main() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const origin = `https://127.0.0.1:${port}`;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "squadslot-features-"));
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DATABASE_PATH: path.join(tempDir, "squadslot.db"),
      SESSION_SECRET: "feature-smoke-secret-123456789012345"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  async function waitForHealth() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Server exited early.\n${output}`);
      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.ok) return;
      } catch {
        // Starting.
      }
      await delay(150);
    }
    throw new Error(`Server did not start.\n${output}`);
  }

  async function request(route, cookie, options = {}) {
    const response = await fetch(`${baseUrl}${route}`, {
      ...options,
      headers: {
        Origin: origin,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(options.headers || {})
      }
    });
    const payload = response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : await response.text();
    return {
      response,
      payload,
      cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie
    };
  }

  try {
    await waitForHealth();
    let result = await request("/api/auth/register", "", {
      method: "POST",
      body: JSON.stringify({ username: "admin", displayName: "Admin", password: "password123" })
    });
    assert(result.response.status === 201, "Admin registration failed.");
    const adminCookie = result.cookie;
    const adminId = result.payload.user.id;

    result = await request("/api/profile", adminCookie, {
      method: "PUT",
      body: JSON.stringify({
        displayName: "Admin",
        avatarUrl: "",
        timezone: "Europe/London",
        favoriteGames: "Deep Rock Galactic",
        preferredStart: "19:00",
        preferredEnd: "23:00",
        profileColor: "#2fd3ba",
        theme: "dark",
        accent: "#2fd3ba",
        discordUsername: "admin"
      })
    });
    assert(result.response.ok && result.payload.profile.favoriteGames.includes("Deep Rock"), "Profile save failed.");

    result = await request("/api/auth/register", "", {
      method: "POST",
      body: JSON.stringify({ username: "friend", displayName: "Friend", password: "password123" })
    });
    assert(result.response.status === 201, "Friend registration failed.");
    const friendCookie = result.cookie;
    const friendId = result.payload.user.id;
    const freeDate = dateAfter(1);
    const eventDate = dateAfter(2);

    for (const [cookie, note] of [[adminCookie, "Admin free"], [friendCookie, "Friend free"]]) {
      result = await request("/api/availability", cookie, {
        method: "POST",
        body: JSON.stringify({ date: freeDate, startTime: "19:00", endTime: "22:00", note })
      });
      assert(result.response.status === 201, "Availability creation failed.");
    }

    result = await request("/api/availability/best-times", adminCookie, { method: "GET" });
    assert(result.response.ok && result.payload.slots.some((slot) => slot.count === 2), "Best-time overlap was not calculated.");

    result = await request("/api/availability/recurring", adminCookie, {
      method: "POST",
      body: JSON.stringify({ weekdays: [1, 3, 5], startTime: "19:00", endTime: "23:00", startDate: freeDate, endDate: "", note: "Multi-day schedule" })
    });
    assert(result.response.status === 201 && result.payload.ids.length === 3, "Multi-day recurring availability creation failed.");

    result = await request("/api/availability/recurring", adminCookie);
    assert(
      result.response.ok && [1, 3, 5].every((weekday) => result.payload.rules.some((rule) => rule.weekday === weekday)),
      "Multi-day recurring rules were not returned."
    );

    result = await request("/api/availability/presets", adminCookie, {
      method: "POST",
      body: JSON.stringify({ name: "Friday evening", weekday: 5, startTime: "19:00", endTime: "23:00", note: "" })
    });
    assert(result.response.status === 201, "Availability preset creation failed.");

    result = await request("/api/events", adminCookie, {
      method: "POST",
      body: JSON.stringify({
        title: "Feature test session",
        date: eventDate,
        startTime: "20:00",
        endTime: "22:00",
        notes: "Bring the mod pack",
        minPlayers: 2,
        maxPlayers: 4,
        inviteIds: [friendId],
        gameOptions: [
          { steamAppId: 548430, title: "Deep Rock Galactic", imageUrl: "" },
          { steamAppId: 892970, title: "Valheim", imageUrl: "" }
        ],
        steamAppId: 548430,
        gameTitle: "Deep Rock Galactic"
      })
    });
    assert(result.response.status === 201, "Event creation failed.");
    const eventId = result.payload.id;

    result = await request(`/api/events/${eventId}/invites/me`, friendCookie, {
      method: "PATCH",
      body: JSON.stringify({ status: "accepted" })
    });
    assert(result.response.ok, "Invite acceptance failed.");

    result = await request("/api/events", friendCookie);
    const event = result.payload.events.find((item) => item.id === eventId);
    assert(event.ready && event.gameOptions.length === 2, "Capacity or game options were not returned.");

    result = await request(`/api/events/${eventId}/votes`, friendCookie, {
      method: "POST",
      body: JSON.stringify({ optionId: event.gameOptions[1].id })
    });
    assert(result.response.ok, "Game vote failed.");

    result = await request(`/api/events/${eventId}/comments`, friendCookie, {
      method: "POST",
      body: JSON.stringify({ body: "I have the server files." })
    });
    assert(result.response.status === 201, "Event comment failed.");

    result = await request(`/api/events/${eventId}/games/randomize`, adminCookie, {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(result.response.ok && result.payload.chosen, "Game random selection failed.");

    result = await request(`/api/events/${eventId}/ics`, friendCookie);
    assert(result.response.ok && result.payload.includes("BEGIN:VEVENT"), "ICS export failed.");

    result = await request("/api/dashboard", adminCookie);
    assert(result.response.ok && result.payload.dashboard.nextEvent.id === eventId, "Dashboard next event failed.");

    result = await request("/api/admin/reminders", adminCookie, {
      method: "PUT",
      body: JSON.stringify({
        reminders: {
          eventTomorrow: true,
          eventStartingSoon: true,
          rsvpDeadline: true,
          weeklySummary: true,
          weeklyDay: 1,
          weeklyTime: "09:00"
        }
      })
    });
    assert(result.response.ok, "Reminder settings failed.");

    result = await request("/service-worker.js", "");
    assert(
      result.response.ok
      && result.payload.includes("requestUrl.origin !== self.location.origin")
      && !result.payload.includes("cached || caches.match"),
      "Service worker must not replace external Steam images with the app shell."
    );

    assert(adminId !== friendId, "Test users should be distinct.");
    console.log("Feature smoke test passed.");
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
