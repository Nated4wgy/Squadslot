/* global document, window, getComputedStyle */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const temp = await mkdtemp(path.join(os.tmpdir(), "squadslot-planning-"));
const listener = net.createServer().listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/index.js"], { env: { ...process.env,
  DATABASE_PATH:path.join(temp, "test.db"), PORT:String(port), NODE_ENV:"production", APP_URL:base,
  SESSION_SECRET:"planning-test-secret-123456789012345", AUTO_BACKUP_ENABLED:"false",
  DISCORD_WEBHOOK_URL:"", DISCORD_BOT_TOKEN:"", TRUST_PROXY:"0", TRUSTED_TUNNEL_IPS:"" }, stdio:"ignore" });
let browser;
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
  const admin = await request("/api/auth/register", null, {username:"admin", password:"Planning123!"}, "POST", 201);
  await request("/api/auth/register", null, {username:"friend", password:"Planning123!"}, "POST", 202);
  const id = (await request("/api/admin/users", admin)).users.find(u => u.username === "friend").id;
  await request(`/api/admin/users/${id}/approval`, admin, {decision:"approve"});
  const friend = await request("/api/auth/login", null, {username:"friend", password:"Planning123!"});
  const adminId = (await request("/api/me", admin)).user.id;
  const form = {title:"Planning session", date:"2035-07-01", startTime:"20:00", endTime:"22:00", minPlayers:2, maxPlayers:4, inviteIds:[id], notes:"Original", steamAppId:570, gameTitle:"Dota 2"};
  await request("/api/session-templates", null, undefined, "GET", 401);
  const saved = await request("/api/session-templates", admin, {...form, name:"Friday crew"}, "POST", 201);
  assert.equal(saved.templates.length, 1);
  assert.equal((await request("/api/session-templates", friend)).templates.length, 0);
  await request(`/api/session-templates/${saved.templates[0].id}`, friend, undefined, "DELETE");
  assert.equal((await request("/api/session-templates", admin)).templates.length, 1);
  await request("/api/session-templates", admin, {...form, name:"Bad", inviteIds:[999999]}, "POST", 400);
  for (const account of [admin, friend]) await request("/api/availability", account, {date:form.date,startTime:"18:00",endTime:"23:00"}, "POST", 201);
  const planner = `/api/availability/best-times?start=${form.date}&end=${form.date}&players=${adminId},${id}`;
  assert.equal((await request(planner + "&duration=120", admin)).slots[0].count, 2);
  assert.equal((await request(planner + "&duration=360", admin)).slots.length, 0);
  await request(planner + ",999999", admin, undefined, "GET", 400);
  const created = await request("/api/events", admin, form, "POST", 201);
  await request(`/api/events/${created.id}/invites/me`, friend, {status:"accepted"}, "PATCH");
  await request(`/api/events/${created.id}`, friend, form, "PATCH", 403);
  await request(`/api/events/${created.id}`, admin, {...form, minPlayers:1, maxPlayers:1}, "PATCH", 409);
  await request(`/api/events/${created.id}`, admin, {...form, title:"Updated session", notes:"Updated notes"}, "PATCH");
  let updated = (await request("/api/events", admin)).events.find(event => event.id === created.id);
  assert.equal(updated.invites.find(invite => invite.userId === id).status, "accepted");
  assert.equal(updated.notes, "Updated notes");
  assert((await request(planner + "&duration=120", admin)).slots.every(slot => slot.endTime <= "20:00" || slot.startTime >= "22:00"));
  if (process.argv.includes("--browser")) {
    const {chromium, webkit} = await import("playwright");
    browser = await (process.argv.includes("--webkit") ? webkit : chromium).launch();
    const context = await browser.newContext({viewport:{width:1440,height:1000}, serviceWorkers:"block"});
    const separator = admin.cookie.indexOf("=");
    await context.addCookies([{name:admin.cookie.slice(0,separator), value:admin.cookie.slice(separator+1), url:base}]);
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/?view=events&event=${created.id}`);
    await page.getByRole("button", {name:"Edit Updated session", exact:true}).click();
    await page.getByLabel("Session title", {exact:true}).fill("Unsaved draft");
    await request(`/api/events/${created.id}`, admin, {...form, title:"Remote update"}, "PATCH");
    await page.evaluate(() => window.dispatchEvent(new window.Event("focus")));
    await page.getByRole("button", {name:"Edit Remote update", exact:true}).waitFor();
    assert.equal(await page.getByLabel("Session title", {exact:true}).inputValue(), "Unsaved draft");
    for (const width of [1440,390,768,1024]) {
      await page.setViewportSize({width,height:1000});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      assert(await page.locator(".session-editor").evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await page.screenshot({path:path.join(temp, `editor-${width}.png`), fullPage:true});
    }
    await page.getByRole("button", {name:"Save changes", exact:true}).click();
    await page.locator(".session-editor").waitFor({state:"detached"});
    assert.equal((await request("/api/events", admin)).events.find(event => event.id === created.id).title, "Unsaved draft");
    await page.getByRole("button", {name:"Friends", exact:true}).click();
    await page.getByLabel("friend", {exact:true}).check();
    await page.getByLabel("Week starting").fill(form.date);
    await page.getByRole("button", {name:"Find shared slots"}).click();
    await page.getByRole("button", {name:"Plan session", exact:true}).first().click();
    await page.getByLabel("Session title", {exact:true}).waitFor();
    assert.equal(await page.locator(".pulse-date-field input").inputValue(), form.date);
    await page.getByLabel("New template name").fill("UI template");
    await page.getByRole("button", {name:"Save template", exact:true}).click();
    await page.waitForFunction(() => [...document.querySelectorAll("option")].some(option => option.textContent === "UI template"));
    await page.emulateMedia({reducedMotion:"reduce"});
    assert(await page.locator(".pulse-session-details").evaluate(element => getComputedStyle(element).animationName === "none"));
    await page.screenshot({path:path.join(temp, "planner-composer.png"),fullPage:true});
    assert.deepEqual(errors, []);
    console.log(`Planning screenshots: ${temp}`);
  }
  await request(`/api/events/${created.id}`, admin, {...form, inviteIds:[]}, "PATCH");
  updated = (await request("/api/events", admin)).events.find(event => event.id === created.id);
  assert.equal(updated.invites.length, 1);
  console.log("Planning checks passed: template ownership, membership validation, duration matching, edit permissions, RSVP preservation, capacity and invite removal.");
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) { const done = once(server, "exit"); server.kill(); await done; }
}
