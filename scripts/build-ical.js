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
import {
  MENU_BY_ID,
  ALLERGEN_DEFS,
  IDEA_CENTER_GRADE_BY_WEEKDAY,
  SCHOOL_CALENDAR_ICS_URL,
  SCHOOL_CALENDAR_IDS,
  mealEmoji,
  SNACK_MEAL_NAMES,
  isSnackSideItem,
} from "../src/config.js";
import { fetchMonthsList, fetchMenuItems } from "../src/menu-api.js";
import { icsSlugFor } from "../src/ical-naming.js";

const OUT_DIR = new URL("../dist/ical/", import.meta.url);

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
        // See SNACK_MEAL_NAMES in config.js - Idea Center never has a
        // Flyers Club/Snack menu, so this only ever applies here, not in
        // the Idea Center branch below.
        isSnackMenu: SNACK_MEAL_NAMES.has(info.name),
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

// Plain-text description for a calendar event - no real bold/italic in a
// DESCRIPTION field, most calendar apps just show it verbatim, so "emphasis"
// here is structural: each entree gets its own 🍽-prefixed block (blank-line
// separated, so multiple choices - see the "-or-" SUMMARY - each stand out
// on their own) with its allergens directly underneath, then every side
// bulleted together under one "Sides:" header, each with its own indented
// allergen line where it has one. Deliberately simpler than the web app's
// grouped/categorized rendering (renderSideGroups() etc. in app.js) - a
// calendar description doesn't need collapsible sections, just a quick read.
function describeDay(items, isSnackMenu) {
  // No number of spaces reads as "indented" consistently - a space's
  // rendered width is tied to the font, so any whitespace-only attempt at
  // alignment looks different (and in a proportional font, much narrower
  // than expected) depending on what's rendering it. A └ marker instead
  // reads as "belongs to the line above" (tree-view style) from the
  // character itself, not a measured gap - identical regardless of font.
  const withAllergenLine = (prefix, it) => {
    const allergens = allergensFor(it.product);
    return allergens.length ? `${prefix}${it.product.name}\n└ Allergens: ${allergens.join(", ")}` : `${prefix}${it.product.name}`;
  };

  // Flyers Club/Snack (see SNACK_MEAL_NAMES): the real food is the whole
  // meal, filed under a side category, never "Entrees" - give it the same
  // 🍽 treatment as a real entree instead of burying it under "Sides:".
  // Milk, condiments, and juice (isSnackSideItem()) still go under
  // "Sides:" - ECE's Snack menu pairs those with its actual food, and
  // they aren't "the snack" the way that food is.
  const entrees = isSnackMenu
    ? items.filter((it) => !isSnackSideItem(it.product) && it.product.name)
    : items.filter((it) => it.product.category === "Entrees" && it.product.name);
  const sides = isSnackMenu
    ? items.filter((it) => isSnackSideItem(it.product) && it.product.name)
    : items.filter((it) => it.product.category !== "Entrees" && it.product.name);

  const blocks = entrees.map((it) => withAllergenLine("🍽 ", it));
  if (sides.length) {
    blocks.push(`Sides:\n${sides.map((it) => withAllergenLine("• ", it)).join("\n")}`);
  }
  return blocks.join("\n\n");
}

// Multiple entrees on the same day are alternative choices, not a combo
// meal - "-or-" makes that unambiguous in the calendar's day view. A day
// with no Entrees at all (e.g. a Flyers Club/Snack menu, which has no
// entree category) falls back to listing whatever items there are instead,
// rather than just repeating the menu's own name - excluding milk,
// condiments, and juice (isSnackSideItem()) on a snack menu, same as
// describeDay(), so they don't clutter the title either. Prefixed with the
// meal's emoji (see MEAL_EMOJI) as a quick visual cue when several
// calendars are overlaid in one day view.
function titleForDay(items, target) {
  const entrees = items
    .filter((it) => it.product.category === "Entrees")
    .map((it) => it.product.name)
    .filter(Boolean);
  const names = items
    .filter((it) => !(target.isSnackMenu && isSnackSideItem(it.product)))
    .map((it) => it.product.name)
    .filter(Boolean);
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
// here to REFRESH_INTERVAL instead.
//
// Deliberately NOT also adding REFRESH-INTERVAL (the newer RFC 7986
// equivalent, formally registered rather than X-prefixed): Google
// Calendar's "subscribe from URL" flow was rejecting every feed
// ("Calendar could not load the data"), including ones it had never seen
// before - so not a stale-cache issue - and this property (added, then
// removed, while chasing that) is the prime suspect: Google's
// subscription backend is old, and an unrecognized-but-formally-IANA
// property is more likely to trip up a non-compliant parser than an
// X-prefixed one, which every RFC5545 parser is required to tolerate
// even without understanding it. Unconfirmed against Google directly
// (no way to test that from here) - revert this if removing it doesn't
// actually fix the reported failure.
function withPublishedTTL(ics) {
  return ics.replace("X-PUBLISHED-TTL:PT1H\r\n", `X-PUBLISHED-TTL:${REFRESH_INTERVAL}\r\n`);
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
      const description = describeDay(dayItems, target.isSnackMenu);
      if (!description) continue;
      // A combo calendar's own title lists every grade it covers (e.g.
      // "5th Grade + 4th Grade"), but any one day only belongs to one of
      // them - the description header should say just that day's grade,
      // not the whole combo.
      const header = target.baseName
        ? `${target.baseName} - ${IDEA_CENTER_GRADE_BY_WEEKDAY[date.getDay()]}`
        : target.title;
      // All-day event: end is exclusive, the day after start. Using an
      // explicit end date rather than `duration: { days: 1 }` - the `ics`
      // package serializes that as "DURATION:P1DT", a malformed ISO 8601
      // duration (a bare trailing "T" with no H/M/S after it), which Apple
      // Calendar tolerates but Google Calendar's stricter parser rejects.
      const endDate = new Date(year, month, day + 1);
      events.push({
        start: [year, month + 1, day], // ics months are 1-indexed
        end: [endDate.getFullYear(), endDate.getMonth() + 1, endDate.getDate()],
        title: titleForDay(dayItems, target),
        description: `${header}\n\n${description}`,
        uid: `${target.slug}-${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}@fix-lindbergh-school-menus`,
      });
    }
  }
  const { error, value } = createEvents(events, { calName: target.title });
  if (error) throw error;
  return withPublishedTTL(value);
}

// Parses one of the district's event calendars (see SCHOOL_CALENDAR_ICS_URL/
// SCHOOL_CALENDAR_IDS in config.js) for "No School ..." all-day events,
// expanding each into every individual date it covers (DTEND is exclusive,
// same convention this file's own generated events use - see the endDate
// comment above) mapped to that event's own SUMMARY text. Hand-rolled
// rather than pulling in an ics-parsing dependency: this only ever needs
// three fields out of a much bigger feed (board meetings and the like,
// which have no DTSTART;VALUE=DATE and so are skipped outright).
function parseNoSchoolLabels(icsText) {
  const labels = {};
  const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parseDateStamp = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  for (const block of icsText.split("BEGIN:VEVENT").slice(1)) {
    const startMatch = block.match(/DTSTART;VALUE=DATE:(\d{8})/);
    if (!startMatch) continue; // a timed (non-all-day) event, e.g. a board meeting
    const summaryMatch = block.match(/SUMMARY:(.*)/);
    if (!summaryMatch || !/no school/i.test(summaryMatch[1])) continue;
    const label = summaryMatch[1].trim();
    const endMatch = block.match(/DTEND;VALUE=DATE:(\d{8})/);
    const start = parseDateStamp(startMatch[1]);
    const end = endMatch ? parseDateStamp(endMatch[1]) : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    for (const d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      labels[toYMD(d)] = label;
    }
  }
  return labels;
}

async function fetchCalendarLabels(calendarId) {
  const url = `https://www.lindberghschools.ws/fs/calendar-manager/events.ics?calendar_ids=${calendarId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`calendar ${calendarId} fetch failed: ${res.status}`);
  return parseNoSchoolLabels(await res.text());
}

// The district calendar (SCHOOL_CALENDAR_ICS_URL) is the authoritative,
// complete date list - every individual school's own calendar is checked
// (see the comment on SCHOOL_CALENDAR_IDS) to be a subset of it. Individual
// schools are fetched only to get that specific school's own wording for a
// date it has an entry for (e.g. "Labor Day- No School" vs. the district's
// generic "No School: Offices Closed"); `labels.district` is the fallback
// for every date, always present, and for "Idea Center" (not a real
// building - see SCHOOL_CALENDAR_IDS), the only label there is.
async function buildNoSchoolDays() {
  const districtLabels = await fetchCalendarLabels(new URL(SCHOOL_CALENDAR_ICS_URL).searchParams.get("calendar_ids"));
  const labels = { district: districtLabels };
  for (const [school, calendarId] of Object.entries(SCHOOL_CALENDAR_IDS)) {
    try {
      labels[school] = await fetchCalendarLabels(calendarId);
    } catch (err) {
      console.error(`Failed to fetch ${school}'s calendar (id ${calendarId}): ${err.message}`);
    }
  }
  return { dates: Object.keys(districtLabels).sort(), labels };
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

  // Published alongside the .ics files above so it inherits the same
  // daily refresh and open CORS - app.js can't fetch SCHOOL_CALENDAR_ICS_URL
  // directly (see the comment on it in config.js). A failure here doesn't
  // fail the whole build: app.js already falls back to its own heuristic
  // when this file is missing or stale.
  try {
    const noSchoolDays = await buildNoSchoolDays();
    await writeFile(new URL("no-school-days.json", OUT_DIR), JSON.stringify(noSchoolDays));
    console.log(`Wrote ${noSchoolDays.dates.length} no-school dates (${Object.keys(noSchoolDays.labels).length} calendars) to no-school-days.json`);
  } catch (err) {
    console.error(`Failed to build no-school-days.json: ${err.message}`);
  }

  if (ok === 0) process.exitCode = 1;
}

await main();
