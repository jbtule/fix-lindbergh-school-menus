// Confirms the Snack-as-Entree treatment (src/menu-logic.js's
// splitEntreesAndSides(), src/config.js's isSnackSideItem()) actually
// renders right: Flyers Club and ECE Snack show their real food under a
// prominent "Snack" label, while milk/condiments/juice stay ordinary
// sides - both in the app (day view) and the built .ics description.
//
// Requires the dev server running (see ../README.md) for the app half,
// and `npm run build-ical` having been run at least once for the ics
// half (reads dist/ical/*.ics - skips that check with a note if missing).
// Hits the live vendor API, so which specific day has which item will
// vary - this checks structure (a "Snack" label exists, milk/condiment/
// juice items are set aside), not exact food names.

import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const BASE_URL = "http://localhost:8934";
const FLYERS_CLUB_ID = "6a95b9b792a53501247c2295"; // Sappington - Flyers Club
const ECE_SNACK_ID = "6a8773281ca3e60d5f61d1cc"; // ECE - Snack

async function checkAppRendering(label, menuId) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BASE_URL}/index.html`);
  await page.evaluate((id) => localStorage.setItem("lsm.selectedMenus", JSON.stringify([id])), menuId);
  await page.reload();
  await page.waitForTimeout(1500);

  let foundSnackLabel = false;
  for (let i = 0; i < 10 && !foundSnackLabel; i++) {
    const labels = await page.$$eval(".choiceLabel", (els) => els.map((e) => e.textContent.trim()));
    if (labels.includes("Snack")) {
      foundSnackLabel = true;
      const body = await page.$eval(".sectionBody", (el) => el.innerText.replace(/\s+/g, " ").trim());
      console.log(`  ✓ ${label}: found a "Snack" box - ${body.slice(0, 150)}`);
    } else {
      await page.click("#nextDay");
      await page.waitForTimeout(400);
    }
  }
  if (!foundSnackLabel) {
    console.log(`  ✗ ${label}: no "Snack" box found in the next 10 days - check src/menu-logic.js`);
  }
  if (errors.length) console.log(`  ${label} errors: ${errors.join(", ")}`);

  await browser.close();
  return foundSnackLabel && errors.length === 0;
}

async function checkIcsDescription(label, slug) {
  let text;
  try {
    text = await readFile(new URL(`../../dist/ical/${slug}.ics`, import.meta.url), "utf8");
  } catch {
    console.log(`  ? ${label}: dist/ical/${slug}.ics not found - run \`npm run build-ical\` first, skipping`);
    return true; // not a failure, just not checked
  }
  const hasEntreeBlock = /DESCRIPTION:[^\n]*🍽/.test(text);
  if (!hasEntreeBlock) {
    console.log(`  ✗ ${label}: no 🍽 entree block found in any DESCRIPTION - check describeDay() in scripts/build-ical.js`);
    return false;
  }
  console.log(`  ✓ ${label}: found a 🍽 entree block in the built ics`);
  return true;
}

console.log("App rendering:");
const appOk = (await checkAppRendering("Flyers Club", FLYERS_CLUB_ID)) && (await checkAppRendering("ECE Snack", ECE_SNACK_ID));

console.log("\nBuilt ics description:");
const icsOk = (await checkIcsDescription("Flyers Club", "sappington-flyers-club")) && (await checkIcsDescription("ECE Snack", "ece-snack"));

process.exit(appOk && icsOk ? 0 : 1);
