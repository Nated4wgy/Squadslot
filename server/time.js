import { DateTime } from "luxon";

export function localInstant(date, time, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || "")) return null;
  const value = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
  // Luxon shifts missing spring-forward times; repeated autumn times need an explicit choice.
  if (!value.isValid || value.toFormat("yyyy-MM-dd'T'HH:mm") !== `${date}T${time}` || value.getPossibleOffsets().length !== 1) return null;
  return value;
}

export function utcEventRange(date, startTime, endTime, timezone) {
  const start = localInstant(date, startTime, timezone);
  const end = localInstant(date, endTime, timezone);
  if (!start || !end || end <= start) return null;
  return { startsAtUtc: start.toUTC().toISO(), endsAtUtc: end.toUTC().toISO() };
}

export const timeValidationMessage = "Choose valid, unambiguous times in the squad timezone. Clock-change hours may be missing or repeated.";

export function localSegments(startsAtUtc, endsAtUtc, timezone, startDate, endDate) {
  const start = DateTime.fromISO(startsAtUtc || "", { zone: timezone });
  const end = DateTime.fromISO(endsAtUtc || "", { zone: timezone });
  if (!start.isValid || !end.isValid || end <= start) return [];
  const segments = [];
  let day = DateTime.fromISO(startDate, { zone: timezone }).startOf("day");
  const last = DateTime.fromISO(endDate, { zone: timezone }).endOf("day");
  for (let count = 0; count < 367 && day <= last && day < end; count++, day = day.plus({ days: 1 })) {
    const next = day.plus({ days: 1 });
    if (next <= start) continue;
    segments.push({ date: day.toISODate(), startTime: start > day ? start.toFormat("HH:mm") : "00:00", endTime: end < next ? end.toFormat("HH:mm") : "24:00" });
  }
  return segments;
}
