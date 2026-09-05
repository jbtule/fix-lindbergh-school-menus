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

// Cache menutype -> full months list for the process/session lifetime,
// since paging day by day (or generating many ical combinations that share
// an apiId) would otherwise re-fetch the same month-listing repeatedly.
const monthListCache = new Map();

export async function fetchMonthsList(menuTypeId) {
  if (monthListCache.has(menuTypeId)) return monthListCache.get(menuTypeId);
  const url = `${MENUTYPE_URL}/show-raw?_id=${encodeURIComponent(menuTypeId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`menutype lookup failed: ${res.status}`);
  const data = await res.json();
  const menus = data.menus || [];
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
    .then((data) => (data.data && data.data.menu && data.data.menu.items) || []);
  itemsCache.set(docId, promise);
  return promise;
}
