/* global document, window, getComputedStyle */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { chromium, webkit } from "playwright";

const temp = await mkdtemp(path.join(os.tmpdir(), "squadslot-motion-"));
const listener = net.createServer().listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--configLoader", "runner"], { stdio: "ignore" });
let browser;
try {
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error("Preview server exited");
    try { if ((await fetch(base)).ok) break; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await (process.argv.includes("--webkit") ? webkit : chromium).launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()); });
  await page.goto(`${base}/?motion-preview=1`);
  await page.getByRole("heading", {name:"Motion lab"}).waitFor();
  assert.equal(await page.getByRole("button", {name:"Full",exact:true}).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", {name:"Full",exact:true}).click();
  await page.getByRole("button", {name:"Open event",exact:true}).click();
  await page.getByRole("button", {name:"Complete squad",exact:true}).click();
  assert.equal(await page.locator(".ready-players > span").first().evaluate(el => getComputedStyle(el).animationName), "squad-arrival");
  await page.getByRole("button", {name:"Reveal sample winner",exact:true}).click();
  await page.locator(".winner-reveal").getByText("Deep Rock Galactic",{exact:true}).waitFor();
  assert.equal(await page.locator(".winner-reveal > div").evaluate(el => getComputedStyle(el).animationName), "squad-arrival");
  await page.getByRole("button", {name:"Replay celebration",exact:true}).click();
  assert(await page.locator(".squad-celebration").evaluate(el => el.getAnimations().length > 0));
  await page.evaluate(() => { for (const image of document.images) image.loading = "eager"; });
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0), null, {timeout:15000});
  for (const width of [1440,390,768]) {
    await page.setViewportSize({width,height:1000});
    await page.screenshot({path:path.join(temp, `full-${width}.png`),fullPage:true,animations:"disabled"});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }
  await page.getByRole("button", {name:"Subtle",exact:true}).click();
  assert.equal(await page.locator(".squad-celebration").evaluate(el => getComputedStyle(el).animationName), "none");
  await page.reload();
  await page.getByRole("heading", {name:"Motion lab"}).waitFor();
  assert.equal(await page.getByRole("button", {name:"Subtle",exact:true}).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", {name:"Complete squad",exact:true}).click();
  await page.getByRole("button", {name:"Off",exact:true}).click();
  await page.getByRole("button", {name:"Replay celebration",exact:true}).click();
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  await page.reload();
  await page.getByRole("button", {name:"Off",exact:true}).waitFor();
  assert.equal(await page.getByRole("button", {name:"Off",exact:true}).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", {name:"Full",exact:true}).click();
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.getByText("Device preference: reduced motion",{exact:true}).waitFor();
  await page.getByRole("button", {name:"Complete squad",exact:true}).click();
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  assert.deepEqual(requests, [], "Preview must never call the live API");
  assert.deepEqual(errors, []);
  console.log(`Motion checks passed: replay, reveal, intensity, persistence, reduced motion, mobile overflow, no API writes. Screenshots: ${temp}`);
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) { const done = once(server, "exit"); server.kill(); await done; }
}
