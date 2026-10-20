import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const temp = await mkdtemp(path.join(os.tmpdir(), "squadslot-availability-"));
const listener = net.createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/index.js"], {
  env: { ...process.env, PORT: String(port), NODE_ENV: "production", DATABASE_PATH: path.join(temp, "test.db"),
    SESSION_SECRET: "availability-editing-secret-1234567890", DISCORD_WEBHOOK_URL: "", DISCORD_BOT_TOKEN: "", AUTO_BACKUP_ENABLED: "false" },
  stdio: "ignore"
});
async function request(route, cookie, body, method = body === undefined ? "GET" : "POST", status = 200) {
  const response = await fetch(`${base}${route}`, { method, headers: { Origin: base, Cookie: cookie || "", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(data)}`);
  return { ...data, cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie };
}
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error("Test server exited");
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const credentials = username => ({username, displayName: username, password: "Availability123!"});
  const admin = await request("/api/auth/register", "", credentials("admin"), "POST", 201);
  await request("/api/auth/register", "", credentials("friend"), "POST", 202);
  const friendUser = (await request("/api/admin/users", admin.cookie)).users.find(user => user.username === "friend");
  await request(`/api/admin/users/${friendUser.id}/approval`, admin.cookie, {decision:"approve"});
  const friend = await request("/api/auth/login", "", credentials("friend"));
  const one = await request("/api/availability", friend.cookie, {date:"2030-01-05", startTime:"19:00", endTime:"23:00", note:"Original"}, "POST", 201);
  const rule = await request("/api/availability/recurring", friend.cookie, {weekdays:[5], startDate:"2030-01-04", endDate:"2030-01-25", startTime:"19:00", endTime:"23:00", note:"Weekly"}, "POST", 201);
  const adminEntry = await request("/api/availability", admin.cookie, {date:"2030-01-05", startTime:"19:00", endTime:"23:00"}, "POST", 201);
  await request(`/api/availability/${adminEntry.id}`, friend.cookie, {note:"Unauthorized"}, "PATCH", 403);
  await request(`/api/availability/${one.id}`, "", {note:"Unauthorized"}, "PATCH", 401);
  await request(`/api/availability/${one.id}`, friend.cookie, {date:"2030-02-31"}, "PATCH", 400);
  await request(`/api/availability/${one.id}`, friend.cookie, {startTime:"23:00", endTime:"20:00"}, "PATCH", 400);
  await request(`/api/availability/${one.id}`, friend.cookie, {note:"x".repeat(201)}, "PATCH", 400);
  await request(`/api/availability/${one.id}`, admin.cookie, {startTime:"18:30", userId:admin.user.id}, "PATCH");
  const list = async () => (await request("/api/availability?start=2030-01-01&end=2030-02-01", friend.cookie)).availability;
  assert.equal((await list()).find(item => item.id === one.id).userId, friend.user.id);
  const occurrence = `rule-${rule.id}-2030-01-04`;
  await request(`/api/availability/rule-${rule.id}-2030-01-05`, friend.cookie, {note:"Wrong weekday"}, "PATCH", 400);
  await request(`/api/availability/rule-${rule.id}-2029-12-28`, friend.cookie, undefined, "DELETE", 400);
  await request(`/api/availability/${occurrence}`, friend.cookie, {startTime:"25:00"}, "PATCH", 400);
  assert((await list()).some(item => item.id === occurrence), "Invalid changes must not skip an occurrence");
  const changed = await request(`/api/availability/${occurrence}`, friend.cookie, {date:"2030-01-06", startTime:"10:30", endTime:"12:30", note:"This date only"}, "PATCH");
  let entries = await list();
  assert(!entries.some(item => item.id === occurrence));
  assert.equal(entries.find(item => item.id === changed.id).date, "2030-01-06");
  assert.equal(entries.find(item => item.id === `rule-${rule.id}-2030-01-11`).startTime, "19:00");
  await request(`/api/availability/${occurrence}`, friend.cookie, {note:"Duplicate"}, "PATCH", 409);
  await request(`/api/availability/recurring/${rule.id}`, friend.cookie, {weekday:7}, "PATCH", 400);
  await request(`/api/availability/recurring/${rule.id}`, friend.cookie, {startTime:"20:00", endTime:"22:00", endDate:"2030-01-18"}, "PATCH");
  entries = await list();
  assert.equal(entries.find(item => item.id === `rule-${rule.id}-2030-01-11`).startTime, "20:00");
  assert(!entries.some(item => item.id === `rule-${rule.id}-2030-01-25`));
  assert.equal(entries.find(item => item.id === changed.id).startTime, "10:30", "Series edits preserve one-date exceptions");
  assert.equal((await request("/api/availability/recurring", friend.cookie)).rules[0].nextDate, "2030-01-11");
  await request(`/api/availability/rule-${rule.id}-2030-01-11`, friend.cookie, undefined, "DELETE");
  assert.equal((await request("/api/availability/recurring", friend.cookie)).rules[0].nextDate, "2030-01-18");
  const adminRule = await request("/api/availability/recurring", admin.cookie, {weekdays:[1], startDate:"2030-01-01", startTime:"19:00", endTime:"23:00"}, "POST", 201);
  await request(`/api/availability/recurring/${adminRule.id}`, friend.cookie, {note:"Unauthorized"}, "PATCH", 403);
  await request("/api/groups", admin.cookie, {name:"Isolated squad", timezone:"Europe/London"}, "POST", 201);
  await request(`/api/availability/${one.id}`, admin.cookie, {note:"Cross-squad"}, "PATCH", 404);
  await request(`/api/availability/recurring/${rule.id}`, admin.cookie, {note:"Cross-squad"}, "PATCH", 404);
  await request(`/api/availability/${occurrence}`, admin.cookie, {note:"Cross-squad"}, "PATCH", 404);
  await request(`/api/availability/recurring/${rule.id}`, friend.cookie, undefined, "DELETE");
  entries = await list();
  assert(!entries.some(item => item.ruleId === rule.id));
  assert(entries.some(item => item.id === changed.id), "Deleting a series preserves independently edited dates");
  await request(`/api/availability/${changed.id}`, friend.cookie, undefined, "DELETE");
  assert(!(await list()).some(item => item.id === changed.id));
  console.log("Availability editing passed: permissions, squad isolation, validation, one-date exceptions, whole-series edits, next dates and deletion.");
} finally {
  if (server.exitCode === null) { const stopped = once(server, "exit"); server.kill(); await stopped; }
}
