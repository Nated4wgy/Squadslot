export function followingDate(date) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function endDateOf(item) {
  return item.occurrenceEndDate || (item.crossesDay ? item.endDate : null)
    || (item.endTime < item.startTime ? followingDate(item.date) : item.date);
}

export function splitCalendarEntries(items) {
  return items.flatMap(item => {
    if (item.source) return [item];
    const endDate = endDateOf(item);
    if (endDate === item.date) return [item];
    const segments = [{ ...item, endTime: "24:00", source: item }];
    if (item.endTime !== "00:00") segments.push({ ...item, date: endDate, startTime: "00:00", source: item });
    return segments;
  });
}

export const overnightLabel = (start, end) => end < start ? " (next day)" : "";
