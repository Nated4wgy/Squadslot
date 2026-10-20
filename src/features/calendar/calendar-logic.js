import { calendarStartHour, calendarEndHour, timeMinutes } from "../../lib/dates.js";

export function samePlayers(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function availabilityBlocksForDay(date, availability, events, bestSlots) {
  const dayAvailability = availability.filter((item) => item.date === date);
  const dayEvents = events.filter((item) => item.date === date);
  const minMinute = calendarStartHour * 60;
  const maxMinute = calendarEndHour * 60;
  const boundaries = new Set([minMinute, maxMinute]);

  for (const item of [...dayAvailability, ...dayEvents]) {
    boundaries.add(Math.max(minMinute, Math.min(maxMinute, timeMinutes(item.startTime))));
    boundaries.add(Math.max(minMinute, Math.min(maxMinute, timeMinutes(item.endTime))));
  }
  for (let hour = calendarStartHour; hour <= calendarEndHour; hour += 1) boundaries.add(hour * 60);

  const ordered = [...boundaries].sort((a, b) => a - b);
  const highestCount = Math.max(2, ...bestSlots.map(slot => slot.count));
  const bestRanges = bestSlots.filter((slot) => slot.date === date && slot.count === highestCount)
    .map((slot) => [timeMinutes(slot.startTime), timeMinutes(slot.endTime)]);
  const blocks = [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (start >= end || end <= minMinute || start >= maxMinute) continue;
    const committed = new Set(
      dayEvents
        .filter((event) => timeMinutes(event.startTime) < end && timeMinutes(event.endTime) > start)
        .flatMap((event) => event.invites
          .filter((invite) => ["accepted", "tentative"].includes(invite.status))
          .map((invite) => invite.userId))
    );
    const freeItems = [...new Map(
      dayAvailability
        .filter((item) => timeMinutes(item.startTime) < end && timeMinutes(item.endTime) > start && !committed.has(item.userId))
        .map((item) => [item.userId, item])
    ).values()];
    if (freeItems.length === 0) continue;
    const playerIds = freeItems.map((item) => item.userId).sort((a, b) => a - b);
    const isBest = freeItems.length >= highestCount && bestRanges.some(([bestStart, bestEnd]) => bestStart < end && bestEnd > start);
    const previous = blocks.at(-1);

    if (previous && previous.end === start && previous.isBest === isBest && samePlayers(previous.playerIds, playerIds)) {
      previous.end = end;
    } else {
      blocks.push({ start, end, freeItems, playerIds, isBest });
    }
  }
  return blocks;
}

export function minutesLabel(value) {
  if (value >= calendarEndHour * 60) return "24:00";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}


export function eventLanes(events) {
  const ends = [];
  const entries = [...events].sort((a, b) => timeMinutes(a.startTime) - timeMinutes(b.startTime) || a.id - b.id).map(event => {
    const start = timeMinutes(event.startTime);
    let lane = ends.findIndex(end => end <= start);
    if (lane < 0) lane = ends.length;
    ends[lane] = timeMinutes(event.endTime);
    return { event, lane };
  });
  return { entries, count: Math.max(1, ends.length) };
}

