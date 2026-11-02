import { formatDate } from "../../lib/dates.js";

export const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
export const availabilityDate = date => formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
