/* global document, window */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { utcEventRange } from "../server/time.js";

assert.equal(utcEventRange("2027-03-28", "01:30", "03:00", "Europe/London"), null);
assert.equal(utcEventRange("2027-10-31", "01:30", "03:00", "Europe/London"), null);
assert.equal(utcEventRange("2027-03-14", "02:30", "04:00", "America/New_York"), null);
assert.equal(utcEventRange("2027-11-07", "01:30", "04:00", "America/New_York"), null);
assert.equal(utcEventRange("2027-03-28", "19:00", "22:00", "Europe/London").startsAtUtc, "2027-03-28T18:00:00.000Z");
assert.equal(utcEventRange("2027-10-31", "19:00", "22:00", "Europe/London").startsAtUtc, "2027-10-31T19:00:00.000Z");

const temp = await mkdtemp(path.join(os.tmpdir(), "squadslot-scheduling-"));
process.env.DATABASE_PATH = path.join(temp, "test.db");
const listener = net.createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
let server;
let db;
let browser;
async function start() {
  server = spawn(process.execPath, ["server/index.js"], { env: { ...process.env,
    PORT: String(port), NODE_ENV: "production", TZ: "Pacific/Honolulu", APP_URL: base,
    SESSION_SECRET: "scheduling-test-secret-123456789012345", AUTO_BACKUP_ENABLED: "false",
    DISCORD_WEBHOOK_URL: "", DISCORD_BOT_TOKEN: "" }, stdio: "ignore" });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error("Scheduling server exited");
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Scheduling server did not start");
}
async function stop() {
  if (server?.exitCode === null) { const stopped = once(server, "exit"); server.kill(); await stopped; }
}
async function request(route, account, body, method = body === undefined ? "GET" : "POST", status = 200) {
  const response = await fetch(`${base}${route}`, { method, headers: { Origin: base, Cookie: account?.cookie || "", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(data)}`);
  return { ...data, cookie: response.headers.get("set-cookie")?.split(";")[0] || account?.cookie };
}
const eventInput = { title: "Shared commitment", date: "2035-07-02", startTime: "19:00", endTime: "21:00", minPlayers: 1, maxPlayers: 8 };
try {
  await start();
  const credentials = username => ({username, password:"Scheduling123!"});
  const admin = await request("/api/auth/register", null, credentials("admin"), "POST", 201);
  const members = [];
  for (const username of ["earlyinvite", "lateinvite", "filler"]) {
    await request("/api/auth/register", null, credentials(username), "POST", 202);
    const pending = (await request("/api/admin/users", admin)).users.find(item => item.username === username);
    await request(`/api/admin/users/${pending.id}/approval`, admin, {decision:"approve"});
    members.push(await request("/api/auth/login", null, credentials(username)));
  }
  const [first, second, filler] = members;
  const london = (await request("/api/groups", admin)).groups[0];
  // Existing default-group timezone can follow TZ on bootstrap; set the fixture explicitly.
  ({ db } = await import("../server/db.js"));
  db.prepare("UPDATE groups SET timezone = 'Europe/London' WHERE id = ?").run(london.id);
  await request("/api/profile", first, {...first.user, timezone:"Asia/Tokyo"}, "PUT");
  const event = await request("/api/events", admin, {...eventInput, inviteIds:[first.user.id]}, "POST", 201);
  await request(`/api/events/${event.id}/invites/me`, first, {status:"accepted"}, "PATCH");
  const shown = (await request("/api/events", first)).events.find(item => item.id === event.id);
  assert.equal(shown.startTime, "19:00");
  assert.equal(shown.displayTimezone, "Europe/London", "Profile timezone must not move shared calendar events");
  assert.equal(shown.startsAtUtc, "2035-07-02T18:00:00.000Z");
  const ny = await request("/api/groups", admin, {name:"New York squad", timezone:"America/New_York"}, "POST", 201);
  const nyGroup = (await request("/api/groups", admin)).groups.find(item => item.id === ny.id);
  await request("/api/groups/join", first, {inviteCode:nyGroup.inviteCode});
  const conflictInput = {...eventInput, title:"Private cross-squad fixture", startTime:"14:00", endTime:"16:00", inviteIds:[first.user.id]};
  await request("/api/events", admin, conflictInput, "POST", 409);
  const conflict = await request("/api/events", admin, {...conflictInput, force:true}, "POST", 201);
  await request(`/api/events/${conflict.id}/invites/me`, first, {status:"accepted"}, "PATCH", 409);
  await request(`/api/events/${conflict.id}/invites/me`, first, {status:"accepted", force:true}, "PATCH");
  const warning = await request(`/api/events/${conflict.id}`, admin, {date:eventInput.date, startTime:"13:30", endTime:"15:30"}, "PATCH", 409);
  assert(!JSON.stringify(warning).includes("Shared commitment"), "Other players' private event titles must not leak through reschedule warnings");
  await request(`/api/events/${conflict.id}`, admin, {date:eventInput.date, startTime:"16:00", endTime:"17:00"}, "PATCH");
  const moved = (await request("/api/events", admin)).events.find(item => item.id === conflict.id);
  assert.equal(moved.startsAtUtc, "2035-07-02T20:00:00.000Z", "Touching boundaries are not conflicts");
  for (const account of [admin, first]) await request(`/api/groups/${london.id}/activate`, account, {}, "PUT");
  for (const date of ["2027-03-28", "2027-10-31"]) {
    await request("/api/events", admin, {...eventInput, date, startTime:"01:30", endTime:"03:00"}, "POST", 400);
    await request("/api/availability", first, {date, startTime:"01:30", endTime:"03:00"}, "POST", 400);
  }
  const rule = await request("/api/availability/recurring", first, {weekdays:[0], startDate:"2027-03-21", endDate:"2027-04-04", startTime:"19:00", endTime:"22:00"}, "POST", 201);
  const earlyRule = await request("/api/availability/recurring", first, {weekdays:[0], startDate:"2027-03-21", endDate:"2027-04-04", startTime:"01:30", endTime:"03:00"}, "POST", 201);
  const availability = (await request("/api/availability?start=2027-03-21&end=2027-04-04", first)).availability;
  const occurrences = availability.filter(item => item.ruleId === rule.id);
  assert.equal(occurrences.length, 3);
  assert.equal(occurrences[0].startsAtUtc, "2027-03-21T19:00:00.000Z");
  assert.equal(occurrences[1].startsAtUtc, "2027-03-28T18:00:00.000Z");
  assert.equal(availability.filter(item => item.ruleId === earlyRule.id).length, 2, "Missing local time must be skipped, not shifted");
  await request(`/api/availability/rule-${rule.id}-2027-03-28`, first, {startTime:"01:30", endTime:"03:00"}, "PATCH", 400);
  assert.equal((await request("/api/availability?start=2027-03-28&end=2027-03-28", first)).availability.filter(item => item.ruleId === rule.id).length, 1);
  const queue = await request("/api/events", admin, {...eventInput, date:"2035-07-03", maxPlayers:2, inviteIds:members.map(item=>item.user.id)}, "POST", 201);
  const rsvp = (account, status, expected = 200) => request(`/api/events/${queue.id}/invites/me`, account, {status}, "PATCH", expected);
  await rsvp(filler, "accepted");
  await rsvp(second, "accepted", 202);
  await rsvp(first, "accepted", 202);
  const queueRows = () => db.prepare("SELECT user_id AS id, status, waitlisted_at AS queued FROM event_invites WHERE event_id = ? ORDER BY waitlisted_at, user_id").all(queue.id);
  const original = queueRows().find(item=>item.id === second.user.id).queued;
  assert(original < queueRows().find(item=>item.id === first.user.id).queued, "Order must follow queue entry, not invitation order");
  await rsvp(second, "accepted", 202);
  assert.equal(queueRows().find(item=>item.id === second.user.id).queued, original, "Retry must preserve queue position");
  await stop(); await start();
  assert.equal(queueRows().find(item=>item.id === second.user.id).queued, original, "Restart must preserve queue position");
  await rsvp(second, "declined");
  await rsvp(second, "accepted", 202);
  assert(queueRows().find(item=>item.id === first.user.id).queued < queueRows().find(item=>item.id === second.user.id).queued, "Rejoining goes to the back");
  await rsvp(filler, "declined");
  assert.equal(queueRows().find(item=>item.id === first.user.id).status, "accepted");
  await rsvp(first, "declined");
  assert.equal(queueRows().find(item=>item.id === second.user.id).status, "accepted");
  await request(`/api/groups/${ny.id}/activate`, first, {}, "PUT");
  await request("/api/events", first, {...eventInput, title:"Private commitment", date:"2035-07-04", startTime:"14:00", endTime:"16:00"}, "POST", 201);
  await request(`/api/groups/${london.id}/activate`, first, {}, "PUT");
  const skipQueue = await request("/api/events", admin, {...eventInput, date:"2035-07-04", maxPlayers:2, inviteIds:members.map(item=>item.user.id)}, "POST", 201);
  await request(`/api/events/${skipQueue.id}/invites/me`, filler, {status:"accepted"}, "PATCH");
  await request(`/api/events/${skipQueue.id}/invites/me`, first, {status:"accepted",force:true}, "PATCH", 202);
  await request(`/api/events/${skipQueue.id}/invites/me`, second, {status:"accepted"}, "PATCH", 202);
  await request(`/api/events/${skipQueue.id}/invites/me`, filler, {status:"declined"}, "PATCH");
  const skipped = (await request("/api/events", admin)).events.find(item=>item.id === skipQueue.id).invites;
  assert.equal(skipped.find(item=>item.userId === first.user.id).status, "waitlisted", "Promotion must recheck conflicts across squads");
  assert.equal(skipped.find(item=>item.userId === second.user.id).status, "accepted");
  const { eventsToIcs, runReminderSweep } = await import("../server/scheduling.js");
  const ics = eventsToIcs([], "Test", {availability:occurrences.map(item=>({...item, kind:"free", summary:"Free"}))});
  assert(ics.includes("DTSTART:20270328T180000Z"));
  await request("/api/groups", admin, {name:"Pacific squad", timezone:"America/Los_Angeles"}, "POST", 201);
  const late = await request("/api/events", admin, {...eventInput, date:"2035-01-01", startTime:"23:00", endTime:"23:59"}, "POST", 201);
  const sent = [];
  await runReminderSweep(async (type, variables) => { sent.push({type,variables}); return {sent:true}; }, new Date("2035-01-02T06:00:00Z"));
  assert(sent.some(item => item.type === "eventStartingSoon" && item.variables.title === eventInput.title), "Reminder must not miss yesterday's local date when UTC is tomorrow");
  assert(late.id);
  if (process.argv.includes("--browser")) {
    const { chromium, webkit } = await import("playwright");
    const engine = process.argv.includes("--webkit") ? webkit : chromium;
    browser = await engine.launch();
    const context = await browser.newContext({ timezoneId:"America/Los_Angeles", viewport:{width:390,height:844}, serviceWorkers:"block" });
    const separator = first.cookie.indexOf("=");
    await context.addCookies([{name:first.cookie.slice(0,separator), value:first.cookie.slice(separator+1), url:base, httpOnly:true, sameSite:"Strict"}]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.clock.install({time:new Date("2035-07-02T00:30:00Z")});
    await page.route("**/api/games?*", route=>route.fulfill({json:{games:[]}}));
    await page.goto(base);
    await page.getByText("Squad time: Europe/London", {exact:true}).waitFor();
    await page.getByRole("navigation").getByRole("button", {name:"Calendar",exact:true}).click();
    await page.locator(`[data-event-id="${event.id}"]`).waitFor();
    assert.match(await page.locator(`[data-event-id="${event.id}"]`).getAttribute("aria-label"), /19:00 to 21:00/);
    await page.getByRole("navigation").getByRole("button", {name:"Free Time",exact:true}).click();
    const form = page.locator("form.availability-composer");
    await form.getByLabel("Quick preset", {exact:true}).selectOption("tonight");
    assert.equal(await form.locator('input[type="date"]').inputValue(), "2035-07-02", "Tonight must follow squad date, not device or profile date");
    await form.getByLabel("Quick preset", {exact:true}).selectOption("tomorrow");
    assert.equal(await form.locator('input[type="date"]').inputValue(), "2035-07-03");
    await form.locator('input[type="date"]').fill("2027-03-28");
    await form.locator('input[type="time"]').nth(0).fill("01:30");
    await form.locator('input[type="time"]').nth(1).fill("03:00");
    await form.getByRole("button", {name:"Save",exact:true}).click();
    await form.getByText(/Choose valid, unambiguous times/).waitFor();
    for (const width of [320,390,768,1024,1440]) {
      await page.setViewportSize({width,height:900});
      assert(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `Scheduling overflow ${width}px`);
    }
    await page.screenshot({path:path.join(temp, `${engine.name()}-timezone.png`),fullPage:true});
    assert.deepEqual(errors, []);
    console.log(`${engine.name()} timezone browser checks passed.`);
  }
  console.log("Scheduling passed: mixed profile/server zones, DST gaps/folds, recurrence, UTC feeds, cross-squad conflicts, rescheduling privacy, queue ordering/retries/rejoin/restart and UTC reminder boundaries.");
} finally {
  await browser?.close();
  await stop();
  db?.close();
  await rm(temp, {recursive:true, force:true});
}
