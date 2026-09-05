// Loads the running dev server (see ../README.md), selects one menu, and
// steps through its visible week reporting what rendered and any console/
// page errors. Doesn't assert on specific menu content - that changes
// daily - just that something real rendered and nothing threw. The first
// thing to run after any change to src/app.js.
//
// Usage: node test/manual/render-smoke.mjs [menuId]
//   menuId defaults to Sappington - Lunch. Menu ids come from src/config.js
//   (MENU_BY_ID's keys, or MENU_GROUPS' `menus[].id`).

import { chromium } from "playwright";

const BASE_URL = "http://localhost:8934";
const menuId = process.argv[2] || "6a907b0c9dfbd85f45163c84"; // Sappington - Lunch

const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
});

await page.goto(`${BASE_URL}/index.html`);
await page.evaluate((id) => {
  localStorage.setItem("lsm.selectedMenus", JSON.stringify([id]));
}, menuId);
await page.reload();
await page.waitForTimeout(1500);

const heading = await page.$eval(".menuSection h2", (el) => el.textContent.replace(/\s+/g, " ").trim()).catch(() => null);
console.log(`Section heading: ${heading ?? "(none found - did the menu id resolve?)"}`);

for (let i = 0; i < 6; i++) {
  const dateLabel = await page.$eval(".dayNav", (el) => el.textContent.replace(/\s+/g, " ").trim());
  const body = await page.$eval(".sectionBody", (el) => el.innerText.replace(/\s+/g, " ").trim());
  console.log(`\n${dateLabel}\n  ${body.slice(0, 200)}`);
  await page.click("#nextDay");
  await page.waitForTimeout(400);
}

console.log(errors.length ? `\n${errors.length} error(s):\n${errors.join("\n")}` : "\nNo console/page errors.");

await browser.close();
process.exit(errors.length ? 1 : 0);
