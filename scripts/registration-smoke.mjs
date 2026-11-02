import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { decryptBackup } from "../server/backup-crypto.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "squadslot-registration-"));
const database = path.join(temp, "test.db");
process.env.SESSION_SECRET = "registration-test-secret-123456789012345";
const { createSessionCookie } = await import("../server/auth.js");
const listener = net.createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
let child;
let db;
let output = "";

async function start() {
  child = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, DATABASE_PATH: database, NODE_ENV: "production", PORT: String(port),
      APP_URL: base, BACKUP_ENCRYPTION_KEY: "registration-backup-key-123456", AUTO_BACKUP_ENABLED: "false", DISCORD_WEBHOOK_URL: "", DISCORD_BOT_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(output || "Registration test server failed to start");
}

async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
}

async function request(route, cookie = "", data, method = data === undefined ? "GET" : "POST") {
  const response = await fetch(`${base}${route}`, {
    method, headers: { Origin: base, "Content-Type": "application/json", Cookie: cookie },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  return { response, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
}
const credentials = (username) => ({ username, displayName: username, password: "Registration123!" });

try {
  await start();
  assert.deepEqual((await request("/api/setup")).body, { hasUsers: false, registrationMode: "approval" });
  const admin = await request("/api/auth/register", "", credentials("admin"));
  assert.equal(admin.response.status, 201);
  assert.equal(admin.body.user.role, "admin");
  let adminCookie = admin.cookie;
  db = new Database(database);
  const row = (username) => db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  const memberCount = (id) => db.prepare("SELECT COUNT(*) AS count FROM group_members WHERE user_id = ?").get(id).count;

  const pending = await request("/api/auth/register", "", { ...credentials("friend"), role: "admin", accountStatus: "approved" });
  assert.equal(pending.response.status, 202);
  assert.equal(pending.body.pendingApproval, true);
  assert.equal(pending.cookie, "");
  assert.equal(pending.body.user, undefined);
  const friendId = row("friend").id;
  assert.equal(row("friend").role, "user");
  assert.equal(row("friend").account_status, "pending");
  assert.equal(memberCount(friendId), 0);
  assert.equal(row("friend").active_group_id, null);
  assert.equal((await request("/api/auth/login", "", credentials("friend"))).response.status, 403);
  const forgedPendingCookie = `squadslot_session=${createSessionCookie(friendId)}`;
  for (const route of ["/api/events", "/api/groups", "/api/admin/users", "/api/availability", "/api/calendar/subscription"]) {
    assert.equal((await request(route, forgedPendingCookie)).response.status, 401, route);
  }
  assert.equal((await request("/api/me", forgedPendingCookie)).body.user, null);
  assert.equal((await request(`/api/admin/users/${friendId}/approval`, forgedPendingCookie, { decision: "approve" })).response.status, 401);
  assert.equal((await request(`/api/admin/users/${friendId}`, adminCookie, { role: "admin" }, "PATCH")).response.status, 409);

  await stop();
  await start();
  assert.equal(memberCount(friendId), 0, "Restart must not add pending accounts to Main Squad");
  assert.equal(row("friend").active_group_id, null);
  assert.equal((await request(`/api/admin/users/${friendId}/approval`, adminCookie, { decision: "approve" })).response.status, 200);
  assert.equal(memberCount(friendId), 1);
  assert.equal((await request("/api/events", forgedPendingCookie)).response.status, 401, "Approval must invalidate any pre-approval token");
  const friend = await request("/api/auth/login", "", credentials("friend"));
  assert.equal(friend.response.status, 200);
  assert.equal((await request("/api/events", friend.cookie)).response.status, 200);
  assert.equal((await request("/api/admin/registration", friend.cookie, { registrationMode: "closed" }, "PUT")).response.status, 403);
  assert.equal((await request(`/api/admin/users/${friendId}/approval`, adminCookie, { decision: "reject" })).response.status, 409, "Rejection cannot delete an approved account");

  await request("/api/auth/register", "", credentials("rejected"));
  const rejectedId = row("rejected").id;
  assert.equal((await request(`/api/admin/users/${rejectedId}/approval`, friend.cookie, { decision: "approve" })).response.status, 403);
  assert.equal((await request(`/api/admin/users/${rejectedId}/approval`, adminCookie, { decision: "reject" })).response.status, 200);
  assert.equal(row("rejected"), undefined);
  await request("/api/auth/register", "", credentials("waiting"));
  const waitingId = row("waiting").id;

  assert.equal((await request("/api/admin/registration", adminCookie, { registrationMode: "open" }, "PUT")).response.status, 400);
  assert.equal((await request("/api/admin/registration", adminCookie, { registrationMode: "closed" }, "PUT")).response.status, 200);
  assert.equal((await request("/api/setup")).body.registrationMode, "closed");
  assert.equal((await request("/api/auth/register", "", credentials("blocked"))).response.status, 403);
  assert.equal(row("blocked"), undefined);
  assert.equal((await request("/api/auth/login", "", credentials("friend"))).response.status, 200);

  const backup = decryptBackup((await request("/api/admin/backup", adminCookie)).body, "registration-backup-key-123456");
  assert.equal(backup.tables.users.find((user) => user.id === waitingId).accountStatus, "pending");
  assert.equal((await request("/api/admin/backup/restore", adminCookie, { backup, confirmRestore: true })).response.status, 200);
  adminCookie = (await request("/api/auth/login", "", credentials("admin"))).cookie;
  assert.equal(row("waiting").account_status, "pending");
  assert.equal(memberCount(waitingId), 0);
  assert.equal((await request("/api/setup")).body.registrationMode, "closed");
  assert.equal((await request("/api/auth/login", "", credentials("waiting"))).response.status, 403);

  // Backups from before approval existed remain compatible, with secure registration defaults.
  const legacy = JSON.parse(JSON.stringify(backup));
  legacy.tables.users = legacy.tables.users.filter((user) => user.accountStatus === "approved");
  for (const user of legacy.tables.users) delete user.accountStatus;
  legacy.tables.settings = legacy.tables.settings.filter((setting) => setting.key !== "registrationMode");
  assert.equal((await request("/api/admin/backup/restore", adminCookie, { backup: legacy, confirmRestore: true })).response.status, 200);
  assert.equal((await request("/api/auth/login", "", credentials("friend"))).response.status, 200);
  assert.equal((await request("/api/setup")).body.registrationMode, "approval");

  // Exercise the actual existing-database column migration too.
  await stop();
  db.exec("DROP TRIGGER IF EXISTS quota_pending_users");
  db.exec("ALTER TABLE users DROP COLUMN account_status");
  await start();
  assert.equal(row("friend").account_status, "approved");
  assert.equal((await request("/api/auth/login", "", credentials("friend"))).response.status, 200);
  assert.equal((await request("/api/auth/register", "", credentials("newrequest"))).response.status, 202);
  console.log("Registration checks passed: bootstrap, approval, rejection, permissions, closed mode, restart, backup and legacy migration.");
} finally {
  await stop();
  db?.close();
  await rm(temp, { recursive: true, force: true });
}
