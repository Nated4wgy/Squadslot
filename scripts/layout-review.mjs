/* global document */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

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
    DISCORD_WEBHOOK_URL: "", DISCORD_BOT_TOKEN: "", AUTO_BACKUP_ENABLED: "false"
  },
  stdio: "ignore"
});
let browser;
const baseline = process.argv.includes("--baseline");
try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error("Preview server exited");
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await chromium.launch();
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
    accounts.push((await request(context, "/api/auth/register", {
      username: `review${index}`, displayName, password: "PreviewOnly2026!"
    })).user);
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
  const viewNames = ["Dashboard", "Calendar", "Events", "Free Time", "Profile", "Admin", "Games", "Friends", "Squads", "Proposals", "Tonight"];
  for (const theme of baseline ? ["dark"] : ["dark", "light"]) {
    await request(contexts[0], "/api/profile", {...accounts[0], theme}, "PUT");
    await page.goto(base);
    await page.getByRole("heading", {name:"Dashboard", exact:true}).waitFor();
    for (const [width, height] of baseline ? [[1440, 1000]] : [[1440, 1000], [1280, 900], [1024, 768], [768, 1024], [390, 844], [320, 740]]) {
      await page.setViewportSize({width, height});
      for (const name of baseline ? ["Dashboard", "Calendar"] : viewNames) {
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
        if ((width === 1440 || width === 390) && ["Dashboard", "Calendar", "Free Time", "Profile"].includes(name)) {
          await page.screenshot({path: path.join(temp, `${theme}-${width}-${name.replaceAll(" ", "-").toLowerCase()}.png`), fullPage:true, animations:"disabled"});
        }
        if (!baseline && name === "Calendar") {
          await page.getByRole("button", {name:"Log free time", exact:true}).click();
          await page.getByRole("button", {name:"Weekly", exact:true}).click();
          await page.getByRole("button", {name:"New session", exact:true}).first().click();
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
      for (const [width, height] of [[1024, 768], [768, 1024], [844, 390], [390, 844]]) {
        await page.setViewportSize({width, height});
        assert.equal(await page.getByLabel("Session title", {exact:true}).inputValue(), "Orientation check");
        assert(!(await page.locator(".pulse-dock-stack").evaluate((el) => el.scrollWidth > el.clientWidth + 1)), `${theme} ${width}px rotated composer overflow`);
      }
    }
  }
  if (!baseline) {
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
  }
  assert.deepEqual(errors, [], "Browser runtime errors");
  console.log(`Layout review passed. Screenshots: ${temp}`);
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
}
