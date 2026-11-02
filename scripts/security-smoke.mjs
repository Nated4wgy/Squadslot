import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { asyncRoute, dateRange, isDateString, validNewPassword } from "../server/validation.js";
import { eventHasEnded } from "../src/event-time.js";

assert(!eventHasEnded({ date: "2035-01-01", endTime: "00:30", endsAtUtc: "2035-01-02T00:30:00Z" }, new Date("2035-01-01T23:30:00Z")), "An event crossing midnight must remain visible until its actual UTC end");

assert(!isDateString("2030-02-30"));
assert(isDateString("2032-02-29"));
assert.throws(() => dateRange({ start: "0001-01-01", end: "9999-12-31" }, "2030-01-01", 6));
assert(!validNewPassword("a".repeat(73)));
assert(!validNewPassword("\u00e9".repeat(37)));
assert(validNewPassword("a".repeat(72)));
const failure = new Error("Rejected handler");
let caught;
await asyncRoute(async () => { throw failure; })({}, {}, (error) => { caught = error; });
assert.equal(caught, failure);

const temp = await mkdtemp(path.join(os.tmpdir(), "squadslot-security-"));
const database = path.join(temp, "test.db");
const secret = "security-regression-secret-123456789012345";
process.env.DATABASE_PATH = database;
process.env.SESSION_SECRET = secret;
const { createSessionCookie, readSessionCookie } = await import("../server/auth.js");
const cookieRequest = (token) => ({ cookies: { squadslot_session: token } });
assert.equal(readSessionCookie(cookieRequest(createSessionCookie(1))).userId, 1);
assert.equal(readSessionCookie(cookieRequest(`${createSessionCookie(1)}.extra`)), null);
function signed(payload) {
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${value}.${crypto.createHmac("sha256", secret).update(value).digest("base64url")}`;
}
assert.equal(readSessionCookie(cookieRequest(signed({ userId: 1 }))), null);
assert.equal(readSessionCookie(cookieRequest(signed({ userId: 1, exp: Date.now() - 1 }))), null);

const listener = net.createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server/index.js"], {
  env: { ...process.env, NODE_ENV: "production", PORT: String(port), TRUST_PROXY: "0",
    APP_URL: base, BACKUP_ENCRYPTION_KEY: "security-backup-key-123456789", AUTO_BACKUP_ENABLED: "false", DISCORD_WEBHOOK_URL: "", DISCORD_BOT_TOKEN: "" },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
let db;
async function request(route, cookie = "", data, method = data === undefined ? "GET" : "POST", headers = {}) {
  const response = await fetch(`${base}${route}`, {
    method, headers: { Origin: base, "Content-Type": "application/json", Cookie: cookie, ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  return { response, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie };
}
try {
  let healthy = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await fetch(`${base}/api/health`)).ok) { healthy = true; break; } } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(healthy, output);
  const admin = await request("/api/auth/register", "", { username: "admin", password: "Password123!" });
  async function approvedAccount(username) {
    assert.equal((await request("/api/auth/register", "", { username, password: "Password123!" })).response.status, 202);
    const accounts = (await request("/api/admin/users", admin.cookie)).body.users;
    const pending = accounts.find((account) => account.username === username);
    assert.equal((await request(`/api/admin/users/${pending.id}/approval`, admin.cookie, { decision: "approve" })).response.status, 200);
    return request("/api/auth/login", "", { username, password: "Password123!" });
  }
  const member = await approvedAccount("member");
  const outsider = await approvedAccount("outsider");
  assert.equal(admin.response.status, 201);
  let adminCookie = admin.cookie;
  assert.equal((await request("/api/auth/register", "", { username: "longpassword", password: "a".repeat(73) })).response.status, 400);
  assert.equal((await request("/api/admin/backup", member.cookie)).response.status, 403);
  assert.equal((await request("/api/events", member.cookie)).response.headers.get("cache-control"), "no-store");
  assert.equal((await request("/api/availability", member.cookie, { date: "2030-02-30", startTime: "19:00", endTime: "21:00" })).response.status, 400);
  for (const route of ["/api/availability", "/api/availability/best-times"]) {
    for (const query of ["start=0001-01-01&end=9999-12-31", "start=2030-02-30", "start=2030-02-01&end=2030-01-01", "start[]=2030-01-01"]) {
      assert.equal((await request(`${route}?${query}`, member.cookie)).response.status, 400, `${route}?${query}`);
    }
  }
  assert.equal((await request("/api/groups", member.cookie, { name: "Spoofed" }, "POST", {
    Origin: "https://attacker.invalid", "X-Forwarded-Host": "attacker.invalid", "X-Forwarded-Proto": "https"
  })).response.status, 403, "Untrusted forwarded headers must not bypass origin checks");
  const malformed = await fetch(`${base}/api/events`, { method: "POST", headers: { Origin: base, Cookie: adminCookie, "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await request("/api/events", adminCookie, { gameOptions: [null] })).response.status, 400);
  assert.equal((await request("/api/health")).response.status, 200, "Malformed async input must not terminate the process");

  const proposal = await request("/api/proposals", adminCookie, {
    title: "Private vote", slots: [{ date: "2035-01-10", startTime: "19:00", endTime: "21:00" }], inviteIds: [member.body.user.id]
  });
  const proposals = await request("/api/proposals", adminCookie);
  const slotId = proposals.body.proposals.find((item) => item.id === proposal.body.id).slots[0].id;
  assert.equal((await request(`/api/proposals/${proposal.body.id}/vote`, outsider.cookie, { slotId }, "PUT")).response.status, 403);
  assert.equal((await request(`/api/proposals/${proposal.body.id}/vote`, member.cookie, { slotId }, "PUT")).response.status, 200);

  ({ db } = await import("../server/db.js"));
  const { eventsToIcs, findBestSlots, runReminderSweep } = await import("../server/scheduling.js");
  const groupId = db.prepare("SELECT active_group_id AS id FROM users WHERE id = ?").get(admin.body.user.id).id;
  const options = [
    { date: "2035-02-02", startTime: "10:15", endTime: "11:30", userId: 1, displayName: "Alex" },
    { date: "2035-02-02", startTime: "10:45", endTime: "11:15", userId: 2, displayName: "Jamie" }
  ];
  const best = findBestSlots("2035-02-02", "2035-02-02", options, groupId);
  assert.equal(best[0].count, 2);
  assert.equal(best[0].startTime, "10:45");
  assert.equal(best[0].endTime, "11:15");
  const maliciousTitle = `Title\rBEGIN:VEVENT\n${"\u00e9".repeat(100)}`;
  const ics = eventsToIcs([{ id: 1, date: "2035-02-02", startTime: "19:00", endTime: "20:00", title: maliciousTitle }]);
  assert.equal(ics.match(/^BEGIN:VEVENT$/gm)?.length, 1);
  assert(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
  assert(ics.replace(/\r\n /g, "").includes("\u00e9".repeat(100)));

  const keys = crypto.generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  await request("/api/admin/settings", adminCookie, { appUrl: "https://calendar.example.com", discordPublicKey: publicKey }, "PUT");
  const subscription = await request("/api/calendar/subscription", adminCookie, {});
  assert(subscription.body.subscription.httpsUrl.startsWith("https://calendar.example.com/"), "Saved public URL must override environment default");
  const discordId = "123456789012345678";
  const memberProfile = { ...member.body.user, discordUserId: discordId };
  assert.equal((await request("/api/profile", member.cookie, memberProfile, "PUT")).response.status, 200);
  assert.equal((await request("/api/profile", outsider.cookie, { ...outsider.body.user, discordUserId: discordId }, "PUT")).response.status, 409);
  const event = await request("/api/events", adminCookie, {
    title: "Full session", date: "2035-02-02", startTime: "19:00", endTime: "21:00", minPlayers: 2, maxPlayers: 2, inviteIds: [member.body.user.id]
  });
  assert.equal(event.response.status, 201);
  let reminderCount = 0;
  const sendReminder = async () => {
    reminderCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { sent: true };
  };
  await Promise.all([
    runReminderSweep(sendReminder, new Date("2035-02-01T19:00:00Z")),
    runReminderSweep(sendReminder, new Date("2035-02-01T19:00:00Z"))
  ]);
  assert.equal(reminderCount, 1, "Overlapping reminder sweeps must not send duplicate notifications");
  async function discord(status, timestamp = String(Math.floor(Date.now() / 1000))) {
    const body = JSON.stringify({ type: 3, member: { user: { id: discordId } }, data: { custom_id: `event:${event.body.id}:${status}` } });
    const signature = crypto.sign(null, Buffer.from(timestamp + body), keys.privateKey).toString("hex");
    return fetch(`${base}/discord/interactions`, { method: "POST", headers: { "Content-Type": "application/json", "x-signature-ed25519": signature, "x-signature-timestamp": timestamp }, body });
  }
  assert.equal((await discord("accepted")).status, 200);
  assert.equal((await discord("accepted")).status, 200);
  assert.equal(db.prepare("SELECT status FROM event_invites WHERE event_id = ? AND user_id = ?").get(event.body.id, member.body.user.id).status, "accepted");
  assert.equal((await discord("declined", "1000000000")).status, 401, "Old signed interactions must not be replayable");
  await request(`/api/admin/users/${member.body.user.id}/password`, adminCookie, { temporaryPassword: "Temporary123!" }, "PUT");
  assert((await (await discord("declined")).json()).data.content.includes("temporary password"));
  assert.equal(db.prepare("SELECT status FROM event_invites WHERE event_id = ? AND user_id = ?").get(event.body.id, member.body.user.id).status, "accepted");

  const backup = (await request("/api/admin/backup", adminCookie)).body;
  for (let repeat = 0; repeat < 2; repeat += 1) {
    const oldCookie = adminCookie;
    assert.equal((await request("/api/admin/backup/restore", adminCookie, { backup, confirmRestore: true })).response.status, 200);
    assert.equal((await request("/api/events", oldCookie)).response.status, 401);
    assert.equal((await request("/api/events", admin.cookie)).response.status, 401);
    adminCookie = (await request("/api/auth/login", "", { username: "admin", password: "Password123!" })).cookie;
  }
  const worker = await readFile("public/service-worker.js", "utf8");
  assert(worker.includes('requestUrl.pathname.startsWith("/calendar/")'), "Private calendar feeds must bypass offline cache");
  console.log("Security regression checks passed: dates, permissions, origin checks, sessions, restore, Discord, calendar export and exact overlaps.");
} finally {
  db?.close();
  if (child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  await rm(temp, { recursive: true, force: true });
}
