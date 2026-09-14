import crypto from "node:crypto";
import webpush from "web-push";
import { db, getSetting, setSetting } from "./db.js";
import { getReminderSettings } from "./scheduling.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE, subscription TEXT NOT NULL,
    invites INTEGER NOT NULL DEFAULT 1, reminders INTEGER NOT NULL DEFAULT 1,
    session_version INTEGER NOT NULL DEFAULT 0, last_test_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS push_deliveries (
    subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    delivery_key TEXT NOT NULL, sent_at INTEGER NOT NULL,
    PRIMARY KEY(subscription_id, event_id, delivery_key)
  );
`);

function vapidDetails() {
  let subject = process.env.PUSH_SUBJECT || getSetting("appUrl", process.env.APP_URL || "");
  try {
    const url = new URL(subject);
    if (!["https:", "mailto:"].includes(url.protocol) || url.hostname === "localhost") return null;
    subject = url.protocol === "https:" ? url.origin : subject;
  } catch { return null; }
  let keys = getSetting("push.vapidKeys");
  if (!keys) {
    keys = JSON.stringify(webpush.generateVAPIDKeys());
    setSetting("push.vapidKeys", keys);
  }
  return { subject, ...JSON.parse(keys) };
}

export function pushConfig() {
  const details = vapidDetails();
  return { configured: Boolean(details), publicKey: details?.publicKey || "" };
}

export function validatePushSubscription(input) {
  const url = new URL(input?.endpoint);
  const allowed = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com"];
  const trusted = allowed.includes(url.hostname) || url.hostname.endsWith(".notify.windows.com") || url.hostname.endsWith(".push.apple.com");
  if (!trusted || url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.href.length > 2048) throw new Error("Unsupported push service.");
  const { p256dh, auth } = input.keys || {};
  if (![p256dh, auth].every((key) => typeof key === "string" && /^[\w-]+={0,2}$/.test(key))) throw new Error("Invalid push keys.");
  const publicKey = Buffer.from(p256dh, "base64url");
  if (publicKey.length !== 65 || Buffer.from(auth, "base64url").length !== 16) throw new Error("Invalid push keys.");
  crypto.ECDH.convertKey(publicKey, "prime256v1");
  return { endpoint: url.href, keys: { p256dh, auth } };
}

export function registerPush(user, input) {
  const subscription = validatePushSubscription(input.subscription);
  const existing = db.prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?").get(subscription.endpoint);
  if (existing && existing.user_id !== user.id) throw new Error("This device is registered to another account. Disable its notifications first.");
  if (!existing && db.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?").get(user.id).count >= 10) throw new Error("Maximum of 10 notification devices reached.");
  if (typeof input.invites !== "boolean" || typeof input.reminders !== "boolean") throw new Error("Notification preferences must be true or false.");
  db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, subscription, invites, reminders, session_version)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription,
    invites = excluded.invites, reminders = excluded.reminders, session_version = excluded.session_version`)
    .run(user.id, subscription.endpoint, JSON.stringify(subscription), Number(input.invites), Number(input.reminders), user.session_version || 0);
}

let running = false;
export async function runPushSweep(now = new Date(), send = webpush.sendNotification.bind(webpush)) {
  if (running) return;
  const vapid = vapidDetails();
  if (!vapid) return;
  running = true;
  try {
    const settings = getReminderSettings();
    const rows = db.prepare(`SELECT s.*, e.id AS event_id, e.title, e.starts_at_utc, e.date, e.start_time, i.status
      FROM push_subscriptions s JOIN users u ON u.id = s.user_id
      JOIN event_invites i ON i.user_id = s.user_id JOIN events e ON e.id = i.event_id
      JOIN group_members m ON m.user_id = s.user_id AND m.group_id = e.group_id
      WHERE s.session_version = u.session_version AND u.must_change_password = 0
      AND e.starts_at_utc > ? AND i.status IN ('invited', 'accepted', 'tentative')
      ORDER BY e.starts_at_utc, s.id`).all(now.toISOString());
    let attempts = 0;
    const expired = new Set();
    for (const row of rows) {
      if (expired.has(row.id)) continue;
      const minutes = (new Date(row.starts_at_utc).getTime() - now.getTime()) / 60000;
      const kinds = [];
      if (row.invites && row.status === "invited") kinds.push(["invite", "Game invite", "You have a pending invite"]);
      if (row.reminders && ["accepted", "tentative"].includes(row.status)) {
        if (settings.eventTomorrow && minutes > 60 && minutes <= 1440) kinds.push(["tomorrow", "Upcoming session", "Your session is within 24 hours"]);
        if (settings.eventStartingSoon && minutes <= 60) kinds.push(["soon", "Starting soon", "Your session starts within an hour"]);
      }
      for (const [kind, title, description] of kinds) {
        const key = `${kind}:${row.starts_at_utc}`;
        if (db.prepare("SELECT 1 FROM push_deliveries WHERE subscription_id = ? AND event_id = ? AND delivery_key = ?").get(row.id, row.event_id, key)) continue;
        if (++attempts > 50) return;
        try {
          await send(JSON.parse(row.subscription), JSON.stringify({
            title, body: `${row.title}: ${description}.`, url: "/?view=events", tag: `event-${row.event_id}-${kind}`
          }), { vapidDetails: vapid, timeout: 5000, TTL: Math.min(3600, Math.max(60, Math.floor(minutes * 60))), urgency: "normal" });
          db.prepare("INSERT OR IGNORE INTO push_deliveries VALUES (?, ?, ?, ?)").run(row.id, row.event_id, key, now.getTime());
        } catch (error) {
          if ([404, 410].includes(error.statusCode)) {
            db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(row.id);
            expired.add(row.id);
            break;
          }
          // Leave failed deliveries pending for the next sweep; never log subscription secrets.
        }
      }
    }
  } finally { running = false; }
}

export function addPushRoutes(app, requireAuth) {
  app.get("/api/push", requireAuth, (_req, res) => res.json(pushConfig()));
  app.post("/api/push/status", requireAuth, (req, res) => {
    const record = db.prepare("SELECT invites, reminders FROM push_subscriptions WHERE user_id = ? AND endpoint = ? AND session_version = ?")
      .get(req.user.id, String(req.body.endpoint || ""), req.user.session_version || 0);
    res.json({ subscribed: Boolean(record), invites: Boolean(record?.invites), reminders: Boolean(record?.reminders) });
  });
  app.post("/api/push", requireAuth, (req, res) => {
    if (!pushConfig().configured) return res.status(503).json({ error: "Set the public HTTPS App URL in Admin first." });
    try { registerPush(req.user, req.body); res.json({ ok: true }); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.delete("/api/push", requireAuth, (req, res) => {
    db.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").run(req.user.id, String(req.body.endpoint || ""));
    res.json({ ok: true });
  });
  app.post("/api/push/test", requireAuth, async (req, res) => {
    const record = db.prepare("SELECT * FROM push_subscriptions WHERE user_id = ? AND endpoint = ? AND session_version = ?")
      .get(req.user.id, String(req.body.endpoint || ""), req.user.session_version || 0);
    if (!record) return res.status(404).json({ error: "Enable notifications on this device first." });
    if (Date.now() - record.last_test_at < 60000) return res.status(429).json({ error: "Wait a minute before sending another test." });
    const vapid = vapidDetails();
    if (!vapid) return res.status(503).json({ error: "Set the public HTTPS App URL in Admin first." });
    db.prepare("UPDATE push_subscriptions SET last_test_at = ? WHERE id = ?").run(Date.now(), record.id);
    try {
      await webpush.sendNotification(JSON.parse(record.subscription), JSON.stringify({ title: "SquadSlot test", body: "Device notifications are working.", tag: "squadslot-test" }),
        { vapidDetails: vapid, timeout: 5000, TTL: 60 });
      res.json({ ok: true });
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(record.id);
      res.status(502).json({ error: "The push service did not accept the test. Try enabling notifications again." });
    }
  });
}
