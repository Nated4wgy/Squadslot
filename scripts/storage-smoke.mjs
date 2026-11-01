import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { storageConfig, pruneLogs, diskStatus } from "../server/storage.js";

const config = storageConfig({ AUDIT_MAX_ROWS: "2", AUDIT_RETENTION_DAYS: "30", DELIVERY_RETENTION_DAYS: "30" });
assert.equal(storageConfig({ AUDIT_MAX_ROWS: "-1" }).auditRows, 20000);
assert.equal(diskStatus({ blocks: 10000, bavail: 5000, bsize: 1024 ** 2 }, config).state, "ok");
assert.equal(diskStatus({ blocks: 10000, bavail: 500, bsize: 1024 ** 2 }, config).state, "warning");
assert.equal(diskStatus({ blocks: 0, bavail: 0, bsize: 4096 }, config).state, "unknown");
const db = new Database(":memory:");
try {
  db.exec(`CREATE TABLE audit_log (id INTEGER PRIMARY KEY, created_at TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY, ends_at_utc TEXT);
    CREATE TABLE push_deliveries (event_id INTEGER, sent_at INTEGER);
    CREATE TABLE reminder_log (reminder_key TEXT, sent_at TEXT);
    INSERT INTO audit_log VALUES (1, '2034-01-01'), (2, '2035-06-30'), (3, '2035-06-30'), (4, '2035-06-30');
    INSERT INTO events VALUES (1, '2034-01-01T00:00:00.000Z'), (2, '2036-01-01T00:00:00.000Z');
    INSERT INTO push_deliveries VALUES (1, 0), (2, 0);
    INSERT INTO reminder_log VALUES ('eventTomorrow:1:2034-01-01', '2034-01-01'),
      ('eventTomorrow:2:2036-01-01', '2034-01-01'), ('rsvpDeadline:2:2036-01-01', '2034-01-01'),
      ('weeklySummary:1:2034-01-01', '2034-01-01');`);
  assert.deepEqual(pruneLogs(db, config, new Date("2035-07-01T00:00:00Z")), { audit: 2, push: 1, discord: 2 });
  assert.deepEqual(db.prepare("SELECT id FROM audit_log ORDER BY id").all(), [{id:3}, {id:4}]);
  assert.equal(db.prepare("SELECT event_id FROM push_deliveries").get().event_id, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 2);
  assert.deepEqual(pruneLogs(db, config, new Date("2035-07-01T00:00:00Z")), {audit:0, push:0, discord:0});
  console.log("Storage checks passed: thresholds, invalid config, age/count retention, active-delivery protection and idempotency.");
} finally { db.close(); }
