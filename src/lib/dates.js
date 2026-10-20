export const calendarStartHour = 17;
export const calendarEndHour = 24;
export const hours = Array.from({ length: calendarEndHour - calendarStartHour }, (_, index) => (
  `${String(calendarStartHour + index).padStart(2, "0")}:00`
));

export function startOfWeek(date = new Date()) {
  const day = date.getDay() || 7;
  const copy = new Date(date);
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

export function nextWeekday(weekday, today = new Date()) {
  const date = new Date(today);
  const delta = (weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + delta);
  return localDate(date);
}

export function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDay(date) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" }).format(date);
}

export function formatDate(value, options = { weekday: "short", day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat("en-GB", options).format(new Date(`${value}T12:00:00`));
}

export function addTime(time, hoursToAdd) {
  const [hours, minutes] = time.split(":").map(Number);
  const total = Math.min((23 * 60) + 59, (hours * 60) + minutes + Math.round(hoursToAdd * 60));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function timeMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return (hour * 60) + minute;
}

export function calendarPlacement(startTime, endTime, startHour = calendarStartHour, endHour = calendarEndHour) {
  const start = Math.max(startHour * 60, timeMinutes(startTime));
  const end = Math.min(endHour * 60, timeMinutes(endTime));
  const total = (endHour - startHour) * 60;
  return {
    top: `${((start - (startHour * 60)) / total) * 100}%`,
    height: `${Math.max(0, ((end - start) / total) * 100)}%`
  };
}

export function eventDurationHours(event) {
  const [startHour, startMinute] = event.startTime.split(":").map(Number);
  const [endHour, endMinute] = event.endTime.split(":").map(Number);
  return Math.max(1 / 60, ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60);
}

