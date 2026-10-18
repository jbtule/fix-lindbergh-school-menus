// Confirms the app works with no network at all (sw.js), not just with the
// vendor API down (that's offline-cache.mjs): one normal online visit, then
// the browser goes fully offline - local server included - and the page is
// reloaded. It should load from the service worker's cache and render the
// last-fetched menu from localStorage.
//
// Deliberately goes offline right after the first visit, without a second
// online load in between, so it also covers sw.js's precache (files loaded
// before the worker activated).
//
// Requires the dev server running (see ../README.md).

import { chromium } from "playwright";

const BASE_URL = "http://localhost:8934";
const MENU_ID = "6a907b0c9dfbd85f45163c84"; // Sappington - Lunch

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE_URL}/`);
await page.evaluate((id) => localStorage.setItem("lsm.selectedMenus", JSON.stringify([id])), MENU_ID);
await page.reload();
await page.waitForTimeout(1500);
const onlineBody = await page.$eval(".sectionBody", (el) => el.innerText.replace(/\s+/g, " ").trim());
console.log(`Online load:\n  ${onlineBody.slice(0, 150)}`);
await page.evaluate(() => navigator.serviceWorker.ready);
console.log("Service worker active");

await context.setOffline(true);
let offlineBody;
try {
  await page.reload();
  await page.waitForTimeout(2000);
  offlineBody = await page.$eval(".sectionBody", (el) => el.innerText.replace(/\s+/g, " ").trim());
} catch (e) {
  offlineBody = `ERR ${e.message.split("\n")[0]}`;
}
console.log(`\nFully offline reload:\n  ${offlineBody.slice(0, 150)}`);
const ok = offlineBody === onlineBody;
console.log(ok ? "  ✓ matches the online render" : "  ✗ does NOT match the online render");
if (errors.length) console.log(`\nPage errors:\n  ${errors.join("\n  ")}`);

await browser.close();
process.exit(ok ? 0 : 1);
