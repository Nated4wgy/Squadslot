/* global document, window */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium, webkit } from "playwright";

const temp = await mkdtemp(path.join(os.tmpdir(), "squadslot-layout-"));
const listener = net.createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/index.js"], {
  env: {
    ...process.env, PORT: String(port), NODE_ENV: "production",
    DATABASE_PATH: path.join(temp, "preview.db"),
    SESSION_SECRET: "isolated-layout-review-123456789012345",
    DISCORD_WEBHOOK_URL: "", DISCORD_BOT_TOKEN: "", AUTO_BACKUP_ENABLED: "false",
    BACKUP_ENCRYPTION_KEY: "layout-backup-test-key-123456789"
  },
  stdio: "ignore"
});
let browser;
const baseline = process.argv.includes("--baseline");
const interactionsOnly = process.argv.includes("--interactions");
const engine = process.argv.includes("--webkit") ? webkit : chromium;

async function checkDateTimeBounds(page, context) {
  const overflow = await page.locator('input[type="date"], input[type="time"], input[type="datetime-local"]').evaluateAll((inputs) => {
    return inputs.filter((input) => input.getClientRects().length).flatMap((input) => {
      const rect = input.getBoundingClientRect();
      const parent = input.parentElement;
      const bounds = parent.getBoundingClientRect();
      const style = window.getComputedStyle(parent);
      const left = bounds.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const right = bounds.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      const sibling = input.nextElementSibling?.matches("i") ? input.nextElementSibling.nextElementSibling : input.nextElementSibling;
      const overlaps = sibling?.matches("input") && Math.abs(rect.top - sibling.getBoundingClientRect().top) < 1 && rect.right > sibling.getBoundingClientRect().left;
      return rect.left < left - 1 || rect.right > right + 1 || overlaps
        ? [`${input.type} in ${parent.className || parent.tagName}`] : [];
    });
  });
  assert.deepEqual(overflow, [], `${context}: date/time controls must fit their containers without overlapping`);
}
try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error("Preview server exited");
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await engine.launch();
  const contexts = [];
  const accounts = [];
  async function request(context, route, data, method = "POST") {
    const response = await context.request.fetch(`${base}${route}`, {
      method, data, headers: { Origin: base }
    });
    assert(response.ok(), `${route}: ${response.status()} ${await response.text()}`);
    const cookie = response.headers()["set-cookie"]?.split(";")[0];
    if (cookie) {
      const separator = cookie.indexOf("=");
      await context.addCookies([{name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: base, httpOnly: true, sameSite: "Strict"}]);
    }
    return response.json();
  }
  for (const [index, displayName] of ["Alex Morgan", "Jamie", "Sam", "Riley"].entries()) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    contexts.push(context);
    let registration = await request(context, "/api/auth/register", {
      username: `review${index}`, displayName, password: "PreviewOnly2026!"
    });
    if (registration.pendingApproval) {
      const pending = (await request(contexts[0], "/api/admin/users", undefined, "GET")).users.find((account) => account.username === `review${index}`);
      await request(contexts[0], `/api/admin/users/${pending.id}/approval`, { decision: "approve" });
      registration = await request(context, "/api/auth/login", { username: `review${index}`, password: "PreviewOnly2026!" });
    }
    accounts.push(registration.user);
  }
  const monday = new Date();
  monday.setDate(monday.getDate() + (8 - (monday.getDay() || 7)));
  function dateAt(offset) {
    const date = new Date(monday);
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  for (const context of contexts) {
    for (const day of [0, 2, 4]) await request(context, "/api/availability", {
      date: dateAt(day), startTime: "19:00", endTime: "23:00", note: "Up for co-op"
    });
  }
  const session = await request(contexts[0], "/api/events", {
    title: "Deep Rock Galactic", gameTitle: "Deep Rock Galactic", date: dateAt(2),
    startTime: "20:00", endTime: "22:30", minPlayers: 3, maxPlayers: 4,
    inviteIds: accounts.slice(1).map((user) => user.id),
    gameOptions: [{title: "Deep Rock Galactic", steamAppId: 548430, imageUrl: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/548430/header.jpg"}]
  });
  for (const context of contexts.slice(1, 3)) await request(context, `/api/events/${session.id}/invites/me`, {status: "accepted"}, "PATCH");
  await request(contexts[1], "/api/events", {
    title: "Friday co-op night", gameTitle: "Helldivers 2", date: dateAt(4),
    startTime: "20:00", endTime: "22:00", inviteIds: [accounts[0].id], minPlayers: 2, maxPlayers: 4
  });
  for (const [steamAppId, title] of [[548430, "Deep Rock Galactic"], [553850, "Helldivers 2"], [892970, "Valheim"]]) {
    await request(contexts[0], "/api/games/suggest", {steamAppId, title, image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/header.jpg`});
  }
  const page = await contexts[0].newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Keep external Steam uptime out of layout checks; local event art still uses the real image URL.
  await page.route("**/api/games?*", (route) => route.fulfill({json: {games: []}}));
  if (!baseline) {
    const visitorContext = await browser.newContext({ viewport: { width: 320, height: 740 }, serviceWorkers: "block" });
    const visitor = await visitorContext.newPage();
    visitor.on("pageerror", (error) => errors.push(error.message));
    // WebKit does not accept Secure cookies over loopback HTTP. Keep production
    // cookie security unchanged; adapt only this isolated HTTP browser fixture.
    await visitor.route("**/api/auth/login", async (route) => {
      const response = await route.fetch();
      const headers = response.headers();
      if (headers["set-cookie"]) {
        assert.match(headers["set-cookie"], /; Secure/i);
        headers["set-cookie"] = headers["set-cookie"].replace(/; Secure/gi, "");
      }
      await route.fulfill({ response, headers });
    });
    await visitor.goto(base);
    await visitor.getByRole("button", { name: "Need an account?" }).click();
    await visitor.getByLabel("Username", { exact: true }).fill("ui-friend");
    await visitor.getByLabel("Display name", { exact: true }).fill("Friend awaiting administrator approval");
    await visitor.getByLabel("Password", { exact: true }).fill("PreviewOnly2026!");
    await visitor.getByRole("button", { name: "Request an account", exact: true }).click();
    await visitor.getByRole("status").filter({ hasText: "Account requested" }).waitFor();
    await visitor.screenshot({ path: path.join(temp, "registration-pending-320.png"), fullPage: true });
    assert(!(await visitor.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "Registration screen overflow");
    await page.goto(base);
    await page.getByRole("navigation").getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "Approve ui-friend", exact: true }).waitFor();
    for (const width of [320, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      assert(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `Approval screen ${width}px overflow`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(temp, "admin-approval-390.png"), fullPage: true });
    await page.getByRole("button", { name: "Approve ui-friend", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "can now sign in" }).waitFor();
    await visitor.getByLabel("Password", { exact: true }).fill("PreviewOnly2026!");
    await visitor.getByRole("button", { name: "Sign in", exact: true }).click();
    await visitor.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
    await page.getByLabel("New accounts", { exact: true }).selectOption("closed");
    await page.getByRole("button", { name: "Save registration", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Registration settings saved" }).waitFor();
    await visitorContext.clearCookies();
    await visitor.reload();
    await visitor.getByText("Registration is closed.", { exact: true }).waitFor();
    assert.equal(await visitor.getByRole("button", { name: "Need an account?" }).count(), 0);
    await visitorContext.close();
  }
  const viewNames = ["Dashboard", "Calendar", "Events", "Free Time", "Profile", "Admin", "Games", "Friends", "Squads", "Proposals", "Tonight"];
  for (const theme of baseline || interactionsOnly ? ["dark"] : ["dark", "light"]) {
    await request(contexts[0], "/api/profile", {...accounts[0], theme}, "PUT");
    await page.goto(base);
    await page.getByRole("heading", {name:"Dashboard", exact:true}).waitFor();
    for (const [width, height] of baseline || interactionsOnly ? [[1440, 1000]] : [[1440, 1000], [1280, 900], [1024, 768], [768, 1024], [430, 932], [390, 844], [320, 740]]) {
      await page.setViewportSize({width, height});
      for (const name of baseline || interactionsOnly ? ["Dashboard", "Calendar"] : viewNames) {
        await page.getByRole("navigation").getByRole("button", {name, exact:true}).click();
        if (name === "Calendar") {
          await page.getByRole("button", {name:"Today", exact:true}).click();
          await page.getByRole("button", {name:"Next week", exact:true}).click();
        }
        await page.locator(".loading-indicator").waitFor({state:"hidden"});
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(() => {
          const root = document.querySelector(".workspace").getBoundingClientRect();
          return Array.from(document.querySelectorAll(".workspace button, .workspace input, .workspace select, .workspace textarea"))
            .filter((el) => !el.closest(".pulse-calendar-scroll, .best-slot-runway, .availability-popover, .event-popover"))
            .filter((el) => el.getClientRects().length && (el.getBoundingClientRect().right > root.right + 1 || el.getBoundingClientRect().left < root.left - 1))
            .map((el) => el.className || el.tagName);
        });
        if (!baseline) assert.deepEqual(overflow, [], `${theme} ${width}px ${name}: controls overflow`);
        if (!baseline) await checkDateTimeBounds(page, `${theme} ${width}px ${name}`);
        if ((width === 1440 || width === 390) && ["Dashboard", "Calendar", "Free Time", "Profile"].includes(name)) {
          await page.screenshot({path: path.join(temp, `${theme}-${width}-${name.replaceAll(" ", "-").toLowerCase()}.png`), fullPage:true, animations:"disabled"});
        }
        if (!baseline && name === "Calendar") {
          await page.getByRole("button", {name:"Log free time", exact:true}).click();
          await page.getByRole("button", {name:"Weekly", exact:true}).click();
          await page.getByRole("button", {name:"New session", exact:true}).first().click();
          await checkDateTimeBounds(page, `${theme} ${width}px expanded composers`);
          const composerOverflow = await page.locator(".pulse-dock-stack").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
          if (width === 390 || composerOverflow) await page.locator(".pulse-dock-stack").screenshot({path:path.join(temp, `${theme}-${width}-composers.png`), animations:"disabled"});
          assert(!composerOverflow, `${theme} ${width}px composer overflow; screenshots: ${temp}`);
        }
      }
    }
    if (!baseline) {
      await page.getByRole("navigation").getByRole("button", {name:"Calendar", exact:true}).click();
      await page.getByRole("button", {name:"New session", exact:true}).first().click();
      await page.getByLabel("Session title", {exact:true}).fill("Orientation check");
      await page.locator(".pulse-date-field input").fill(dateAt(2));
      await page.locator('.pulse-time-field input').first().fill("19:15");
      await page.locator('.pulse-time-field input').last().fill("22:45");
      for (const [width, height] of [[1024, 768], [768, 1024], [844, 390], [390, 844]]) {
        await page.setViewportSize({width, height});
        assert.equal(await page.getByLabel("Session title", {exact:true}).inputValue(), "Orientation check");
        assert.equal(await page.locator(".pulse-date-field input").inputValue(), dateAt(2));
        assert.equal(await page.locator(".pulse-time-field input").first().inputValue(), "19:15");
        assert.equal(await page.locator(".pulse-time-field input").last().inputValue(), "22:45");
        await checkDateTimeBounds(page, `${theme} ${width}px rotated composers`);
        assert(!(await page.locator(".pulse-dock-stack").evaluate((el) => el.scrollWidth > el.clientWidth + 1)), `${theme} ${width}px rotated composer overflow`);
      }
    }
  }
  if (!baseline) {
    await page.setViewportSize({width: 1440, height: 1000});
    await page.getByRole("navigation").getByRole("button", {name:"Calendar", exact:true}).click();
    await page.getByRole("button", {name:"Today", exact:true}).click();
    await page.getByRole("button", {name:"Next week", exact:true}).click();
    assert.equal(await page.locator("[data-calendar-slot]").count(), 49);
    await page.getByRole("button", {name:"5 days", exact:true}).click();
    assert.equal(await page.locator("[data-calendar-slot]").count(), 35);
    await page.getByRole("button", {name:"Week", exact:true}).click();
    const details = page.locator('[aria-label="Calendar details"]');
    await page.locator("[data-availability-block]").first().click();
    for (const name of ["Alex Morgan", "Jamie", "Sam", "Riley"]) assert((await details.innerText()).includes(name));
    await page.getByRole("button", {name:"Close free time", exact:true}).click();
    const eventBlock = page.locator(`[data-event-id="${session.id}"]`);
    await eventBlock.click();
    assert.match(await details.innerText(), /3\/4 accepted: Alex Morgan, Jamie, Sam/);
    const intersections = await page.locator("[data-event-block]").evaluateAll(events => events.flatMap(event => {
      const a = event.getBoundingClientRect();
      return [...document.querySelectorAll("[data-availability-block]")].filter(free => {
        const b = free.getBoundingClientRect();
        return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      }).map(() => event.getAttribute("data-event-id"));
    }));
    assert.deepEqual(intersections, [], "Events and free time must occupy separate lanes");
    const start = page.locator(`[data-calendar-slot][data-date="${dateAt(0)}"][data-hour="17:00"]`);
    const end = page.locator(`[data-calendar-slot][data-date="${dateAt(2)}"][data-hour="18:00"]`);
    await start.scrollIntoViewIfNeeded();
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const a = await start.boundingBox();
    const b = await end.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {steps: 12});
    await page.mouse.up();
    const availabilityForm = page.locator(".availability-composer");
    try {
      await availabilityForm.getByText("3 days selected. Saving will repeat these weekdays.", {exact:true}).waitFor({timeout: 5000});
    } catch (failure) {
      await page.screenshot({path:path.join(temp, "drag-failure.png"), fullPage:true});
      console.log(`Drag failure screenshot: ${temp}; form: ${await availabilityForm.allTextContents()}`);
      throw failure;
    }
    assert.equal(await availabilityForm.locator('.weekday-picker button[aria-pressed="true"]').count(), 3);
    assert.equal(await availabilityForm.locator('input[type="time"]').first().inputValue(), "17:00");
    assert.equal(await availabilityForm.locator('input[type="time"]').last().inputValue(), "19:00");
    await eventBlock.dragTo(page.locator(`[data-calendar-slot][data-date="${dateAt(1)}"][data-hour="23:00"]`));
    await page.getByRole("alert").filter({hasText:"Choose an earlier start"}).waitFor();
    let rescheduled;
    try {
      [rescheduled] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith(`/api/events/${session.id}`) && response.request().method() === "PATCH", {timeout:10000}),
        eventBlock.dragTo(start)
      ]);
    } catch (failure) {
      await page.screenshot({path:path.join(temp, "reschedule-failure.png"), fullPage:true});
      console.log(`Reschedule failure screenshot: ${temp}`);
      throw failure;
    }
    assert(rescheduled.ok(), "Drag rescheduling should succeed");
    await page.locator(`[data-event-id="${session.id}"][aria-label*="17:00 to 19:30"]`).waitFor();
    const repeat = await request(contexts[0], "/api/availability/recurring", {weekdays:[1], startDate:dateAt(0), startTime:"18:00", endTime:"21:00", note:"Weekly gaming"});
    await request(contexts[0], "/api/availability", {date:dateAt(4), startTime:"10:00", endTime:"12:00", note:"Morning slot"});
    await page.reload();
    await page.getByRole("navigation").getByRole("button", {name:"Calendar", exact:true}).click();
    await page.getByRole("button", {name:"Next week", exact:true}).click();
    await page.getByRole("button", {name:"My free time", exact:true}).click();
    const occurrenceId = `rule-${repeat.id}-${dateAt(0)}`;
    const ownOccurrence = page.locator(`[data-availability-id="${occurrenceId}"]`);
    await ownOccurrence.waitFor();
    assert.equal(await page.locator("[data-event-block]").count(), 0);
    assert.equal(await page.locator("[data-personal-availability]").count(), 5, "Own entries should remain separate and include committed time");
    assert.equal(await page.getByLabel("Manage player", {exact:true}).inputValue(), String(accounts[0].id));
    await page.screenshot({path:path.join(temp, "personal-calendar-1440.png"), fullPage:true, animations:"disabled"});
    await page.getByLabel("Manage player", {exact:true}).selectOption(String(accounts[1].id));
    assert.equal(await page.locator("[data-personal-availability]").count(), 3);
    assert.equal(await page.getByRole("button", {name:"Log free time", exact:true}).count(), 0);
    await page.getByRole("button", {name:"My free time", exact:true}).click();
    await page.setViewportSize({width:390, height:844});
    await ownOccurrence.click();
    const editor = page.getByRole("dialog", {name:"Free time", exact:true});
    await editor.waitFor();
    assert(await editor.getByRole("radio", {name:"This date only", exact:true}).isChecked());
    for (const [width, height] of [[390,844], [844,390], [320,740], [768,1024], [1024,768]]) {
      await page.setViewportSize({width,height});
      await checkDateTimeBounds(page, `availability editor ${width}px`);
      assert(!(await editor.evaluate(element => element.scrollWidth > element.clientWidth + 1)), `Editor overflow ${width}px`);
    }
    await page.setViewportSize({width:390,height:844});
    await editor.getByLabel("Start time", {exact:true}).fill("18:15");
    await editor.getByLabel("End time", {exact:true}).fill("20:15");
    await editor.screenshot({path:path.join(temp, "availability-editor-390.png")});
    await editor.getByRole("button", {name:"Save changes", exact:true}).click();
    await editor.waitFor({state:"hidden"});
    await ownOccurrence.waitFor({state:"detached"});
    const editedEntry = page.locator('[data-personal-availability][aria-label*="18:15 to 20:15"]');
    await editedEntry.waitFor();
    await editedEntry.click();
    await page.keyboard.press("Escape");
    await editor.waitFor({state:"hidden"});
    await page.waitForFunction(() => document.activeElement?.hasAttribute("data-personal-availability"));
    await page.getByRole("button", {name:"Next week", exact:true}).click();
    const nextOccurrence = page.locator(`[data-availability-id="rule-${repeat.id}-${dateAt(7)}"]`);
    await nextOccurrence.click();
    assert.equal(await editor.getByLabel("Start time", {exact:true}).inputValue(), "18:00", "One-date edit must not change next week");
    await editor.getByRole("radio", {name:"Every Monday (whole series)", exact:true}).check();
    await editor.getByLabel("Start time", {exact:true}).fill("20:15");
    await editor.getByLabel("End time", {exact:true}).fill("21:45");
    await editor.getByRole("button", {name:"Save changes", exact:true}).click();
    await editor.waitFor({state:"hidden"});
    await page.locator(`[data-availability-id="rule-${repeat.id}-${dateAt(7)}"][aria-label*="20:15 to 21:45"]`).waitFor();
    await nextOccurrence.click();
    await editor.getByRole("radio", {name:"Every Monday (whole series)", exact:true}).check();
    await editor.getByRole("button", {name:"Delete series", exact:true}).click();
    await editor.getByRole("button", {name:"Confirm delete", exact:true}).click();
    await editor.waitFor({state:"hidden"});
    await nextOccurrence.waitFor({state:"detached"});
    await page.getByRole("button", {name:"Previous week", exact:true}).click();
    await editedEntry.waitFor();
    await editedEntry.click();
    await editor.getByRole("button", {name:"Delete entry", exact:true}).click();
    await editor.getByRole("button", {name:"Confirm delete", exact:true}).click();
    await editor.waitFor({state:"hidden"});
    await editedEntry.waitFor({state:"detached"});
    await page.getByRole("navigation").getByRole("button", {name:"Free Time", exact:true}).click();
    await page.getByLabel("Week of", {exact:true}).fill(dateAt(0));
    const agenda = page.locator('[aria-label="Availability agenda"]');
    await agenda.getByRole("heading").first().waitFor();
    assert.match(await agenda.getByRole("heading").first().innerText(), /Monday,? \d+ \w+ \d{4}/);
    assert.equal(await page.getByLabel("Show", {exact:true}).inputValue(), "mine");
    await page.getByLabel("Show", {exact:true}).selectOption("all");
    await agenda.getByText("Riley", {exact:true}).first().waitFor();
    await page.screenshot({path:path.join(temp, "availability-agenda-390.png"), fullPage:true});
    const memberPage = await contexts[3].newPage();
    memberPage.on("pageerror", error => errors.push(error.message));
    await memberPage.route("**/api/games?*", route => route.fulfill({json:{games:[]}}));
    await memberPage.goto(base);
    await memberPage.getByRole("navigation").getByRole("button", {name:"Calendar", exact:true}).click();
    await memberPage.getByRole("button", {name:"Next week", exact:true}).click();
    await memberPage.getByRole("button", {name:"My free time", exact:true}).click();
    await memberPage.locator("[data-personal-availability]").first().waitFor();
    assert.equal(await memberPage.getByLabel("Manage player", {exact:true}).count(), 0);
    assert.equal(await memberPage.locator("[data-personal-availability]").count(), 3);
    await memberPage.getByRole("button", {name:"Squad", exact:true}).click();
    await memberPage.locator('[data-availability-block][aria-label*="Jamie"]').first().click();
    const memberEditor = memberPage.getByRole("dialog", {name:"Free time", exact:true});
    await memberEditor.getByRole("button").filter({hasText:"Jamie"}).click();
    assert(await memberEditor.getByLabel("Start time", {exact:true}).isDisabled());
    assert.equal(await memberEditor.getByRole("button", {name:"Save changes", exact:true}).count(), 0);
    await memberPage.close();
    // Test fallback loading with a local bitmap, without relying on Steam availability.
    const bitmap = await readFile("public/squadslot-192.png");
    await page.route("https://**/*", (route) => route.request().url().includes("cdn.cloudflare.steamstatic.com")
      ? route.fulfill({contentType:"image/png", body:bitmap})
      : route.fulfill({status:404, body:"Missing"}));
    await page.goto(base);
    await page.waitForFunction(() => {
      const image = document.querySelector("img.next-event-art");
      return image?.complete && image.naturalWidth > 0 && image.src.includes("cdn.cloudflare.steamstatic.com");
    });
    await page.route("https://**/*", (route) => route.fulfill({status:404, body:"Missing"}));
    await page.reload();
    await page.locator(".next-event-art.image-fallback").waitFor();
    await page.getByRole("navigation").getByRole("button", { name: "Admin", exact: true }).click();
    const backupPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Backup and restore", exact: true }) });
    const downloadEvent = page.waitForEvent("download");
    await backupPanel.getByRole("button", { name: "Download encrypted backup", exact: true }).click();
    const download = await downloadEvent;
    assert.match(download.suggestedFilename(), /\.json\.enc$/);
    const exported = JSON.parse(await readFile(await download.path(), "utf8"));
    assert.equal(exported.format, "squadslot-encrypted-backup");
    const upload = { name: "backup-with-a-long-name-for-mobile-layout-verification.json.enc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) };
    let restores = 0;
    page.on("request", request => { if (request.url().endsWith("/api/admin/backup/restore")) restores += 1; });
    await backupPanel.getByLabel("Restore from file", { exact: true }).setInputFiles(upload);
    const restoreButton = backupPanel.getByRole("button", { name: "Restore and sign out", exact: true });
    await restoreButton.waitFor();
    assert(await restoreButton.isDisabled());
    assert(await backupPanel.getByLabel("Revoke calendar subscription links", { exact: true }).isChecked());
    assert.equal(restores, 0, "Selecting a file must not restore data");
    for (const [width, height] of [[320,740], [390,844], [844,390], [768,1024], [1024,768], [1440,1000]]) {
      await page.setViewportSize({width,height});
      assert(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `Backup page overflow ${width}px`);
      await backupPanel.screenshot({path:path.join(temp, `backup-restore-${width}.png`)});
      const overflowingBackupElements = await backupPanel.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return [...element.querySelectorAll("*")].filter(child => child.getBoundingClientRect().right > bounds.right + 1).map(child => `${child.tagName}.${child.className}`);
      });
      assert(!(await backupPanel.evaluate(element => element.scrollWidth > element.clientWidth + 1)), `Backup panel overflow ${width}px: ${overflowingBackupElements.join(", ")}. Screenshot: ${temp}`);
      if (width === 390 || width === 1440) await backupPanel.screenshot({path:path.join(temp, `backup-restore-${width}.png`)});
    }
    await backupPanel.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(restores, 0);
    await backupPanel.getByLabel("Restore from file", { exact: true }).setInputFiles({ ...upload, buffer: Buffer.from(JSON.stringify({ ...exported, tag: "invalid" })) });
    await backupPanel.getByLabel("I understand this replaces all current data.", { exact: true }).check();
    await restoreButton.click();
    await backupPanel.getByRole("alert").filter({hasText:"Invalid encrypted backup field"}).waitFor();
    await backupPanel.getByLabel("Restore from file", { exact: true }).setInputFiles(upload);
    assert(await restoreButton.isDisabled());
    await backupPanel.getByLabel("I understand this replaces all current data.", { exact: true }).check();
    await restoreButton.click();
    await page.getByLabel("Username", { exact: true }).waitFor();
    assert.equal(restores, 2, "Only explicitly confirmed restores are sent");
  }
  assert.deepEqual(errors, [], "Browser runtime errors");
  console.log(`${engine.name()} layout review passed. Screenshots: ${temp}`);
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
}
