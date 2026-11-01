import fs from "node:fs/promises";
import path from "node:path";

function setting(value, fallback, max) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= max ? number : fallback;
}

export function storageConfig(env = process.env) {
  return {
    auditDays: setting(env.AUDIT_RETENTION_DAYS, 90, 3650),
    auditRows: setting(env.AUDIT_MAX_ROWS, 20000, 1000000),
    deliveryDays: setting(env.DELIVERY_RETENTION_DAYS, 90, 3650),
    warningBytes: setting(env.STORAGE_WARNING_MB, 1024, 1048576) * 1024 * 1024,
    warningPercent: setting(env.STORAGE_WARNING_PERCENT, 10, 99)
  };
}

export function pruneLogs(db, config, now = new Date()) {
  const auditCutoff = new Date(now.getTime() - config.auditDays * 86400000).toISOString();
  const deliveryCutoff = new Date(now.getTime() - config.deliveryDays * 86400000);
  return db.transaction(() => {
    const age = db.prepare("DELETE FROM audit_log WHERE julianday(created_at) < julianday(?)").run(auditCutoff).changes;
    const count = db.prepare("DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT -1 OFFSET ?)").run(config.auditRows).changes;
    const push = db.prepare(`DELETE FROM push_deliveries WHERE sent_at < ?
      AND event_id IN (SELECT id FROM events WHERE ends_at_utc < ?)`)
      .run(deliveryCutoff.getTime(), now.toISOString()).changes;
    // Keep deduplication keys for active events, even if the invitation was sent months ago.
    const discord = db.prepare(`DELETE FROM reminder_log WHERE julianday(sent_at) < julianday(?)
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.ends_at_utc >= ? AND (
        reminder_key LIKE 'eventTomorrow:' || e.id || ':%'
        OR reminder_key LIKE 'eventStartingSoon:' || e.id || ':%'
        OR reminder_key LIKE 'rsvpDeadline:' || e.id || ':%'))`)
      .run(deliveryCutoff.toISOString(), now.toISOString()).changes;
    return { audit: age + count, push, discord };
  })();
}

export function diskStatus(stats, config) {
  const totalBytes = Number(stats.blocks) * Number(stats.bsize);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(freeBytes)) return { state: "unknown" };
  const freePercent = freeBytes / totalBytes * 100;
  return { totalBytes, freeBytes, freePercent,
    state: freeBytes < config.warningBytes || freePercent < config.warningPercent ? "warning" : "ok" };
}

async function volumeStatus(directory, config) {
  // Backup directories may not exist until the first backup is created.
  let current = directory;
  for (;;) {
    try { return diskStatus(await fs.statfs(current), config); } catch (error) {
      const parent = path.dirname(current);
      if (error.code !== "ENOENT" || parent === current) return { state: "unknown" };
      current = parent;
    }
  }
}

export function createStorageMonitor(db, databasePath, backupDir, config = storageConfig()) {
  let lastMaintenance = null;
  let lastCheck = null;
  let running = null;
  let previousWarning = "";
  async function check() {
    const [databaseVolume, backupVolume] = await Promise.all([
      volumeStatus(path.dirname(databasePath), config), volumeStatus(backupDir, config)
    ]);
    const bytes = async file => {
      try { return (await fs.stat(file)).size; } catch { return null; }
    };
    lastCheck = { checkedAt: new Date().toISOString(), databaseVolume, backupVolume,
      databaseBytes: await bytes(databasePath), walBytes: await bytes(`${databasePath}-wal`),
      config, maintenance: lastMaintenance };
    const warning = [databaseVolume.state, backupVolume.state].join(":");
    if (warning !== "ok:ok" && warning !== previousWarning) console.warn("Storage check:", warning, "- inspect Admin storage status.");
    previousWarning = warning;
    return lastCheck;
  }
  return {
    async status() {
      if (lastCheck && Date.now() - Date.parse(lastCheck.checkedAt) < 60000) return { ...lastCheck, maintenance: lastMaintenance };
      if (!running) running = check().finally(() => { running = null; });
      return running;
    },
    maintain() {
      try {
        const removed = pruneLogs(db, config);
        lastMaintenance = { at: new Date().toISOString(), ok: true, removed };
      } catch {
        lastMaintenance = { at: new Date().toISOString(), ok: false };
        console.error("Log retention failed; see Admin storage status.");
      }
    }
  };
}
