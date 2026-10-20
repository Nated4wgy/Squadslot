import { db } from "./db.js";
import { isDateString } from "./validation.js";
import { utcEventRange, timeValidationMessage } from "./time.js";

export function matchesRuleDate(rule, date) {
  return isDateString(date) && date >= rule.start_date && (!rule.end_date || date <= rule.end_date)
    && new Date(`${date}T12:00:00Z`).getUTCDay() === rule.weekday;
}

function validTimes(start, end) {
  return typeof start === "string" && typeof end === "string"
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(end) && start < end;
}

export function addAvailabilityEditingRoutes(app, requireAuth) {
  app.patch("/api/availability/recurring/:id", requireAuth, (req, res) => {
    const rule = db.prepare("SELECT * FROM availability_rules WHERE id = ? AND group_id = ?").get(Number(req.params.id), req.groupId);
    if (!rule) return res.status(404).json({ error: "Recurring rule not found." });
    if (rule.user_id !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Only the owner or an admin can edit this rule." });
    const { startTime = rule.start_time, endTime = rule.end_time, note = rule.note,
      weekday = rule.weekday, startDate = rule.start_date, endDate = rule.end_date } = req.body;
    if (!validTimes(startTime, endTime) || typeof note !== "string" || note.length > 200
      || !Number.isInteger(weekday) || weekday < 0 || weekday > 6
      || !isDateString(startDate) || (endDate !== null && endDate !== "" && (!isDateString(endDate) || endDate < startDate))) {
      return res.status(400).json({ error: "Check the weekday, date range, times and note (maximum 200 characters)." });
    }
    db.prepare("UPDATE availability_rules SET weekday = ?, start_time = ?, end_time = ?, note = ?, start_date = ?, end_date = ? WHERE id = ?")
      .run(weekday, startTime, endTime, note.trim(), startDate, endDate || null, rule.id);
    res.json({ ok: true });
  });

  app.patch("/api/availability/:id", requireAuth, (req, res) => {
    const match = /^rule-(\d+)-(\d{4}-\d{2}-\d{2})$/.exec(req.params.id);
    const row = match
      ? db.prepare("SELECT * FROM availability_rules WHERE id = ? AND group_id = ?").get(Number(match[1]), req.groupId)
      : db.prepare("SELECT * FROM availability WHERE id = ? AND group_id = ?").get(Number(req.params.id), req.groupId);
    if (!row) return res.status(404).json({ error: "Free time entry not found." });
    if (row.user_id !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Only the owner or an admin can edit this free time." });
    if (match && !matchesRuleDate(row, match[2])) return res.status(400).json({ error: "That date is not part of this repeating schedule." });
    const { date = match ? match[2] : row.date, startTime = row.start_time, endTime = row.end_time, note = row.note } = req.body;
    if (!isDateString(date) || !validTimes(startTime, endTime) || typeof note !== "string" || note.length > 200) {
      return res.status(400).json({ error: "Check the date, times and note (maximum 200 characters)." });
    }
    if (match) {
      if (!utcEventRange(date, startTime, endTime, req.group.timezone)) return res.status(400).json({ error: timeValidationMessage });
      if (db.prepare("SELECT 1 FROM availability_exceptions WHERE rule_id = ? AND date = ?").get(row.id, match[2])) {
        return res.status(409).json({ error: "This occurrence has already changed. Refresh the calendar before editing it again." });
      }
      // A single-date change must never leave a skipped date without its replacement.
      const id = db.transaction(() => {
        db.prepare("INSERT INTO availability_exceptions (rule_id, date) VALUES (?, ?)").run(row.id, match[2]);
        return db.prepare("INSERT INTO availability (group_id, user_id, date, start_time, end_time, note, timezone) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(row.group_id, row.user_id, date, startTime, endTime, note.trim(), row.timezone).lastInsertRowid;
      })();
      return res.json({ ok: true, id, exception: true });
    }
    if (!utcEventRange(date, startTime, endTime, req.group.timezone)) return res.status(400).json({ error: timeValidationMessage });
    db.prepare("UPDATE availability SET date = ?, start_time = ?, end_time = ?, note = ? WHERE id = ?")
      .run(date, startTime, endTime, note.trim(), row.id);
    res.json({ ok: true, id: row.id });
  });
}
