import assert from "node:assert/strict";
import { availabilityBlocksForDay, eventLanes } from "../src/features/calendar/calendar-logic.js";
import { addTime, eventDurationHours } from "../src/lib/dates.js";

const date = "2026-10-19";
const availability = [1, 2, 3].map(userId => ({ userId, date, startTime: "19:00", endTime: "23:00" }));
const event = { id: 1, date, startTime: "20:00", endTime: "22:30", invites: [{ userId: 1, status: "accepted" }, { userId: 2, status: "tentative" }] };
const best = [{ date, startTime: "19:00", endTime: "20:00", count: 3 }, { date, startTime: "20:00", endTime: "22:30", count: 1 }];
const blocks = availabilityBlocksForDay(date, availability, [event], best);
assert.deepEqual(blocks.map(({start, end, playerIds, isBest}) => ({start, end, playerIds, isBest})), [
  {start: 1140, end: 1200, playerIds: [1, 2, 3], isBest: true},
  {start: 1200, end: 1350, playerIds: [3], isBest: false},
  {start: 1350, end: 1380, playerIds: [1, 2, 3], isBest: false}
]);
assert.equal(eventDurationHours(event), 2.5);
assert.equal(addTime("18:00", eventDurationHours(event)), "20:30");
assert.equal(addTime("19:00", eventDurationHours({ startTime: "18:00", endTime: "18:17" })), "19:17");
const lanes = eventLanes([event, {id: 2, startTime: "20:30", endTime: "21:30"}, {id: 3, startTime: "22:30", endTime: "23:00"}]);
assert.equal(lanes.count, 2);
assert.deepEqual(lanes.entries.map(({lane}) => lane), [0, 1, 0]);
assert.deepEqual(availabilityBlocksForDay("2026-10-20", availability, [event], best), []);
console.log("Calendar logic checks passed.");
