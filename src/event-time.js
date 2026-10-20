export function eventHasEnded(event, now = new Date()) {
  const end = event.endsAtUtc
    ? new Date(event.endsAtUtc)
    : new Date(`${event.date}T${event.endTime}:00`);
  return end.getTime() <= now.getTime();
}
