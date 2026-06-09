import { db, getSetting, setSetting } from "./db.js";

const slotHours = ["18:00", "19:00", "20:00", "21:00", "22:00", "23:00"];

function dateFromString(value) {
  return new Date(`${value}T00:00:00Z`);
}

function dateTimeFromStrings(date, time) {
  return new Date(`${date}T${time}:00`);
}

export function dateString(date) {
  return date.toISOString().slice(0, 10);
}

export function addDateDays(value, amount) {
  const date = typeof value === "string" ? dateFromString(value) : new Date(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateString(date);
}

export function expandAvailability(startDate, endDate) {
  const explicit = db
    .prepare(`
      SELECT a.id, a.user_id AS userId, u.display_name AS displayName, u.avatar_url AS avatarUrl,
             u.profile_color AS profileColor, a.date, a.start_time AS startTime,
             a.end_time AS endTime, a.note, 0 AS recurring
      FROM availability a
      JOIN users u ON u.id = a.user_id
      WHERE a.date BETWEEN ? AND ?
    `)
    .all(startDate, endDate);

  const rules = db
    .prepare(`
      SELECT r.id AS ruleId, r.user_id AS userId, u.display_name AS displayName,
             u.avatar_url AS avatarUrl, u.profile_color AS profileColor, r.weekday,
             r.start_time AS startTime, r.end_time AS endTime, r.note,
             r.start_date AS startDate, r.end_date AS endDate
      FROM availability_rules r
      JOIN users u ON u.id = r.user_id
      WHERE r.start_date <= ? AND (r.end_date IS NULL OR r.end_date = '' OR r.end_date >= ?)
    `)
    .all(endDate, startDate);
  const exceptions = new Set(
    db.prepare("SELECT rule_id AS ruleId, date FROM availability_exceptions WHERE date BETWEEN ? AND ?")
      .all(startDate, endDate)
      .map((item) => `${item.ruleId}:${item.date}`)
  );

  const recurring = [];
  for (let cursor = startDate; cursor <= endDate; cursor = addDateDays(cursor, 1)) {
    const weekday = dateFromString(cursor).getUTCDay();
    for (const rule of rules) {
      if (rule.weekday !== weekday || cursor < rule.startDate || (rule.endDate && cursor > rule.endDate)) continue;
      if (exceptions.has(`${rule.ruleId}:${cursor}`)) continue;
      recurring.push({
        id: `rule-${rule.ruleId}-${cursor}`,
        ruleId: rule.ruleId,
        userId: rule.userId,
        displayName: rule.displayName,
        avatarUrl: rule.avatarUrl,
        profileColor: rule.profileColor,
        date: cursor,
        startTime: rule.startTime,
        endTime: rule.endTime,
        note: rule.note,
        recurring: 1
      });
    }
  }

  return [...explicit, ...recurring].sort((a, b) => (
    `${a.date} ${a.startTime} ${a.displayName}`.localeCompare(`${b.date} ${b.startTime} ${b.displayName}`)
  ));
}

export function findBestSlots(startDate, endDate, availability = expandAvailability(startDate, endDate)) {
  const events = db
    .prepare(`
      SELECT e.date, e.start_time AS startTime, e.end_time AS endTime, ei.user_id AS userId
      FROM events e
      JOIN event_invites ei ON ei.event_id = e.id
      WHERE e.date BETWEEN ? AND ? AND ei.status IN ('accepted', 'tentative')
    `)
    .all(startDate, endDate);
  const slots = [];

  for (let cursor = startDate; cursor <= endDate; cursor = addDateDays(cursor, 1)) {
    for (const startTime of slotHours) {
      const committed = new Set(
        events
          .filter((event) => event.date === cursor && event.startTime <= startTime && event.endTime > startTime)
          .map((event) => event.userId)
      );
      const players = new Map();
      for (const item of availability) {
        if (item.date !== cursor || item.startTime > startTime || item.endTime <= startTime || committed.has(item.userId)) continue;
        players.set(item.userId, {
          id: item.userId,
          displayName: item.displayName,
          avatarUrl: item.avatarUrl || "",
          profileColor: item.profileColor || "#2fd3ba"
        });
      }
      if (players.size > 0) {
        slots.push({
          date: cursor,
          startTime,
          endTime: startTime === "23:00" ? "23:59" : `${String(Number(startTime.slice(0, 2)) + 1).padStart(2, "0")}:00`,
          count: players.size,
          players: [...players.values()]
        });
      }
    }
  }

  return slots
    .sort((a, b) => b.count - a.count || `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))
    .slice(0, 8);
}

function icsEscape(value) {
  return String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function icsDateTime(date, time) {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function icsTimestamp(value) {
  const date = value ? new Date(String(value).endsWith("Z") ? value : `${value}Z`) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

export function eventsToIcs(events, calendarName = "SquadSlot", options = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SquadSlot//Gaming Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M"
  ];
  if (options.sourceUrl) lines.push(`URL:${icsEscape(options.sourceUrl)}`);

  for (const event of events) {
    const modifiedAt = event.updatedAt || event.createdAt;
    lines.push(
      "BEGIN:VEVENT",
      `UID:squadslot-${event.id}@squadslot`,
      `DTSTAMP:${icsTimestamp(event.createdAt)}`,
      `LAST-MODIFIED:${icsTimestamp(modifiedAt)}`,
      `DTSTART:${icsDateTime(event.date, event.startTime)}`,
      `DTEND:${icsDateTime(event.date, event.endTime)}`,
      `SUMMARY:${icsEscape(event.title)}`,
      `DESCRIPTION:${icsEscape([event.gameTitle, event.notes].filter(Boolean).join(" - "))}`,
      `STATUS:${event.calendarStatus === "tentative" ? "TENTATIVE" : "CONFIRMED"}`,
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function getReminderSettings() {
  return {
    eventTomorrow: getSetting("reminder.eventTomorrow", "true") !== "false",
    eventStartingSoon: getSetting("reminder.eventStartingSoon", "true") !== "false",
    rsvpDeadline: getSetting("reminder.rsvpDeadline", "true") !== "false",
    weeklySummary: getSetting("reminder.weeklySummary", "true") !== "false",
    weeklyDay: Number(getSetting("reminder.weeklyDay", "1")),
    weeklyTime: getSetting("reminder.weeklyTime", "09:00")
  };
}

export function saveReminderSettings(settings) {
  const weeklyDay = Number(settings.weeklyDay);
  const weeklyTime = String(settings.weeklyTime || "");
  if (!Number.isInteger(weeklyDay) || weeklyDay < 0 || weeklyDay > 6) throw new Error("Weekly reminder day is invalid.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(weeklyTime)) throw new Error("Weekly reminder time is invalid.");

  setSetting("reminder.eventTomorrow", settings.eventTomorrow ? "true" : "false");
  setSetting("reminder.eventStartingSoon", settings.eventStartingSoon ? "true" : "false");
  setSetting("reminder.rsvpDeadline", settings.rsvpDeadline ? "true" : "false");
  setSetting("reminder.weeklySummary", settings.weeklySummary ? "true" : "false");
  setSetting("reminder.weeklyDay", String(weeklyDay));
  setSetting("reminder.weeklyTime", weeklyTime);
}

function reminderWasSent(key) {
  return Boolean(db.prepare("SELECT 1 FROM reminder_log WHERE reminder_key = ?").get(key));
}

function markReminderSent(key) {
  db.prepare("INSERT OR IGNORE INTO reminder_log (reminder_key) VALUES (?)").run(key);
}

export async function runReminderSweep(sendNotification, now = new Date()) {
  const settings = getReminderSettings();
  const events = db
    .prepare(`
      SELECT e.id, e.title, e.date, e.start_time AS startTime, e.end_time AS endTime,
             e.rsvp_deadline AS rsvpDeadline, COALESCE(e.game_title, g.title) AS gameTitle,
             owner.display_name AS ownerName
      FROM events e
      JOIN users owner ON owner.id = e.owner_id
      LEFT JOIN games g ON g.id = e.game_id
      WHERE e.date >= ?
    `)
    .all(dateString(now));

  async function sendOnce(key, type, variables, options) {
    if (reminderWasSent(key)) return;
    const result = await sendNotification(type, variables, options);
    if (result?.sent) markReminderSent(key);
  }

  for (const event of events) {
    const startsAt = dateTimeFromStrings(event.date, event.startTime);
    const minutesUntil = (startsAt.getTime() - now.getTime()) / 60000;
    const variables = {
      title: event.title,
      game: event.gameTitle || "TBD",
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      owner: event.ownerName
    };
    const fields = [
      { name: "Game", value: variables.game, inline: true },
      { name: "When", value: `${event.date}, ${event.startTime} - ${event.endTime}`, inline: true }
    ];

    if (settings.eventTomorrow && minutesUntil >= 1380 && minutesUntil <= 1500) {
      await sendOnce(`eventTomorrow:${event.id}:${event.date}`, "eventTomorrow", variables, { fields, color: 0xd7fb6d });
    }
    if (settings.eventStartingSoon && minutesUntil >= 45 && minutesUntil <= 75) {
      await sendOnce(`eventStartingSoon:${event.id}:${event.date}`, "eventStartingSoon", variables, { fields, color: 0xff6b55 });
    }
    if (settings.rsvpDeadline && event.rsvpDeadline) {
      const deadline = new Date(event.rsvpDeadline);
      const deadlineMinutes = (deadline.getTime() - now.getTime()) / 60000;
      if (deadlineMinutes >= -15 && deadlineMinutes <= 15) {
        await sendOnce(`rsvpDeadline:${event.id}:${event.rsvpDeadline}`, "rsvpDeadline", variables, { fields, color: 0x7c8790 });
      }
    }
  }

  const weeklyTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (settings.weeklySummary && now.getDay() === settings.weeklyDay && weeklyTime === settings.weeklyTime) {
    const start = dateString(now);
    const end = addDateDays(start, 6);
    const best = findBestSlots(start, end);
    const summary = best.slice(0, 3).map((slot) => `${slot.date} ${slot.startTime}: ${slot.count} free`).join("\n") || "No shared free slots logged yet.";
    await sendOnce(`weeklySummary:${start}`, "weeklySummary", { startDate: start, endDate: end, summary }, {
      fields: [{ name: "Best slots", value: summary, inline: false }],
      color: 0x2fd3ba
    });
  }
}
