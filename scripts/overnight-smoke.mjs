/* global document */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { utcEventRange, dailyAvailability } from "../server/time.js";
import { splitCalendarEntries } from "../src/lib/overnight.js";
import { addTime, eventDurationHours } from "../src/lib/dates.js";
import { DateTime } from "luxon";

const overnight = { date:"2035-07-01", startTime:"22:00", endTime:"02:00", timezone:"Europe/London" };
assert.equal(utcEventRange(overnight.date, overnight.startTime, overnight.endTime, overnight.timezone).endsAtUtc, "2035-07-02T01:00:00.000Z");
assert.equal(utcEventRange("2027-03-27", "22:00", "01:30", "Europe/London"), null);
assert.equal(utcEventRange("2027-10-30", "22:00", "01:30", "Europe/London"), null);
assert.equal(utcEventRange("2035-07-01", "22:00", "22:00", "Europe/London"), null);
assert.equal(new Date(utcEventRange("2027-03-27", "22:00", "03:00", "Europe/London").endsAtUtc) - new Date("2027-03-27T22:00:00Z"), 4 * 3600000);
assert.equal(addTime("23:00", 3), "02:00");
assert.equal(eventDurationHours(overnight), 4);
const segments = splitCalendarEntries([overnight]);
assert.equal(segments.length, 2);
assert.equal(segments[1].date, "2035-07-02");
assert.equal(segments[1].source, overnight, "Editing a continuation must target the original occurrence");
assert.equal(dailyAvailability([overnight], "2035-07-02", "2035-07-02")[0].startTime, "00:00");

const temp = await mkdtemp(path.join(os.tmpdir(), "squadslot-overnight-"));
process.env.DATABASE_PATH = path.join(temp, "test.db");
const listener = net.createServer().listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/index.js"], { env: { ...process.env,
  PORT:String(port), NODE_ENV:"production", TZ:"Europe/London", APP_URL:base,
  SESSION_SECRET:"overnight-test-secret-123456789012345", AUTO_BACKUP_ENABLED:"false",
  DISCORD_WEBHOOK_URL:"", DISCORD_BOT_TOKEN:"" }, stdio:"ignore" });
let browser;
let db;
async function request(route, account, body, method = body === undefined ? "GET" : "POST", expected = 200) {
  const response = await fetch(base + route, { method, headers: { Origin:base, Cookie:account?.cookie || "", "Content-Type":"application/json" }, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
  const data = await response.json();
  assert.equal(response.status, expected, `${route}: ${JSON.stringify(data)}`);
  return {...data, cookie:response.headers.get("set-cookie")?.split(";")[0] || account?.cookie};
}
try {
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error("Server exited");
    try { if ((await fetch(base + "/api/health")).ok) break; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const admin = await request("/api/auth/register", null, {username:"admin", password:"Overnight123!"}, "POST", 201);
  await request("/api/auth/register", null, {username:"friend", password:"Overnight123!"}, "POST", 202);
  const id = (await request("/api/admin/users", admin)).users.find(u => u.username === "friend").id;
  await request(`/api/admin/users/${id}/approval`, admin, {decision:"approve"});
  const friend = await request("/api/auth/login", null, {username:"friend", password:"Overnight123!"});
  await request("/api/admin/storage", friend, undefined, "GET", 403);
  await request("/api/admin/storage", null, undefined, "GET", 401);
  const storage = await request("/api/admin/storage", admin);
  assert(storage.checkedAt && storage.databaseVolume.state !== "unknown");
  assert(storage.maintenance.ok);
  await request("/api/availability", admin, overnight, "POST", 201);
  const rule = await request("/api/availability/recurring", friend, {...overnight, weekdays:[0], startDate:overnight.date, endDate:overnight.date}, "POST", 201);
  let range = await request("/api/availability?start=2035-07-02&end=2035-07-02", admin);
  assert.equal(range.availability.length, 2, "Include carry-over from previous week, including a rule ending yesterday");
  ({ db } = await import("../server/db.js"));
  const { findBestSlots } = await import("../server/scheduling.js");
  const groupId = db.prepare("SELECT id FROM groups LIMIT 1").get().id;
  assert.equal(findBestSlots("2035-07-02", "2035-07-02", null, groupId)[0].count, 2);
  const event = await request("/api/events", admin, {...overnight, title:"Overnight session", minPlayers:1, maxPlayers:4, inviteIds:[id]}, "POST", 201);
  await request(`/api/events/${event.id}/invites/me`, friend, {status:"accepted"}, "PATCH");
  const shown = (await request("/api/events", friend)).events.find(e => e.id === event.id);
  assert.equal(shown.endDate, "2035-07-02");
  assert(shown.crossesDay);
  assert.equal(findBestSlots("2035-07-02", "2035-07-02", null, groupId).length, 0, "Accepted overnight event hides free time after midnight");
  await request("/api/events", admin, {...overnight, date:"2035-07-02", startTime:"01:00", endTime:"03:00", title:"Conflict"}, "POST", 409);
  const response = await fetch(`${base}/api/events/${event.id}/ics`, {headers:{Cookie:admin.cookie}});
  assert((await response.text()).includes("DTEND:20350702T010000Z"));
  await request(`/api/events/${event.id}`, admin, {date:overnight.date, startTime:"23:00", endTime:"03:00"}, "PATCH");
  assert.equal(db.prepare("SELECT ends_at_utc FROM events WHERE id = ?").get(event.id).ends_at_utc, "2035-07-02T02:00:00.000Z");
  await request(`/api/availability/rule-${rule.id}-2035-07-01`, friend, undefined, "DELETE");
  range = await request("/api/availability?start=2035-07-02&end=2035-07-02", admin);
  assert.equal(range.availability.length, 1, "Skipping Sunday also removes Monday's continuation");
  const feedDay = DateTime.now().setZone("Europe/London").plus({days:10}).toISODate();
  const feedRange = utcEventRange(feedDay, "22:00", "02:00", "Europe/London");
  await request("/api/availability", admin, {date:feedDay, startTime:"22:00", endTime:"02:00"}, "POST", 201);
  const feed = await (await fetch(`${base}/api/calendar.ics`, {headers:{Cookie:admin.cookie}})).text();
  const stamp = value => value.replaceAll("-", "").replaceAll(":", "").replace(".000", "");
  assert(feed.includes(`DTSTART:${stamp(feedRange.startsAtUtc)}`));
  assert(feed.includes(`DTEND:${stamp(feedRange.endsAtUtc)}`), "Free-time feed must preserve the next-day end");
  assert(!feed.includes("T240000"), "ICS midnight boundaries must use the next date, not hour 24");
  const proposal = await request("/api/proposals", admin, {title:"Night proposal", slots:[{date:"2035-08-01",startTime:"23:00",endTime:"02:00"}], games:[], inviteIds:[id]}, "POST", 201);
  assert.equal(db.prepare("SELECT ends_at_utc FROM proposal_slots WHERE proposal_id = ?").get(proposal.id).ends_at_utc, "2035-08-02T01:00:00.000Z");
  if (process.argv.includes("--browser")) {
    const {chromium, webkit} = await import("playwright");
    browser = await (process.argv.includes("--webkit") ? webkit : chromium).launch();
    const context = await browser.newContext({viewport:{width:1440,height:1000}, serviceWorkers:"block"});
    const separator = admin.cookie.indexOf("=");
    await context.addCookies([{name:admin.cookie.slice(0,separator), value:admin.cookie.slice(separator+1), url:base}]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2035-07-02T00:15:00Z"));
    await page.goto(base);
    await page.getByRole("button", {name:"Calendar", exact:true}).click();
    await page.locator(`[data-event-id="${event.id}"]`).first().waitFor();
    assert.equal(await page.locator(`[data-event-id="${event.id}"]`).first().getAttribute("aria-label"), "Overnight session, 00:00 to 03:00, 2 accepted");
    for (const width of [1440, 390, 768, 1024]) {
      await page.setViewportSize({width,height:1000});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      await page.screenshot({path:path.join(temp, `overnight-${width}.png`), fullPage:true});
    }
    assert.deepEqual(errors, []);
    console.log(`Overnight screenshots: ${temp}`);
  }
  console.log("Overnight checks passed: DST, week-boundary recurrence, exceptions, overlaps, conflicts, rescheduling, ICS and storage permissions.");
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) { const done = once(server, "exit"); server.kill(); await done; }
  db?.close();
  if (!process.argv.includes("--browser")) await rm(temp, {recursive:true,force:true});
}
