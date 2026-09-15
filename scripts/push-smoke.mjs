import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eventArtwork, gameImageSources } from "../src/game-art.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "squadslot-push-test-"));
process.env.DATABASE_PATH = path.join(temp, "test.db");
process.env.PUSH_SUBJECT = "https://example.com";
const { db } = await import("../server/db.js");
const { registerPush, runPushSweep, validatePushSubscription, pushConfig } = await import("../server/push.js");
try {
  const key = crypto.createECDH("prime256v1"); key.generateKeys();
  const subscription = (suffix) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`, keys: { p256dh: key.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") } });
  for (const endpoint of ["http://fcm.googleapis.com/a", "https://localhost/a", "https://127.0.0.1/a", "https://fcm.googleapis.com.evil.test/a", "https://user@fcm.googleapis.com/a", "https://fcm.googleapis.com:8443/a"]) {
    assert.throws(() => validatePushSubscription({ ...subscription("invalid"), endpoint }));
  }
  assert.throws(() => validatePushSubscription({ ...subscription("invalid"), keys: {p256dh:"invalid",auth:"invalid"} }));
  const config = pushConfig();
  assert(config.configured && config.publicKey.length > 80);
  assert.equal(pushConfig().publicKey, config.publicKey, "Signing keys must persist");
  assert(!("privateKey" in config));

  const group = db.prepare("SELECT id FROM groups LIMIT 1").get().id;
  const addUser = (name) => {
    const id = Number(db.prepare("INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, 'test')").run(name, name).lastInsertRowid);
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(group, id);
    return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  };
  const owner = addUser("owner"); const friend = addUser("friend");
  const inviteDevice = subscription("invites"); const reminderDevice = subscription("reminders");
  registerPush(friend, {subscription: inviteDevice, invites:true, reminders:false});
  registerPush(friend, {subscription: reminderDevice, invites:false, reminders:true});
  assert.throws(() => registerPush(owner, {subscription:inviteDevice, invites:true, reminders:true}), /another account/);
  const now = new Date("2030-05-20T10:00:00Z");
  const event = Number(db.prepare(`INSERT INTO events (group_id, owner_id, title, date, start_time, end_time, starts_at_utc, ends_at_utc)
    VALUES (?, ?, 'Game night', '2030-05-20', '11:05', '13:05', '2030-05-20T11:05:00.000Z', '2030-05-20T13:05:00.000Z')`).run(group, owner.id).lastInsertRowid);
  db.prepare("INSERT INTO event_invites (event_id, user_id, status) VALUES (?, ?, 'invited')").run(event, friend.id);
  const sent = [];
  const send = async (sub, data) => { sent.push({endpoint:sub.endpoint, data:JSON.parse(data)}); };
  await runPushSweep(now, send);
  assert.equal(sent.length, 1); assert.equal(sent[0].endpoint, inviteDevice.endpoint);
  await runPushSweep(now, send); assert.equal(sent.length, 1, "Repeated sweeps must not repeat invites");
  db.prepare("UPDATE event_invites SET status = 'accepted' WHERE event_id = ?").run(event);
  await runPushSweep(now, send); assert.equal(sent.length, 2); assert.equal(sent[1].endpoint, reminderDevice.endpoint);
  await runPushSweep(new Date("2030-05-20T10:10:00Z"), send); assert.equal(sent.length, 3);
  await runPushSweep(new Date("2030-05-20T10:11:00Z"), send); assert.equal(sent.length, 3);
  db.prepare("DELETE FROM push_deliveries").run();
  await runPushSweep(now, async () => { throw {statusCode:503}; });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM push_deliveries").get().n, 0, "Failures must remain retryable");
  await runPushSweep(now, send); assert.equal(sent.length, 4);
  db.prepare("DELETE FROM push_deliveries").run();
  db.prepare("UPDATE users SET session_version = 1 WHERE id = ?").run(friend.id);
  await runPushSweep(now, send); assert.equal(sent.length, 4, "Password resets must invalidate subscriptions");
  registerPush({...friend,session_version:1}, {subscription:reminderDevice, invites:false, reminders:true});
  db.prepare("DELETE FROM group_members WHERE user_id = ?").run(friend.id);
  await runPushSweep(now, send); assert.equal(sent.length, 4, "Former squad members must not receive events");
  db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(group, friend.id);
  await runPushSweep(now, async () => { throw {statusCode:410}; });
  assert(!db.prepare("SELECT 1 FROM push_subscriptions WHERE endpoint = ?").get(reminderDevice.endpoint));
  assert.deepEqual(eventArtwork({gameOptions:[{id:1,steamAppId:1},{id:2,steamAppId:2}]}), {src:undefined,appId:undefined});
  assert.equal(eventArtwork({selectedGameOptionId:2,steamAppId:1,gameOptions:[{id:2,steamAppId:2}]}).appId, 2);
  assert.equal(gameImageSources("", 548430).length, 2);
  assert.deepEqual(gameImageSources("javascript:alert(1)", -1), []);
  console.log("Push isolation, reminders, retries, expiry and artwork selection passed.");
} finally {
  db.close(); await rm(temp, {recursive:true,force:true});
}
