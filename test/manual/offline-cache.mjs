// Confirms the persisted-cache/instant-paint behavior (src/menu-api.js's
// readLocalCache()/writeLocalCache(), src/app.js's peekDayHtml()): a menu
// that's been viewed before keeps rendering when the vendor API becomes
// unreachable, and a menu that's never been viewed still shows the normal
// "Couldn't load" message instead of crashing.
//
// Requires the dev server running (see ../README.md). Blocks the vendor
// domains via Playwright request routing rather than the browser's real
// "offline" mode, since the latter would also block the local dev server
// itself.

import { chromium } from "playwright";

const BASE_URL = "http://localhost:8934";
const MENU_ID = "6a907b0c9dfbd85f45163c84"; // Sappington - Lunch

async function blockVendorDomains(page) {
  for (const pattern of [
    "**://api.schoolnutritionandfitness.com/**",
    "**://www.schoolnutritionandfitness.com/**",
    "**://*.asset-data.stream/**",
  ]) {
    await page.route(pattern, (route) => route.abort());
  }
}

const browser = await chromium.launch();

// Part 1: warm the cache with a normal, online visit.
const warmPage = await browser.newPage();
await warmPage.goto(`${BASE_URL}/index.html`);
await warmPage.evaluate((id) => localStorage.setItem("lsm.selectedMenus", JSON.stringify([id])), MENU_ID);
await warmPage.reload();
await warmPage.waitForTimeout(1500);
const warmBody = await warmPage.$eval(".sectionBody", (el) => el.innerText.replace(/\s+/g, " ").trim());
const storageState = await warmPage.context().storageState();
console.log(`Warm (online) load:\n  ${warmBody.slice(0, 150)}`);
await warmPage.close();

// Part 2: a fresh page reusing that same localStorage, with the vendor API
// completely blocked - should still render the cached menu.
const cachedContext = await browser.newContext({ storageState });
const cachedPage = await cachedContext.newPage();
await blockVendorDomains(cachedPage);
await cachedPage.goto(`${BASE_URL}/index.html`);
await cachedPage.waitForTimeout(2000);
const cachedBody = await cachedPage
  .$eval(".sectionBody", (el) => el.innerText.replace(/\s+/g, " ").trim())
  .catch((e) => `ERR ${e.message}`);
console.log(`\nVendor-blocked reload, cache warm:\n  ${cachedBody.slice(0, 150)}`);
const matchesWarm = cachedBody === warmBody;
console.log(matchesWarm ? "  ✓ matches the warm/online render" : "  ✗ does NOT match the warm/online render");
await cachedContext.close();

// Part 3: a brand new context (no cache at all) with the vendor API
// blocked - should show the normal error, not crash or hang.
const coldContext = await browser.newContext();
const coldPage = await coldContext.newPage();
await blockVendorDomains(coldPage);
await coldPage.goto(`${BASE_URL}/index.html`);
await coldPage.evaluate((id) => localStorage.setItem("lsm.selectedMenus", JSON.stringify([id])), MENU_ID);
await coldPage.reload();
await coldPage.waitForTimeout(2000);
const coldBody = await coldPage
  .$eval(".sectionBody", (el) => el.innerText.replace(/\s+/g, " ").trim())
  .catch((e) => `ERR ${e.message}`);
console.log(`\nVendor-blocked reload, never cached:\n  ${coldBody.slice(0, 150)}`);
const showsError = /couldn't load/i.test(coldBody);
console.log(showsError ? "  ✓ shows the normal error message" : "  ✗ expected a \"Couldn't load\" message");
await coldContext.close();

await browser.close();
process.exit(matchesWarm && showsError ? 0 : 1);
