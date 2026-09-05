// Vendor API access for the district's menu data - the one piece of this
// project that needs to run in two places: the browser app (app.js) and the
// Node-based ical-building cron script (scripts/build-ical.js). Kept as a
// plain ES module with no browser-only APIs (just `fetch`, native in every
// target browser and in Node 18+) so the exact same file works unmodified
// in both.
//
// See config.js's header for how the endpoints/menu tree were discovered.

export const GRAPHQL_URL = "https://api.schoolnutritionandfitness.com/graphql";
export const MENUTYPE_URL =
  "https://www.schoolnutritionandfitness.com/webmenus2/api/menutypeController.php";

// A persisted fallback for when the network fetch below fails - a flaky
// connection on a fresh page load, or no connection at all. Browser only:
// this file is also imported by the Node cron script (scripts/
// build-ical.js), where a fetch failure should keep failing loudly (a
// stale calendar published from old data would be worse than a failed
// build). Guarded on `window` rather than `localStorage` directly - newer
// Node versions expose an experimental global `localStorage` that logs an
// ExperimentalWarning to stderr (noisy in the daily cron's logs) the
// moment anything so much as reads it, `typeof` included; checking
// `window` first short-circuits before that getter is ever touched.
// Wrapped in try/catch beyond that: private-browsing Safari throws on any
// access, and a quota-exceeded write shouldn't take the app down over
// what's only ever a nice-to-have.
//
// Versioned key prefix so a future change to what's stored under a key
// can't collide with an old, differently-shaped cached value.
const CACHE_PREFIX = "lsm.cache.v1.";

function hasLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readLocalCache(key) {
  if (!hasLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeLocalCache(key, value) {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded, storage disabled, etc. - caching is a nice-to-have.
  }
}

// Cache menutype -> full months list for the process/session lifetime,
// since paging day by day (or generating many ical combinations that share
// an apiId) would otherwise re-fetch the same month-listing repeatedly.
const monthListCache = new Map();

export async function fetchMonthsList(menuTypeId) {
  if (monthListCache.has(menuTypeId)) return monthListCache.get(menuTypeId);
  const cacheKey = `months.${menuTypeId}`;
  let menus;
  try {
    const url = `${MENUTYPE_URL}/show-raw?_id=${encodeURIComponent(menuTypeId)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`menutype lookup failed: ${res.status}`);
    const data = await res.json();
    menus = data.menus || [];
    writeLocalCache(cacheKey, menus);
  } catch (e) {
    // Only fall back on an actual failure, never on a legitimately empty
    // result - a month genuinely not published yet stays "not published",
    // it doesn't resurrect some older cached list instead.
    const cached = readLocalCache(cacheKey);
    if (!cached) throw e;
    menus = cached;
  }
  monthListCache.set(menuTypeId, menus);
  return menus;
}

export async function fetchDocIdForDate(menuTypeId, date) {
  const menus = await fetchMonthsList(menuTypeId);
  const month = date.getMonth();
  const year = date.getFullYear();
  const match = menus.find(
    (m) => Number(m.month) === month && Number(m.year) === year
  );
  return match ? match._id.$id : null;
}

const itemsCache = new Map(); // docId -> Promise<items[]>

export async function fetchMenuItems(docId) {
  if (itemsCache.has(docId)) return itemsCache.get(docId);
  const cacheKey = `items.${docId}`;
  const query = `{
    menu(id: "${docId}") {
      id
      items {
        day
        product {
          name
          category
          # Only used by stationBoundaryHint() in station-boundaries.js.
          # Safe to drop along with that file - nothing else reads them.
          providerProductID
          product_fullname
          hide_on_web_menu_view
          hide_on_calendars
          allergen_dairy
          allergen_egg
          allergen_fish
          allergen_gluten
          allergen_milk
          allergen_peanut
          allergen_pork
          allergen_shellfish
          allergen_soy
          allergen_sesame
          allergen_treenuts
          allergen_vegetarian
          allergen_wheat
          allergen_other
        }
      }
    }
  }`;
  const promise = fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`graphql failed: ${res.status}`);
      return res.json();
    })
    .then((data) => (data.data && data.data.menu && data.data.menu.items) || [])
    .then((items) => {
      writeLocalCache(cacheKey, items);
      return items;
    })
    .catch((e) => {
      const cached = readLocalCache(cacheKey);
      if (!cached) throw e;
      return cached;
    });
  itemsCache.set(docId, promise);
  return promise;
}
