// Pure day-item grouping/ordering logic, factored out of src/app.js so it
// can be unit-tested (see test/menu-logic.test.js) without any DOM/browser
// APIs - every function here takes plain data in and returns plain data
// out, nothing touches `document`/`localStorage`/`fetch`. Kept separate
// from src/menu-api.js (network) and src/config.js (static district data)
// since this is specifically the "given a day's already-fetched items,
// how do they group and sort" layer - the actual source of most of the
// rendering bugs found and fixed this session (a day with no
// Entrees-category item silently losing all its items, the Snack/juice/
// milk category edge cases, etc.).

import { SNACK_MEAL_NAMES, isSnackSideItem } from "./config.js";

// Splits one day's items for a regular (non-High-School) menu into a
// single { entrees, sides } group - or [] when there's truly nothing that
// day. Keyed on having ANY item at all, not specifically an entree - a
// sides-only day (a Flyers Club/Snack menu is often just one
// Grain-category item, no Entrees-category product at all) used to be
// silently dropped entirely by an earlier version of this logic that
// required entrees.length > 0 just to keep the group.
//
// Flyers Club/Snack menus (see SNACK_MEAL_NAMES) are special-cased
// further: their real food is the whole meal, not a side that comes along
// with a "real" entree, so it counts as an entree here rather than being
// filtered by category. Milk, condiments, and juice (isSnackSideItem())
// still ride along as ordinary sides even here - ECE's Snack menu pairs
// those with its actual food, and they aren't "the snack" the way that
// food is.
export function splitEntreesAndSides(menuName, dayItems) {
  const isSnackMenu = SNACK_MEAL_NAMES.has(menuName);
  const entrees = isSnackMenu
    ? dayItems.filter((it) => !isSnackSideItem(it.product))
    : dayItems.filter((it) => it.product.category === "Entrees");
  const sides = isSnackMenu
    ? dayItems.filter((it) => isSnackSideItem(it.product))
    : dayItems.filter((it) => it.product.category !== "Entrees");
  return entrees.length || sides.length ? [{ entrees, sides }] : [];
}

// High school lunch only: entrees are actually split across several food
// stations (Ballpark Classics, Taco Street, etc. - confirmed against the
// district's other menu site), each with its own entrees. There's no
// field identifying which station an item belongs to, but stations are
// entered as contiguous runs - one or more entrees, then that station's
// specific sides, before the next station's entrees start. This finds
// those runs from the item order itself: real separation shows up as more
// than one group. Some high school days happen to have no side item
// between two stations, so it'll still under-split those - not perfect,
// but never worse than one flat box. `menuGroup` is passed through only
// for the optional station-boundaries.js hook below (its own
// high-school-only scope check).
//
// A "Shared Items" item (category Ancillary) marks the end of the
// per-station portion - anything after it is common across every station
// (the salad bar, milk, condiments) and comes back separately as
// `commonSides` rather than attached to the last group. With no Shared
// Items marker (every other menu, since they never interleave sides
// between entrees), this collapses to a single group holding all the
// sides, identical to splitEntreesAndSides()'s non-snack case.
export function groupEntreeRuns(dayItemsInOrder, menuGroup) {
  const sentinelIndex = dayItemsInOrder.findIndex(
    (it) => it.product.category === "Ancillary" && it.product.name.trim() === "Shared Items"
  );
  const stationItems = sentinelIndex === -1 ? dayItemsInOrder : dayItemsInOrder.slice(0, sentinelIndex);
  const commonSides = sentinelIndex === -1 ? [] : dayItemsInOrder.slice(sentinelIndex + 1);

  const groups = [];
  let current = null;
  // Tracked for the boundary hints below: the previous Entrees item, and
  // whether any sides sat between it and the item now being placed. Not the
  // same as current.sides.length - that keeps accumulating across a group,
  // this resets at every entree.
  let prevEntree = null;
  let sidesSincePrevEntree = 0;
  for (const it of stationItems) {
    if (it.product.category === "Entrees") {
      // --- station-boundaries.js hook (optional) -----------------------
      // Ask the frozen lookup tables whether these two adjacent entrees are
      // actually in different stations. Returns null when it has no opinion,
      // which is the common case, and then the original ordering rule below
      // decides exactly as it always did. Delete this block (and keep the
      // `startNew` line as `!current || current.sides.length > 0`) to remove
      // the feature entirely.
      const hint =
        typeof stationBoundaryHint === "function" && prevEntree
          ? stationBoundaryHint(menuGroup, prevEntree.product, it.product, sidesSincePrevEntree > 0)
          : null;
      // -----------------------------------------------------------------
      const startNew =
        !current || (hint === null ? current.sides.length > 0 : hint);
      if (startNew) {
        current = { entrees: [], sides: [] };
        groups.push(current);
      }
      current.entrees.push(it);
      prevEntree = it;
      sidesSincePrevEntree = 0;
    } else if (current) {
      current.sides.push(it);
      sidesSincePrevEntree++;
    }
  }
  // A day with no Entrees-category item at all (same case
  // splitEntreesAndSides() guards against for non-High-School menus - a
  // snack-only menu is often just one Grain-category item) never starts a
  // group above, silently dropping every item in stationItems. One
  // sides-only group instead.
  if (groups.length === 0 && stationItems.length) {
    groups.push({ entrees: [], sides: stationItems });
  }
  return { groups, commonSides };
}

// Display order for the district's own non-entree categories - anything
// not in this list (including the occasional blank category - a gap in
// their data, e.g. "Mayo Dispenser") sorts after it, in whatever order it
// was first encountered. Used by both the on-screen collapsible side
// groups and the print-week table's row order.
export const SIDE_CATEGORY_ORDER = ["Vegetable", "Fruit", "Grain", "Milk", "Condiment"];

export const SIDE_CATEGORY_LABELS = {
  Vegetable: "Vegetables",
  Fruit: "Fruits",
  Milk: "Milk",
  Condiment: "Condiments",
  Grain: "Grains",
};

// `categories` is whatever's actually present (e.g. [...byCategory.keys()]
// - not every district category shows up on every menu), returned in
// SIDE_CATEGORY_ORDER's order followed by anything unlisted, in the order
// it was first encountered.
export function orderSideCategories(categories) {
  return [
    ...SIDE_CATEGORY_ORDER.filter((c) => categories.includes(c)),
    ...categories.filter((c) => !SIDE_CATEGORY_ORDER.includes(c)),
  ];
}
