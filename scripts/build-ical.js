// Builds one .ics file per selectable menu, plus one per combination of
// Idea Center day-variants (e.g. "Tuesdays + Thursdays"), for the GitHub
// Action in .github/workflows/build-ical.yml to deploy to Cloudflare Pages.
//
// Reuses the exact same vendor-fetch code and district data the browser app
// uses - see menu-api.js and config.js - so there's nothing vendor-specific
// duplicated here, just the ical-shaping logic.

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEvents } from "ics";
import { MENU_BY_ID, ALLERGEN_DEFS, IDEA_CENTER_GRADE_BY_WEEKDAY } from "../config.js";
import { fetchMonthsList, fetchMenuItems } from "../menu-api.js";
import { icsSlugFor } from "../ical-naming.js";

const OUT_DIR = new URL("../dist/ical/", import.meta.url);

// A quick visual cue in the SUMMARY (see titleForDay) for which meal this
// is, without the verbosity of a text prefix (see the School Meal prefix
// this replaced - dropped as too noisy). Flyers Club and Snack share one
// icon - both are the lighter, informal meal at whichever school has them.
const MEAL_EMOJI = {
  Breakfast: "🥞",
  Lunch: "🥪",
  "Flyers Club": "🍎",
  Snack: "🍎",
};

function mealEmoji(meal) {
  return MEAL_EMOJI[meal] || "";
}

// Every non-empty subset of a small array, as arrays in their original
// relative order (there are only ever 4 weekdays to combine, so 2^4-1 = 15
// subsets at most - no need for anything fancier than a bitmask walk).
function nonEmptySubsets(items) {
  const subsets = [];
  for (let mask = 1; mask < 1 << items.length; mask++) {
    subsets.push(items.filter((_, i) => mask & (1 << i)));
  }
  return subsets;
}

// One calendar to build: { slug, title, apiId, weekdays } - weekdays null
// means "every day the API has data for", otherwise only those getDay()
// values are included (used for Idea Center variants/combos).
function buildTargets() {
  const targets = [];
  const byApiId = new Map(); // apiId -> [{id, info}] sharing it (Idea Center)
  for (const [id, info] of Object.entries(MENU_BY_ID)) {
    if (!byApiId.has(info.apiId)) byApiId.set(info.apiId, []);
    byApiId.get(info.apiId).push({ id, info });
  }

  for (const [apiId, entries] of byApiId) {
    const specificDayEntries = entries.filter((e) => e.info.dayFilter !== null);
    if (specificDayEntries.length === 0) {
      // Ordinary menu - one calendar, no day restriction.
      const { info } = entries[0];
      targets.push({
        slug: icsSlugFor({ name: info.name, school: info.school, apiId, hasFullWeek: true, specificDays: new Set() }),
        title: `${info.school} - ${info.name}`,
        emoji: mealEmoji(info.name),
        apiId,
        weekdays: null,
      });
      continue;
    }

    // Idea Center baseName is always "Idea Center Breakfast"/"Idea Center
    // Lunch" - the meal is its last word, since Idea Center menus don't
    // carry a separate meal field the way other schools' menus do.
    const ideaCenterEmoji = mealEmoji(specificDayEntries[0].info.baseName.split(" ").pop());

    // Idea Center menu-type: one calendar per individual day-variant. Named
    // by grade rather than weekday - attendance is by grade (see
    // IDEA_CENTER_GRADE_BY_WEEKDAY in config.js), and that's what a parent
    // actually identifies their kid by, not "Tuesdays".
    for (const { info } of specificDayEntries) {
      const grade = IDEA_CENTER_GRADE_BY_WEEKDAY[info.dayFilter];
      targets.push({
        slug: icsSlugFor({
          name: info.baseName,
          apiId,
          hasFullWeek: false,
          specificDays: new Set([info.dayFilter]),
        }),
        title: `${info.baseName} - ${grade}`,
        emoji: ideaCenterEmoji,
        apiId,
        weekdays: [info.dayFilter],
      });
    }
    // ...the standalone "Full Week" variant, if present...
    const fullWeek = entries.find((e) => e.info.dayFilter === null);
    if (fullWeek) {
      targets.push({
        slug: icsSlugFor({ name: fullWeek.info.baseName, apiId, hasFullWeek: true, specificDays: new Set() }),
        title: fullWeek.info.name,
        emoji: ideaCenterEmoji,
        apiId,
        weekdays: null,
      });
    }
    // ...and every combination of two or more of those grades' days (the
    // "leap" menus - a family with kids attending on different days/grades
    // of the same program wants one calendar covering all of them at once).
    const days = specificDayEntries.map((e) => e.info.dayFilter);
    for (const combo of nonEmptySubsets(days)) {
      if (combo.length < 2) continue; // singles already added above
      const grades = combo.map((d) => IDEA_CENTER_GRADE_BY_WEEKDAY[d]);
      const baseName = specificDayEntries[0].info.baseName;
      targets.push({
        slug: icsSlugFor({ name: baseName, apiId, hasFullWeek: false, specificDays: new Set(combo) }),
        title: `${baseName} - ${grades.join(" + ")}`,
        // Only used to build each event's own description header (see
        // buildCalendar) - a given day belongs to just one grade, even
        // though the calendar as a whole covers several.
        baseName,
        emoji: ideaCenterEmoji,
        apiId,
        weekdays: combo,
      });
    }
  }
  return targets;
}

// The API sends allergen_* flags as "1"/null rather than real booleans -
// same convention as isAllergenFlagged() in app.js.
function isAllergenFlagged(v) {
  return v === true || v === "1" || v === 1;
}

// Flagged allergen labels for one product, e.g. ["Milk", "Wheat"] - in
// ALLERGEN_DEFS order. Excludes `positive: true` entries (Vegetarian) -
// those are a dietary claim, not an allergen warning, so they don't belong
// under "Allergens:" (see ALLERGEN_DEFS's own comment in config.js).
function allergensFor(product) {
  return ALLERGEN_DEFS.filter((def) => !def.positive && isAllergenFlagged(product[def.field])).map(
    (def) => def.label
  );
}

// Plain-text description for a calendar event: entrees first, then
// everything else, one item per line with its flagged allergens in
// parentheses. Deliberately simpler than the web app's grouped/categorized
// rendering (renderSideGroups() etc. in app.js) - a calendar description
// doesn't need collapsible sections, just a quick read of what's being
// served and what's in it.
function describeDay(items) {
  const entrees = items.filter((it) => it.product.category === "Entrees");
  const sides = items.filter((it) => it.product.category !== "Entrees");
  const lines = [...entrees, ...sides]
    .filter((it) => it.product.name)
    .map((it) => {
      const allergens = allergensFor(it.product);
      return allergens.length ? `${it.product.name} (Allergens: ${allergens.join(", ")})` : it.product.name;
    });
  return lines.join("\n");
}

// Multiple entrees on the same day are alternative choices, not a combo
// meal - "-or-" makes that unambiguous in the calendar's day view. A day
// with no Entrees at all (e.g. ECE's Snack menu, which has no entree
// category) falls back to listing whatever items there are instead, rather
// than just repeating the menu's own name. Prefixed with the meal's emoji
// (see MEAL_EMOJI) as a quick visual cue when several calendars are
// overlaid in one day view.
function titleForDay(items, target) {
  const entrees = items
    .filter((it) => it.product.category === "Entrees")
    .map((it) => it.product.name)
    .filter(Boolean);
  const names = items.map((it) => it.product.name).filter(Boolean);
  const body = entrees.length ? entrees.join(" -or- ") : names.join(", ");
  return target.emoji ? `${target.emoji} ${body}` : body;
}

// The district's own schema has a hide_on_calendars flag - apparently meant
// for exactly this use case - that the web app doesn't honor (see
// HONOR_HIDE_FLAGS in app.js, which covers hide_on_web_menu_view too and is
// off by default). Here, honor hide_on_calendars specifically: an ical
// export is the literal thing that flag describes.
function isHiddenFromCalendar(product) {
  const v = product.hide_on_calendars;
  return v === true || v === "1" || v === 1;
}

// Keep in sync with the `schedule` in .github/workflows/build-ical.yml -
// this tells subscribing calendar apps how often to re-poll the feed, so it
// should match how often the data actually changes, not be left at
// whatever a library defaults to.
const REFRESH_INTERVAL = "P1D";

// The `ics` package hardcodes X-PUBLISHED-TTL to PT1H with no way to
// configure it (see node_modules/ics/dist/pipeline/format.js) - rewritten
// here to REFRESH_INTERVAL instead, and REFRESH-INTERVAL (the newer RFC
// 7986 property some clients prefer) added alongside it.
function withRefreshInterval(ics) {
  return ics
    .replace("X-PUBLISHED-TTL:PT1H\r\n", `X-PUBLISHED-TTL:${REFRESH_INTERVAL}\r\n`)
    .replace("CALSCALE:GREGORIAN\r\n", `CALSCALE:GREGORIAN\r\nREFRESH-INTERVAL;VALUE=DURATION:${REFRESH_INTERVAL}\r\n`);
}

async function buildCalendar(target) {
  const months = await fetchMonthsList(target.apiId);
  const events = [];
  for (const m of months) {
    const docId = m._id && m._id.$id;
    if (!docId) continue;
    const year = Number(m.year);
    const month = Number(m.month); // 0-based, matches JS Date
    const items = await fetchMenuItems(docId);
    const byDay = new Map();
    for (const it of items) {
      if (!it.product || isHiddenFromCalendar(it.product)) continue;
      if (!byDay.has(it.day)) byDay.set(it.day, []);
      byDay.get(it.day).push(it);
    }
    for (const [day, dayItems] of byDay) {
      const date = new Date(year, month, day);
      if (target.weekdays && !target.weekdays.includes(date.getDay())) continue;
      const description = describeDay(dayItems);
      if (!description) continue;
      // A combo calendar's own title lists every grade it covers (e.g.
      // "5th Grade + 4th Grade"), but any one day only belongs to one of
      // them - the description header should say just that day's grade,
      // not the whole combo.
      const header = target.baseName
        ? `${target.baseName} - ${IDEA_CENTER_GRADE_BY_WEEKDAY[date.getDay()]}`
        : target.title;
      events.push({
        start: [year, month + 1, day], // ics months are 1-indexed
        duration: { days: 1 },
        title: titleForDay(dayItems, target),
        description: `${header}\n\n${description}`,
        uid: `${target.slug}-${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}@fix-lindbergh-school-menus`,
      });
    }
  }
  const { error, value } = createEvents(events, { calName: target.title });
  if (error) throw error;
  return withRefreshInterval(value);
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const targets = buildTargets();
  console.log(`Building ${targets.length} calendars...`);
  let ok = 0;
  for (const target of targets) {
    try {
      const ics = await buildCalendar(target);
      await writeFile(new URL(`${target.slug}.ics`, OUT_DIR), ics);
      ok++;
    } catch (err) {
      console.error(`Failed to build ${target.slug}: ${err.message}`);
    }
  }
  console.log(`Wrote ${ok}/${targets.length} calendars to ${path.relative(process.cwd(), OUT_DIR.pathname)}`);
  if (ok === 0) process.exitCode = 1;
}

await main();
