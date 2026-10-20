import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { configureProxy, createLimiter, installStorageLimits, rateLimit } from "../server/protection.js";

let now = 0;
const consume = createLimiter({ limit: 2, windowMs: 1000, maxKeys: 2, now: () => now });
assert.equal(consume("a"), 0);
assert.equal(consume("a"), 0);
assert.equal(consume("a"), 1);
assert.equal(consume("b"), 0);
assert.equal(consume("c"), 1, "Key exhaustion fails closed");
assert.equal(consume("a"), 1, "Churning keys cannot evict existing limits");
now = 1000;
assert.equal(consume("c"), 0);
assert.equal(consume("a"), 0);
assert.throws(() => configureProxy(express(), { TRUSTED_TUNNEL_IPS: "192.168.1.0/24" }));

for (const trusted of ["192.168.1.196", "127.0.0.1"]) {
  const app = express();
  configureProxy(app, { TRUSTED_TUNNEL_IPS: trusted, TRUST_PROXY: "1" });
  app.get("/ip", (req, res) => res.json({ ip: req.ip, host: req.hostname }));
  app.get("/limited", rateLimit({ limit: 1, windowMs: 60000 }), (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const headers = {
      "CF-Connecting-IP": "203.0.113.7",
      "X-Forwarded-For": "198.51.100.9",
      "X-Forwarded-Host": "forged.example"
    };
    let result = await (await fetch(`${base}/ip`, { headers })).json();
    assert.equal(result.ip, trusted === "127.0.0.1" ? "203.0.113.7" : "127.0.0.1");
    assert.equal(result.host, "127.0.0.1");
    result = await (await fetch(`${base}/ip`, { headers: { ...headers, "CF-Connecting-IP": "invalid,203.0.113.7" } })).json();
    assert.equal(result.ip, "127.0.0.1", "Invalid visitor header falls back to socket, not forwarded chain");
    assert.equal((await fetch(`${base}/limited`, { headers })).status, 200);
    const limited = await fetch(`${base}/limited`, { headers: { ...headers, "X-Forwarded-For": "198.51.100.10" } });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const temp = await mkdtemp(path.join(os.tmpdir(), "squadslot-protection-"));
process.env.DATABASE_PATH = path.join(temp, "test.db");
let db;
try {
  ({ db } = await import("../server/db.js"));
  installStorageLimits(db);
  const insert = db.prepare("INSERT INTO users (username, display_name, password_hash, account_status) VALUES (?, 'Test', 'test-only', 'pending')");
  db.transaction(() => {
    for (let index = 0; index < 100; index += 1) insert.run(`pending${index}`);
  })();
  assert.throws(() => insert.run("overflow"), /Pending account limit/);
  db.prepare("DELETE FROM users WHERE username = 'pending99'").run();
  insert.run("replacement");
  const user = db.prepare("SELECT id FROM users LIMIT 1").get().id;
  const group = db.prepare("SELECT id FROM groups LIMIT 1").get().id;
  const free = db.prepare("INSERT INTO availability (user_id, group_id, date, start_time, end_time, note) VALUES (?, ?, '2035-01-01', '19:00', '21:00', ?)");
  assert.throws(() => free.run(user, group, "x".repeat(4001)), /4000 bytes/);
  db.transaction(() => {
    for (let index = 0; index < 2000; index += 1) free.run(user, group, "");
  })();
  assert.throws(() => free.run(user, group, ""), /Personal storage limit/);
  db.prepare("UPDATE availability SET note = 'Still editable' WHERE user_id = ?").run(user);
  const before = db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
  assert.throws(db.transaction(() => {
    db.prepare("DELETE FROM users").run();
    for (let index = 0; index < 101; index += 1) insert.run(`restore${index}`);
  }), /Pending account limit/);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM users").get().total, before, "Failed restore rolls back");
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM availability").get().total, 2000);
} finally {
  db?.close();
  await rm(temp, { recursive: true, force: true });
}
console.log("Protection checks passed: tunnel headers, direct access, bounded rate limits, quotas and rollback.");
