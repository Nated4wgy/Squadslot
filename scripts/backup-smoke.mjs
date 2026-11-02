/* global structuredClone */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { backupEncryptionReady, decryptBackup, encryptBackup } from "../server/backup-crypto.js";

const secret = "backup-test-key-12345678901234567890";
const sample = { app: "SquadSlot", version: 1, tables: { users: [] } };
const encrypted = JSON.parse(encryptBackup(sample, secret));
assert.equal(encrypted.version, 2);
assert.deepEqual(decryptBackup(encrypted, secret), sample);
assert.notEqual(JSON.parse(encryptBackup(sample, secret)).salt, encrypted.salt);
assert(!backupEncryptionReady(" ".repeat(32)));
assert.throws(() => encryptBackup(sample, "short"));
assert.throws(() => decryptBackup(encrypted, "wrong-key-123456789012345"));
assert.throws(() => decryptBackup(encrypted, ""));
for (const patch of [
  { version: 3 }, { algorithm: "aes-128-gcm" }, { kdf: "unknown" },
  { iv: "bad" }, { salt: "bad" }, { tag: Buffer.alloc(4).toString("base64") },
  { data: "!" }, { data: Buffer.from("tampered").toString("base64") }
]) assert.throws(() => decryptBackup({ ...encrypted, ...patch }, secret));
function legacyEnvelope(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", crypto.scryptSync(secret, "squadslot-backup-v1", 32), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { format: encrypted.format, version: 1, algorithm: encrypted.algorithm,
    iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}
assert.deepEqual(decryptBackup(legacyEnvelope(sample), secret), sample);

const temp = await mkdtemp(path.join(os.tmpdir(), "squadslot-backup-"));
const listener = net.createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
let child;
let output = "";
let cookie = "";
const credentials = { username: "admin", password: "BackupTest123!" };
async function start(key = secret) {
  child = spawn(process.execPath, ["server/index.js"], { env: {
    ...process.env, DATABASE_PATH: path.join(temp, "test.db"), BACKUP_DIR: path.join(temp, "backups"),
    SESSION_SECRET: "backup-session-test-secret-123456789012345", NODE_ENV: "production", PORT: String(port),
    APP_URL: base, BACKUP_ENCRYPTION_KEY: key, AUTO_BACKUP_ENABLED: "false", BACKUP_RETENTION: "2",
    DISCORD_WEBHOOK_URL: "", DISCORD_BOT_TOKEN: ""
  }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(output || "Backup test server failed to start");
}
async function stop() {
  if (child?.exitCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
}
async function request(route, data, session = cookie) {
  const response = await fetch(`${base}${route}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { Origin: base, "Content-Type": "application/json", Cookie: session },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  return { response, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
async function login() { cookie = (await request("/api/auth/login", credentials, "")).cookie; assert(cookie); }
async function restore(backup, revokeCalendarLinks) {
  return request("/api/admin/backup/restore", { backup, confirmRestore: true, ...(revokeCalendarLinks === undefined ? {} : { revokeCalendarLinks }) });
}
try {
  await start();
  cookie = (await request("/api/auth/register", credentials, "")).cookie;
  assert(cookie);
  assert.equal((await request("/api/admin/backup", undefined, "")).response.status, 401);
  await request("/api/auth/register", { username: "member", password: "BackupTest123!" }, "");
  const memberId = (await request("/api/admin/users")).body.users.find(user => user.username === "member").id;
  await request(`/api/admin/users/${memberId}/approval`, { decision: "approve" });
  const member = (await request("/api/auth/login", { username: "member", password: "BackupTest123!" }, "")).cookie;
  assert.equal((await request("/api/admin/backup", undefined, member)).response.status, 403);
  assert.equal((await request("/api/admin/backup/restore", { confirmRestore: true }, member)).response.status, 403);
  assert.equal((await request("/api/admin/backups/run", {}, member)).response.status, 403);
  const subscription = (await request("/api/calendar/subscription", {})).body.subscription;
  const feedPath = new URL(subscription.httpsUrl).pathname;
  assert.equal((await fetch(`${base}${feedPath}`)).status, 200);
  const exported = await request("/api/admin/backup");
  assert.equal(exported.response.status, 200);
  assert.equal(exported.response.headers.get("cache-control"), "no-store");
  assert.match(exported.response.headers.get("content-disposition"), /\.json\.enc/);
  assert(!JSON.stringify(exported.body).includes("passwordHash"));
  const backup = decryptBackup(exported.body, secret);
  assert.equal(backup.tables.users.length, 2);
  assert.equal(backup.tables.calendarSubscriptions.length, 1);
  const names = [];
  for (let i = 0; i < 3; i += 1) {
    const saved = await request("/api/admin/backups/run", {});
    assert.equal(saved.response.status, 201);
    names.push(saved.body.backup.name);
  }
  assert.equal(new Set(names).size, 3, "Rapid backups must not overwrite each other");
  const files = (await request("/api/admin/backups")).body.backups;
  assert.equal(files.length, 2);
  const file = path.join(temp, "backups", names[2]);
  assert.equal(decryptBackup(await readFile(file, "utf8"), secret).tables.users.length, 2);
  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await request(`/api/admin/backups/${names[2]}`, undefined, member)).response.status, 403);
  assert.equal((await request(`/api/admin/backups/${names[2]}/restore`, { confirmRestore: true }, member)).response.status, 403);
  assert.equal((await request(`/api/admin/backups/${names[2]}/restore`, {})).response.status, 400);
  assert.equal((await request("/api/admin/backup/restore", backup)).response.status, 400, "Restore requires explicit confirmation");
  assert.equal((await restore(exported.body, "false")).response.status, 400);
  assert.equal((await restore({ ...exported.body, tag: Buffer.alloc(16).toString("base64") })).response.status, 400);
  const broken = structuredClone(backup);
  broken.tables.users.push(broken.tables.users[0]);
  assert.equal((await restore(broken)).response.status, 400, "Constraint failure must roll back");
  assert.equal((await request("/api/admin/users")).body.users.length, 2);
  assert.equal((await fetch(`${base}${feedPath}`)).status, 200, "Failed restore must not revoke links");
  assert.equal((await restore(exported.body)).response.status, 200);
  assert.equal((await request("/api/admin/users")).response.status, 401);
  assert.equal((await fetch(`${base}${feedPath}`)).status, 404, "Restore revokes links by default");
  await login();
  assert.equal((await restore(legacyEnvelope(backup), false)).response.status, 200);
  assert.equal((await fetch(`${base}${feedPath}`)).status, 200, "Trusted restore can preserve links");
  await login();
  assert.equal((await request(`/api/admin/backups/${names[2]}/restore`, { confirmRestore: true })).response.status, 200);
  assert.equal((await fetch(`${base}${feedPath}`)).status, 404);
  await login();
  const large = structuredClone(backup);
  large.tables.settings.push({ key: "largeRestoreTest", value: "x".repeat(3 * 1024 * 1024) });
  assert.equal((await restore(JSON.parse(encryptBackup(large, secret)))).response.status, 200, "Authenticated uploads above 2 MB must work");
  await login();
  await stop();
  await start("wrong-key-123456789012345");
  assert.equal((await restore(exported.body)).response.status, 400);
  assert.equal((await request("/api/admin/users")).body.users.length, 2);
  await stop();
  await start("");
  assert.equal((await request("/api/admin/backups")).body.config.encrypted, false);
  assert.equal((await request("/api/admin/backup")).response.status, 400, "No plaintext export fallback");
  assert.equal((await request("/api/admin/backups/run", {})).response.status, 400);
  assert.equal((await restore(exported.body)).response.status, 400);
  assert.equal((await restore(backup)).response.status, 200, "Legacy plaintext restore works without an encryption key");
  await login();
  console.log("Backup checks passed: encrypted export, v1/v2 compatibility, tampering, wrong/missing keys, permissions, confirmation, rollback, large uploads, retention, session and calendar revocation.");
} finally {
  await stop();
  await rm(temp, { recursive: true, force: true });
}
