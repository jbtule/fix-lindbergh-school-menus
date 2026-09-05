// Shared between the browser app (app.js, for building "subscribe to this
// calendar" links) and the ical-building cron script
// (scripts/build-ical.js, for naming the files it writes). The two MUST
// agree on how a given menu selection maps to a slug/filename, or a
// subscribe link the app builds could point at a file the cron script
// never actually generates.

import { MENU_BY_ID, IDEA_CENTER_GRADE_BY_WEEKDAY } from "./config.js";

export function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// True for a menu-type that gets split into day/grade variants (currently
// just the two Idea Center menu-types) - anything else is an ordinary
// single-variant menu. Derived from MENU_BY_ID rather than hardcoding
// "Idea Center" by name, so this keeps working if the district ever adds
// another day-filtered program.
function isDayFilterableApiId(apiId) {
  return Object.values(MENU_BY_ID).some((info) => info.apiId === apiId && info.dayFilter !== null);
}

// `group` is shaped like groupSelectedMenus()'s output in app.js - and
// scripts/build-ical.js builds an equivalent shape for each calendar it
// generates, so both sides produce identical slugs:
//   name          - base display name (baseName, not the variant label)
//   school        - school name (only meaningful for non-day-filterable
//                   menus, i.e. ignored for Idea Center)
//   apiId         - the real menu-type id
//   hasFullWeek   - true if the Full Week variant is included
//   specificDays  - Set of getDay() values (1=Mon..4=Thu) included
export function icsSlugFor(group) {
  if (!isDayFilterableApiId(group.apiId)) {
    return slugify(`${group.school}-${group.name}`);
  }
  // hasFullWeek wins over specificDays, same precedent as
  // groupSelectedMenus() in app.js - Full Week already covers every day,
  // so it's the more complete calendar whenever both are selected.
  if (group.hasFullWeek || group.specificDays.size === 0) {
    return slugify(`${group.name}-full-week`);
  }
  const grades = [...group.specificDays].sort((a, b) => a - b).map((d) => IDEA_CENTER_GRADE_BY_WEEKDAY[d]);
  return slugify(`${group.name}-${grades.join("-")}`);
}
