// Static config for the Lindbergh School District menu site.
//
// Where this comes from: the live site at schoolnutritionandfitness.com is an
// Angular/React SPA that pulls menu data from two endpoints:
//   - GraphQL: https://api.schoolnutritionandfitness.com/graphql
//   - REST:    https://www.schoolnutritionandfitness.com/webmenus2/api/menutypeController.php
// Both endpoints have wide-open CORS (they reflect whatever Origin sends the
// request), so this static site calls them directly from the browser. The
// actual fetch code (and the two URLs above) lives in menu-api.js, not here -
// this file is just the district's data (which schools/menus exist).
//
// The menu tree (schools + menu-type ids) below was pulled once via the
// GraphQL `organization` -> `site` -> `menuTypes` chain. It rarely changes,
// so it's just hardcoded here rather than re-fetched on every page load. If
// the district adds/removes a school or meal, update this list. To refresh:
//   1. POST { query: '{ organization(id:"1786638906029"){ sites{id name} } }' }
//   2. For each site id, POST { query: '{ site(depth:0,id:"<id>"){ sites{id name} } }' }
//   3. For each leaf site id, POST { query: '{ menuTypes(site:{depth_0_id:"<group>",depth_1_id:"<school>"}, publish_location:"website"){ id name } }' }
//      (Elementary Schools' "Idea Center" menus have no depth_1_id: use
//      { depth_0_id: "32105" } alone.)

// ---------------------------------------------------------------------
// High school lunch "stations" - now partly implemented, see
// station-boundaries.js.
//
// Lindbergh High lunch is served from several named food stations (like a
// food court), confirmed via the district's OTHER menu site, Nutrislice
// (lindberghschools.nutrislice.com - since shut down in favor of
// schoolnutritionandfitness.com, hence this project). Full month PDFs
// exported from Nutrislice gave a fixed, ordered roster per month:
//
//   August 2026 (10 stations): Ballpark Classics, Bento Box, Build Your
//   Own Classic Stacks, Classic Stacks, Luigi's Eatery, Panini Station,
//   Red Dragon, Taco Street, Traditional Cuisine, Wing'N It
//
//   September 2026 (11 stations): Ballpark Classics, Bento Box, Build
//   Your Own Classic Stacks, Classic Stacks, Little Italy, Luigi's
//   Eatery, Panini Station, Red Dragon, Taco Street, Traditional
//   Cuisine, Wing'N It
//
// Labeling groups by POSITION against that roster still doesn't work, for
// the two reasons found originally: not every station runs every day (so
// there's no fixed expected count to line groups up against), and the API
// frequently drops the side item that would separate two adjacent
// stations, so groupEntreeRuns() merges them.
//
// What does work is identifying stations by their CONTENT rather than
// their position - a station-specific side (Red Dragon's fortune cookie)
// or a product_fullname "concept". That, plus a lookup table of known
// station boundaries, lives in station-boundaries.js; it is optional, can
// be switched off there, and names roughly half the boxes while leaving
// the rest labeled "Entree". Read that file's header before changing any
// of this - in particular, its tables were derived from a September 2026
// Nutrislice PDF and cannot be regenerated now that Nutrislice is gone.
// ---------------------------------------------------------------------

export const DISTRICT_SID = "1786638906029";

// Where scripts/build-ical.js's cron job deploys its .ics files (see
// .github/workflows/build-ical.yml) - used by app.js to build "subscribe to
// this calendar" links. Must match the Cloudflare Pages project name there.
export const ICAL_BASE_URL = "https://lindbergh-school-menus-unofficial.pages.dev";

// The variants every Idea Center menu gets split into. dayFilter is a
// getDay() value (1=Mon..4=Thu) or null for "every day". Keep this in sync
// with IDEA_CENTER_GRADE_BY_WEEKDAY below - it's the source of the labels.
export const IDEA_CENTER_VARIANTS = [
  { key: "all", label: "Full Week", dayFilter: null },
  { key: "mon", label: "Mondays - 5th Grade", dayFilter: 1 },
  { key: "tue", label: "Tuesdays - 4th Grade", dayFilter: 2 },
  { key: "wed", label: "Wednesdays - 3rd Grade", dayFilter: 3 },
  { key: "thu", label: "Thursdays - 1st & 2nd Grade", dayFilter: 4 },
];

// Turns [{id, name}] base menu-types into 5x as many selectable entries -
// one per IDEA_CENTER_VARIANTS - each carrying `baseId` (the real API id to
// query) and `dayFilter` (which weekday it's restricted to, if any).
function expandIdeaCenterMenus(baseMenus) {
  const out = [];
  for (const base of baseMenus) {
    for (const v of IDEA_CENTER_VARIANTS) {
      out.push({
        id: `${base.id}__${v.key}`,
        baseId: base.id,
        baseName: base.name,
        name: `${base.name} - ${v.label}`,
        dayFilter: v.dayFilter,
      });
    }
  }
  return out;
}

// Every selectable menu, grouped the same way the district's own dropdown
// groups them. `id` is the GraphQL/REST menu-type id.
export const MENU_GROUPS = [
  {
    group: "Elementary Schools",
    schools: [
      {
        school: "Concord",
        menus: [
          { id: "6a907222fd57042aa8757147", name: "Breakfast" },
          { id: "6a907aeb046cfa3e317e0d27", name: "Lunch" },
          { id: "6a95b9a7d55b981fff3b833d", name: "Flyers Club" },
        ],
      },
      {
        school: "Crestwood",
        menus: [
          { id: "6a90787b71e8cb58c666aad6", name: "Breakfast" },
          { id: "6a907af22e1b0705bb2693f9", name: "Lunch" },
          { id: "6a95b9ae4dbc077a2d2cc8f3", name: "Flyers Club" },
        ],
      },
      {
        school: "Dressel",
        menus: [
          { id: "6a90789c5bacaa2ef703ab3a", name: "Breakfast" },
          { id: "6a907af935dbc1305b57f14a", name: "Lunch" },
          { id: "6a95b9a1b437972070470be6", name: "Flyers Club" },
        ],
      },
      {
        school: "Kennerly",
        menus: [
          { id: "6a907a925f512526d15f9ad8", name: "Breakfast" },
          { id: "6a907b05b6265c4e9575ad27", name: "Lunch" },
          { id: "6a95b9bc882ac4299c63f65a", name: "Flyers Club" },
        ],
      },
      {
        school: "Long",
        menus: [
          { id: "6a907a848095066fb457bc39", name: "Breakfast" },
          { id: "6a907b00046cfa3e317e0d2b", name: "Lunch" },
          { id: "6a95b9bf92a53501247c2298", name: "Flyers Club" },
        ],
      },
      {
        school: "Sappington",
        menus: [
          { id: "6a907a9b3fd5ca305e4b5a4a", name: "Breakfast" },
          { id: "6a907b0c9dfbd85f45163c84", name: "Lunch" },
          { id: "6a95b9b792a53501247c2295", name: "Flyers Club" },
        ],
      },
      {
        // Not tied to one elementary school - kids from multiple schools
        // attend the Idea Center on specific weekdays by grade, so each
        // underlying menu is offered as several separate selectable menus:
        // one for the full week, plus one per grade's day. That way a
        // parent whose kid only goes on Tuesdays can pick just "Tuesdays -
        // 4th Grade" and see it alongside their other kids' regular school
        // menus, instead of getting every day of the week.
        school: "Idea Center",
        ideaCenter: true,
        // Note: the district also has a "Lindbergh Idea Center
        // Breakfast/Lunch" pair of menu-types (ids 6a885ad3489008318338fb66
        // / 6a885ada7e7f2a35185739e4). Left out on purpose - unlike every
        // other menu in the district (all Sept-2026-only so far), those
        // carry stale Jul-Oct data, which looks like leftover/legacy setup
        // rather than this year's live menu.
        menus: expandIdeaCenterMenus([
          { id: "6a95db4ae1462879cd4fc58d", name: "Idea Center Breakfast" },
          { id: "6a95db5006049b31eb05767e", name: "Idea Center Lunch" },
        ]),
      },
    ],
  },
  {
    group: "Middle Schools",
    schools: [
      {
        school: "Sperreng",
        menus: [
          { id: "6a9088f21332fd2ff21a75c0", name: "Breakfast" },
          { id: "6a9088f893dc3151b52459c5", name: "Lunch" },
        ],
      },
      {
        school: "Truman",
        menus: [
          { id: "6a908902bdf871399e21cb74", name: "Breakfast" },
          { id: "6a9088fc3a4bc275e57a0aa0", name: "Lunch" },
        ],
      },
    ],
  },
  {
    group: "High Schools",
    schools: [
      {
        school: "Lindbergh High School",
        menus: [
          { id: "6a8772fadd3ae275085a084a", name: "Breakfast" },
          { id: "6a8772ffc566ab3b8c2ded97", name: "Lunch" },
        ],
      },
    ],
  },
  {
    group: "Pre-K Schools",
    schools: [
      {
        school: "ECE",
        menus: [
          { id: "6a87731c437bb36de13a6156", name: "Breakfast" },
          { id: "6a877323f638d3071b736cd9", name: "Lunch" },
          { id: "6a8773281ca3e60d5f61d1cc", name: "Snack" },
        ],
      },
    ],
  },
];

// Idea Center attendance is by grade, one weekday each - kids who only go
// one day a week only care about their grade's day. This isn't in the menu
// data anywhere (confirmed: every day of the month has identical items with
// no grade tag), so it's hardcoded here. getDay(): 0=Sun ... 6=Sat.
// Friday is intentionally left out - not specified.
export const IDEA_CENTER_GRADE_BY_WEEKDAY = {
  1: "5th Grade", // Monday
  2: "4th Grade", // Tuesday
  3: "3rd Grade", // Wednesday
  4: "1st & 2nd Grade", // Thursday
};

// Each product comes back with a boolean-ish allergen_* field per allergen
// ("1"/null, not a real boolean - see isAllergenFlagged() in app.js).
// `icon` is emoji, shown as a badge next to the item. Where two fields
// share an icon (dairy/milk), badges are deduped and their labels merged
// so an item doesn't show the same emoji twice. `positive: true` marks an
// entry that isn't a warning (vegetarian-friendly), styled differently.
// `textOnly: true` means there's no decent emoji for it (currently unused,
// but the badge renderer in app.js still supports it) - it renders as a
// small text pill instead of an icon.
export const ALLERGEN_DEFS = [
  { field: "allergen_dairy", label: "Dairy", icon: "🥛" },
  { field: "allergen_milk", label: "Milk", icon: "🥛" },
  { field: "allergen_egg", label: "Egg", icon: "🥚" },
  { field: "allergen_fish", label: "Fish", icon: "🐟" },
  { field: "allergen_shellfish", label: "Shellfish", icon: "🦐" },
  { field: "allergen_peanut", label: "Peanut", icon: "🥜" },
  { field: "allergen_treenuts", label: "Tree Nuts", icon: "🌰" },
  { field: "allergen_soy", label: "Soy", icon: "🌱" },
  { field: "allergen_wheat", label: "Wheat", icon: "🌾" },
  { field: "allergen_gluten", label: "Gluten", icon: "🍞" },
  { field: "allergen_pork", label: "Pork", icon: "🐖" },
  { field: "allergen_sesame", label: "Sesame", icon: "🫘" },
  { field: "allergen_other", label: "Other", icon: "⚠️" },
  { field: "allergen_vegetarian", label: "Vegetarian", icon: "🥗", positive: true },
];

// Vegan isn't a real API field - derived as vegetarian with none of the
// known animal-product flags set (dairy, milk, egg). Doesn't factor in
// allergen_other (too ambiguous to safely include or exclude either way).
// When an item qualifies, it shows only this badge instead of also
// showing "Vegetarian" - vegan already implies it. See isVegan() in
// app.js.
export const VEGAN_BADGE = { label: "Vegan", icon: "🌿" };
export const VEGAN_DISQUALIFYING_FIELDS = ["allergen_dairy", "allergen_milk", "allergen_egg"];

// Options for the "Dietary" picker: the same 8 allergens the district's
// own site offers (peanut, tree nut, milk, fish, shellfish, egg, wheat,
// soy, sesame - notably not the full ALLERGEN_DEFS list: no dairy/gluten/
// pork/other) - relabeled "No X" here specifically, plus two synthetic
// entries that aren't API fields: "vegetarian" (not flagged
// allergen_vegetarian - see isMeat() in app.js) and "vegan" (see
// isVegan() above/in app.js). Checking either strikes through anything
// that *doesn't* match - the opposite direction from the allergen
// entries, which strike through anything that *does*.
const EXCLUDE_FIELDS = [
  "allergen_peanut",
  "allergen_treenuts",
  "allergen_milk",
  "allergen_fish",
  "allergen_shellfish",
  "allergen_egg",
  "allergen_wheat",
  "allergen_soy",
  "allergen_sesame",
];
export const EXCLUDE_OPTIONS = [
  // `excluding: true` marks the ones that strike through items that
  // *have* the trait (get a 🚫 in the picker - see buildExcludePicker()
  // in app.js). Vegetarian/vegan are the opposite direction - they
  // strike through items that *don't* match - so they're left off.
  ...EXCLUDE_FIELDS.map((field) => {
    const def = ALLERGEN_DEFS.find((d) => d.field === field);
    return { ...def, label: `No ${def.label}`, excluding: true };
  }),
  { field: "vegetarian", label: "Vegetarian", icon: "🥗" },
  { field: "vegan", label: "Vegan", icon: "🌿" },
];

// Flat lookup: menuId (for Idea Center variants, `${baseId}__${variantKey}`)
// -> menu info. Built once here so both the browser app and the ical-building
// cron script (scripts/build-ical.js) share one index instead of each
// re-deriving it from MENU_GROUPS.
//   name        - full display name
//   baseName    - name without the variant suffix (== name for anything
//                 that isn't an Idea Center variant) - used as the header
//                 when several variants get grouped together, see
//                 groupSelectedMenus() in app.js
//   school      - school name for the section header
//   group       - site group (Elementary/Middle/High/Pre-K)
//   apiId       - the real menu-type id to query (== id, except variants)
//   dayFilter   - getDay() value this menu is restricted to, or null
export const MENU_BY_ID = {};
for (const g of MENU_GROUPS) {
  for (const s of g.schools) {
    for (const m of s.menus) {
      MENU_BY_ID[m.id] = {
        name: m.name,
        baseName: m.baseName || m.name,
        school: s.school,
        group: g.group,
        apiId: m.baseId || m.id,
        dayFilter: typeof m.dayFilter === "number" ? m.dayFilter : null,
      };
    }
  }
}
