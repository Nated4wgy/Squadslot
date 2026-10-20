import { DateTime } from "luxon";

export function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && DateTime.fromISO(value, { zone: "utc" }).isValid;
}

export function dateRange(query, defaultStart, defaultDays) {
  const start = query.start ?? defaultStart;
  if (!isDateString(start)) throw new Error("Start date is invalid.");
  const end = query.end ?? DateTime.fromISO(start, { zone: "utc" }).plus({ days: defaultDays }).toISODate();
  if (!isDateString(end)) throw new Error("End date is invalid.");
  const days = DateTime.fromISO(end, { zone: "utc" }).diff(DateTime.fromISO(start, { zone: "utc" }), "days").days;
  if (days < 0 || days > 366) throw new Error("Date range must be in order and no longer than 366 days.");
  return { start, end };
}

// Express 4 does not forward rejected route promises to its error middleware.
export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next);
}

export function validNewPassword(password) {
  return password.length >= 8 && Buffer.byteLength(password, "utf8") <= 72;
}
