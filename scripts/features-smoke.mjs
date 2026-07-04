import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";

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
      BACKUP_ENCRYPTION_KEY: "feature-smoke-backup-key-123456",
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
    let friendCookie = result.cookie;
    const friendId = result.payload.user.id;

    result = await request(`/api/admin/users/${friendId}/password`, adminCookie, {
      method: "PUT",
      body: JSON.stringify({ temporaryPassword: "temporary456" })
    });
    assert(result.response.ok && result.payload.mustChangePassword, "Admin password reset failed.");

    result = await request(`/api/admin/users/${adminId}/password`, adminCookie, {
      method: "PUT",
      body: JSON.stringify({ temporaryPassword: "temporary456" })
    });
    assert(result.response.status === 400, "An admin should not reset their own password from account management.");

    result = await request("/api/events", friendCookie);
    assert(result.response.status === 401, "Password reset did not invalidate the user's existing session.");

    result = await request("/api/auth/login", "", {
      method: "POST",
      body: JSON.stringify({ username: "friend", password: "password123" })
    });
    assert(result.response.status === 401, "The previous password still worked after an admin reset.");

    result = await request("/api/auth/login", "", {
      method: "POST",
      body: JSON.stringify({ username: "friend", password: "temporary456" })
    });
    assert(result.response.ok && result.payload.user.mustChangePassword, "Temporary password login did not require a password change.");
    friendCookie = result.cookie;

    result = await request("/api/profile", friendCookie);
    assert(
      result.response.status === 403 && result.payload.code === "PASSWORD_CHANGE_REQUIRED",
      "Temporary-password sessions were not restricted."
    );

    result = await request("/api/me/password", friendCookie, {
      method: "PUT",
      body: JSON.stringify({ currentPassword: "temporary456", newPassword: "replacement789" })
    });
    assert(result.response.ok && !result.payload.user.mustChangePassword, "Forced password change failed.");
    friendCookie = result.cookie;

    result = await request("/api/auth/login", "", {
      method: "POST",
      body: JSON.stringify({ username: "friend", password: "temporary456" })
    });
    assert(result.response.status === 401, "Temporary password still worked after replacement.");

    result = await request("/api/admin/users", adminCookie);
    const resetFriend = result.payload.users.find((account) => account.id === friendId);
    assert(resetFriend && !resetFriend.mustChangePassword, "Account reset state was not cleared after password replacement.");

    result = await request("/api/friends", adminCookie);
    const publicFriend = result.payload.users.find((account) => account.id === friendId);
    assert(
      publicFriend && !Object.hasOwn(publicFriend, "mustChangePassword"),
      "Password-change state leaked through the friends API."
    );

    const freeDate = dateAfter(1);
    const eventDate = dateAfter(2);
    const recurringDate = dateAfter(8);
    const unrelatedDate = dateAfter(10);

    result = await request("/api/events", adminCookie, {
      method: "POST",
      body: JSON.stringify({
        title: "Expired legacy session",
        date: dateAfter(-1),
        startTime: "19:00",
        endTime: "21:00",
        minPlayers: 2,
        maxPlayers: 4,
        inviteIds: [friendId],
        gameTitle: "Past game"
      })
    });
    assert(result.response.status === 201, "Past-event test setup failed.");
    const pastEventId = result.payload.id;

    result = await request("/api/events", friendCookie);
    assert(!result.payload.events.some((event) => event.id === pastEventId), "Past event remained in the Events response.");

    result = await request("/api/dashboard", friendCookie);
    assert(
      !result.payload.dashboard.pendingInvites.some((event) => event.id === pastEventId),
      "Past invite remained in the Dashboard response."
    );
    result = await request("/api/events/history", adminCookie);
    assert(result.response.ok && result.payload.events.some((event) => event.id === pastEventId), "Past event was missing from history.");

    for (const [cookie, note] of [[adminCookie, "Admin free"], [friendCookie, "Friend free"]]) {
      result = await request("/api/availability", cookie, {
        method: "POST",
        body: JSON.stringify({ date: freeDate, startTime: "19:00", endTime: "22:00", note })
      });
      assert(result.response.status === 201, "Availability creation failed.");
    }

    result = await request("/api/availability", friendCookie, {
      method: "POST",
      body: JSON.stringify({ date: eventDate, startTime: "19:00", endTime: "23:00", note: "Around the event" })
    });
    assert(result.response.status === 201, "Availability around an event failed.");

    result = await request("/api/availability", adminCookie, {
      method: "POST",
      body: JSON.stringify({ date: unrelatedDate, startTime: "18:00", endTime: "20:00", note: "Private unrelated time" })
    });
    assert(result.response.status === 201, "Unrelated availability creation failed.");

    result = await request("/api/availability/recurring", friendCookie, {
      method: "POST",
      body: JSON.stringify({
        weekday: new Date(`${recurringDate}T00:00:00Z`).getUTCDay(),
        startTime: "18:00",
        endTime: "19:00",
        startDate: recurringDate,
        endDate: recurringDate,
        note: "Recurring feed test"
      })
    });
    assert(result.response.status === 201, "Recurring feed availability creation failed.");

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

    result = await request("/api/proposals", adminCookie, {
      method: "POST",
      body: JSON.stringify({
        title: "Proposal test",
        slots: [
          { date: eventDate, startTime: "18:00", endTime: "20:00" },
          { date: eventDate, startTime: "20:00", endTime: "22:00" }
        ],
        games: [{ steamAppId: 548430, title: "Deep Rock Galactic" }, { steamAppId: 892970, title: "Valheim" }],
        inviteIds: [friendId]
      })
    });
    assert(result.response.status === 201, "Proposal creation failed.");
    const proposalId = result.payload.id;
    result = await request("/api/proposals", friendCookie);
    const proposal = result.payload.proposals.find((item) => item.id === proposalId);
    assert(proposal?.slots.length === 2 && proposal.games.length === 2, "Proposal options were not returned.");
    result = await request(`/api/proposals/${proposalId}/vote`, friendCookie, {
      method: "PUT",
      body: JSON.stringify({ slotId: proposal.slots[1].id, gameId: proposal.games[1].id })
    });
    assert(result.response.ok, "Proposal vote failed.");
    result = await request(`/api/proposals/${proposalId}/finalize`, adminCookie, { method: "POST", body: JSON.stringify({}) });
    assert(result.response.status === 201 && result.payload.eventId, "Proposal finalization failed.");

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

    result = await request("/api/events", adminCookie, {
      method: "POST",
      body: JSON.stringify({
        title: "Conflicting session",
        date: eventDate,
        startTime: "21:00",
        endTime: "23:00",
        minPlayers: 1,
        maxPlayers: 3,
        inviteIds: [friendId]
      })
    });
    assert(result.response.status === 201, "Conflict test event creation failed.");
    const conflictEventId = result.payload.id;
    result = await request(`/api/events/${conflictEventId}/invites/me`, friendCookie, {
      method: "PATCH",
      body: JSON.stringify({ status: "accepted" })
    });
    assert(result.response.status === 409 && result.payload.code === "EVENT_CONFLICT", "Overlapping accepted event was not detected.");
    result = await request(`/api/events/${conflictEventId}/invites/me`, friendCookie, {
      method: "PATCH",
      body: JSON.stringify({ status: "accepted", force: true })
    });
    assert(result.response.ok, "Conflict override failed.");
    result = await request(`/api/events/${conflictEventId}/invites/me`, friendCookie, {
      method: "PATCH",
      body: JSON.stringify({ status: "declined" })
    });
    assert(result.response.ok, "Conflict test cleanup failed.");

    result = await request("/api/events", adminCookie, {
      method: "POST",
      body: JSON.stringify({
        title: "Full session",
        date: dateAfter(4),
        startTime: "19:00",
        endTime: "20:00",
        minPlayers: 1,
        maxPlayers: 1,
        inviteIds: [friendId]
      })
    });
    const fullEventId = result.payload.id;
    result = await request(`/api/events/${fullEventId}/invites/me`, friendCookie, {
      method: "PATCH",
      body: JSON.stringify({ status: "accepted" })
    });
    assert(result.response.status === 202 && result.payload.status === "waitlisted", "Full event did not create a waitlist entry.");

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

    result = await request("/api/calendar/subscription", friendCookie, {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(result.response.status === 201 && result.payload.subscription.httpsUrl, "Calendar subscription creation failed.");
    const firstSubscriptionPath = new URL(result.payload.subscription.httpsUrl).pathname;

    result = await request(firstSubscriptionPath, "");
    assert(
      result.response.ok
      && result.payload.includes("METHOD:PUBLISH")
      && result.payload.includes("REFRESH-INTERVAL;VALUE=DURATION:PT15M")
      && result.payload.includes(`UID:squadslot-${eventId}@squadslot`)
      && result.payload.includes("STATUS:CONFIRMED"),
      "Live calendar feed did not include the accepted event."
    );
    assert(
      result.payload.includes("SUMMARY:Free to play")
      && result.payload.includes("SUMMARY:Also free: Admin")
      && result.payload.includes(`DTSTART:${freeDate.replaceAll("-", "")}T190000`)
      && result.payload.includes(`DTSTART:${recurringDate.replaceAll("-", "")}T180000`),
      "Live calendar feed did not include own or overlapping availability."
    );
    assert(
      !result.payload.includes(unrelatedDate.replaceAll("-", "")),
      "Live calendar feed exposed another user's unrelated availability."
    );
    assert(
      result.payload.includes(`DTSTART:${eventDate.replaceAll("-", "")}T190000\r\nDTEND:${eventDate.replaceAll("-", "")}T200000`)
      && result.payload.includes(`DTSTART:${eventDate.replaceAll("-", "")}T220000\r\nDTEND:${eventDate.replaceAll("-", "")}T230000`)
      && !result.payload.includes(`DTSTART:${eventDate.replaceAll("-", "")}T190000\r\nDTEND:${eventDate.replaceAll("-", "")}T230000`),
      "Committed events did not remove their time from calendar availability."
    );

    result = await request("/api/calendar.ics", friendCookie);
    assert(
      result.response.ok
      && result.payload.includes("SUMMARY:Free to play")
      && result.payload.includes("SUMMARY:Also free: Admin")
      && !result.payload.includes(unrelatedDate.replaceAll("-", "")),
      "Downloaded calendar did not apply availability overlap privacy."
    );

    result = await request(`/api/events/${eventId}`, adminCookie, {
      method: "PATCH",
      body: JSON.stringify({ date: eventDate, startTime: "21:00", endTime: "23:00" })
    });
    assert(result.response.ok, "Event reschedule failed.");

    result = await request("/api/events", adminCookie);
    const rescheduled = result.payload.events.find((item) => item.id === eventId);
    const expectedUtcStart = new Date(rescheduled.startsAtUtc).toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");

    result = await request(firstSubscriptionPath, "");
    assert(
      result.response.ok
      && result.payload.includes(`DTSTART:${expectedUtcStart}`)
      && result.payload.includes("LAST-MODIFIED:"),
      "Live calendar feed did not reflect the rescheduled event."
    );

    result = await request("/api/calendar/subscription", friendCookie, {
      method: "POST",
      body: JSON.stringify({})
    });
    assert(result.response.status === 201, "Calendar subscription regeneration failed.");
    const replacementSubscriptionPath = new URL(result.payload.subscription.httpsUrl).pathname;
    result = await request(firstSubscriptionPath, "");
    assert(result.response.status === 404, "Regenerating a calendar subscription did not invalidate the old URL.");
    result = await request(replacementSubscriptionPath, "");
    assert(result.response.ok, "Replacement calendar subscription URL failed.");

    result = await request("/api/calendar/subscription", friendCookie, { method: "DELETE" });
    assert(result.response.ok, "Calendar subscription revocation failed.");
    result = await request(replacementSubscriptionPath, "");
    assert(result.response.status === 404, "Revoked calendar subscription remained accessible.");

    result = await request("/api/dashboard", adminCookie);
    assert(result.response.ok && result.payload.dashboard.nextEvent, "Dashboard next event failed.");

    result = await request(`/api/events/${eventId}/invites/me`, adminCookie, { method: "DELETE" });
    assert(result.response.status === 409, "An event creator should not be able to leave their own event.");

    result = await request(`/api/events/${eventId}/invites/me`, friendCookie, { method: "DELETE" });
    assert(result.response.ok, "Leaving an event failed.");

    result = await request("/api/events", friendCookie);
    const eventAfterLeave = result.payload.events.find((item) => item.id === eventId);
    assert(
      eventAfterLeave
      && !eventAfterLeave.invites.some((invite) => invite.userId === friendId)
      && eventAfterLeave.gameOptions.every((option) => !option.voters.includes(friendId))
      && !eventAfterLeave.ready,
      "Leaving an event did not remove the invite, vote, or ready state."
    );

    result = await request(`/api/events/${eventId}/invites/me`, friendCookie, { method: "DELETE" });
    assert(result.response.status === 404, "Leaving an event twice should report that the user is no longer part of it.");

    result = await request("/api/events", adminCookie);
    assert(result.payload.events.some((item) => item.id === eventId), "A player leaving incorrectly deleted the event.");

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

    result = await request("/api/admin/backup", adminCookie);
    assert(
      result.response.ok
      && result.payload.tables.users.every((account) => (
        Object.hasOwn(account, "mustChangePassword") && Object.hasOwn(account, "sessionVersion")
      )),
      "Backup did not include password reset and session version state."
    );
    const backup = result.payload;
    assert(
      backup.tables.groups.length === 1 && backup.tables.proposals.some((item) => item.id === proposalId),
      "Backup omitted squad or proposal data."
    );

    result = await request("/api/admin/backups/run", adminCookie, { method: "POST", body: JSON.stringify({}) });
    assert(result.response.status === 201 && result.payload.backup.name.endsWith(".json.enc"), "Encrypted backup creation failed.");
    result = await request("/api/admin/backups", adminCookie);
    assert(result.response.ok && result.payload.backups.length === 1 && result.payload.config.encrypted, "Encrypted backup listing failed.");
    result = await request("/api/admin/audit", adminCookie);
    assert(result.response.ok && result.payload.entries.some((entry) => entry.action === "backup.created"), "Backup audit entry was not recorded.");

    result = await request("/api/admin/backup/restore", adminCookie, {
      method: "POST",
      body: JSON.stringify(backup)
    });
    assert(result.response.ok, "Backup restore failed with password reset state.");

    result = await request("/api/groups", adminCookie);
    const originalGroupId = result.payload.activeGroupId;
    result = await request("/api/groups", adminCookie, {
      method: "POST",
      body: JSON.stringify({ name: "Second Squad", timezone: "Europe/London" })
    });
    assert(result.response.status === 201, "Squad creation failed.");
    const secondGroupId = result.payload.id;
    result = await request("/api/events", adminCookie);
    assert(result.response.ok && result.payload.events.length === 0, "Events leaked into a newly created squad.");
    result = await request("/api/groups", adminCookie);
    const secondGroup = result.payload.groups.find((group) => group.id === secondGroupId);
    result = await request("/api/groups/join", friendCookie, {
      method: "POST",
      body: JSON.stringify({ inviteCode: secondGroup.inviteCode })
    });
    assert(result.response.ok, "Joining a squad failed.");
    result = await request("/api/friends", friendCookie);
    assert(result.response.ok && result.payload.users.some((account) => account.id === adminId), "Squad membership did not update the friend list.");
    assert(originalGroupId !== secondGroupId, "Squad IDs should be distinct.");

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
