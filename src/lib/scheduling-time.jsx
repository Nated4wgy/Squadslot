import { createContext, useContext } from "react";

export const SchedulingTimezone = createContext("Europe/London");

export function schedulingClock(timezone, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { timezone, date, time: `${parts.hour}:${parts.minute}`, day: new Date(`${date}T12:00:00`) };
}

export function useSchedulingTime() {
  return schedulingClock(useContext(SchedulingTimezone));
}
