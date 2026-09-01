// Lindbergh School Menus - static front end for the district's menu API.
// See config.js for the menu-type ids and how they were discovered.

const STORAGE_KEY = "lsm.selectedMenus";
const EXCLUDE_STORAGE_KEY = "lsm.excludedAllergens";
const VIEW_MODE_STORAGE_KEY = "lsm.viewMode";

// After 4pm, school's out and the day's menu is no longer useful - default
// ahead to tomorrow instead.
const END_OF_DAY_HOUR = 16;

const state = {
  selectedIds: loadSelectedIds(),
  excludedAllergens: loadExcludedAllergens(),
  currentDate: defaultDate(),
  viewMode: loadViewMode(), // "day" | "week"
};

// Flat lookup: menuId (the picker's id, which for Idea Center variants is
// `${baseId}__${variantKey}`) -> menu info.
//   name        - full display name
//   school      - school name for the section header
//   group       - site group (Elementary/Middle/High/Pre-K)
//   apiId       - the real menu-type id to query (== id, except variants)
//   dayFilter   - getDay() value this menu is restricted to, or null
const MENU_BY_ID = {};
for (const g of MENU_GROUPS) {
  for (const s of g.schools) {
    for (const m of s.menus) {
      MENU_BY_ID[m.id] = {
        name: m.name,
        school: s.school,
        group: g.group,
        apiId: m.baseId || m.id,
        dayFilter: typeof m.dayFilter === "number" ? m.dayFilter : null,
      };
    }
  }
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Today, unless it's past END_OF_DAY_HOUR - then tomorrow, since that's
// what's actually relevant to check next.
function defaultDate() {
  const now = new Date();
  const d = startOfDay(now);
  if (now.getHours() >= END_OF_DAY_HOUR) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function loadSelectedIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveSelectedIds() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.selectedIds));
  } catch (e) {
    // localStorage unavailable (private browsing etc.) - selection just
    // won't persist across visits, which is fine as a fallback.
  }
}

function loadExcludedAllergens() {
  try {
    const raw = localStorage.getItem(EXCLUDE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveExcludedAllergens() {
  try {
    localStorage.setItem(EXCLUDE_STORAGE_KEY, JSON.stringify(state.excludedAllergens));
  } catch (e) {
    /* ignore - see saveSelectedIds */
  }
}

function loadViewMode() {
  try {
    const raw = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return raw === "week" ? "week" : "day";
  } catch (e) {
    return "day";
  }
}

function saveViewMode() {
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, state.viewMode);
  } catch (e) {
    /* ignore - see saveSelectedIds */
  }
}

// ---------- API calls ----------

// Cache menutype -> full months list for the session, since paging day by
// day would otherwise re-fetch the same month-listing repeatedly.
const monthListCache = new Map();

async function fetchMonthsList(menuTypeId) {
  if (monthListCache.has(menuTypeId)) return monthListCache.get(menuTypeId);
  const url = `${MENUTYPE_URL}/show-raw?_id=${encodeURIComponent(menuTypeId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`menutype lookup failed: ${res.status}`);
  const data = await res.json();
  const menus = data.menus || [];
  monthListCache.set(menuTypeId, menus);
  return menus;
}

async function fetchDocIdForDate(menuTypeId, date) {
  const menus = await fetchMonthsList(menuTypeId);
  const month = date.getMonth();
  const year = date.getFullYear();
  const match = menus.find(
    (m) => Number(m.month) === month && Number(m.year) === year
  );
  return match ? match._id.$id : null;
}

const itemsCache = new Map(); // docId -> Promise<items[]>

async function fetchMenuItems(docId) {
  if (itemsCache.has(docId)) return itemsCache.get(docId);
  const query = `{
    menu(id: "${docId}") {
      id
      items {
        day
        product {
          name
          category
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

// ---------- Picker UI ----------

function buildPicker() {
  const body = document.getElementById("pickerBody");
  body.innerHTML = "";
  for (const g of MENU_GROUPS) {
    const groupEl = document.createElement("section");
    groupEl.className = "pickerGroup";
    const h = document.createElement("h3");
    h.textContent = g.group;
    groupEl.appendChild(h);

    for (const s of g.schools) {
      const schoolEl = document.createElement("div");
      schoolEl.className = "pickerSchool";
      const sh = document.createElement("h4");
      sh.textContent = s.school;
      schoolEl.appendChild(sh);

      if (s.ideaCenter) {
        // Group variants under their base menu (e.g. "Idea Center Lunch")
        // so the 5 Full Week/Mon/Tue/Wed/Thu checkboxes read as one unit.
        const byBase = new Map();
        for (const m of s.menus) {
          const key = m.baseId || m.id;
          if (!byBase.has(key)) byBase.set(key, []);
          byBase.get(key).push(m);
        }
        for (const [, variants] of byBase) {
          const bh = document.createElement("h5");
          bh.textContent = variants[0].baseName || variants[0].name;
          schoolEl.appendChild(bh);
          schoolEl.appendChild(
            buildMenuCheckboxList(
              variants.map((v) => ({
                id: v.id,
                label: v.name.slice((v.baseName || "").length).replace(/^\s*-\s*/, ""),
              }))
            )
          );
        }
      } else {
        schoolEl.appendChild(
          buildMenuCheckboxList(s.menus.map((m) => ({ id: m.id, label: m.name })))
        );
      }
      groupEl.appendChild(schoolEl);
    }
    body.appendChild(groupEl);
  }
}

function buildMenuCheckboxList(entries) {
  const list = document.createElement("div");
  list.className = "pickerMenuList";
  for (const { id, label } of entries) {
    const optLabel = document.createElement("label");
    optLabel.className = "pickerCheckbox";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = id;
    cb.checked = state.selectedIds.includes(id);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        if (!state.selectedIds.includes(id)) state.selectedIds.push(id);
      } else {
        state.selectedIds = state.selectedIds.filter((x) => x !== id);
      }
      saveSelectedIds();
      updatePickerCount();
      renderSections();
    });
    optLabel.appendChild(cb);
    optLabel.appendChild(document.createTextNode(" " + label));
    list.appendChild(optLabel);
  }
  return list;
}

function updatePickerCount() {
  const badge = document.getElementById("pickerCount");
  badge.textContent = state.selectedIds.length
    ? String(state.selectedIds.length)
    : "";
}

function setPanelOpen(panelId, scrimId, toggleId, open) {
  document.getElementById(panelId).hidden = !open;
  document.getElementById(scrimId).hidden = !open;
  document.getElementById(toggleId).setAttribute("aria-expanded", String(open));
}

function openPicker() {
  setPanelOpen("picker", "pickerScrim", "pickerToggle", true);
}

function closePicker() {
  setPanelOpen("picker", "pickerScrim", "pickerToggle", false);
}

// ---------- Exclude (allergen) picker UI ----------

function buildExcludePicker() {
  const body = document.getElementById("excludePickerBody");
  body.innerHTML = "";
  const list = document.createElement("div");
  list.className = "pickerMenuList";
  for (const { field, label, icon } of EXCLUDE_OPTIONS) {
    const optLabel = document.createElement("label");
    optLabel.className = "pickerCheckbox";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = field;
    cb.checked = state.excludedAllergens.includes(field);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        if (!state.excludedAllergens.includes(field)) state.excludedAllergens.push(field);
      } else {
        state.excludedAllergens = state.excludedAllergens.filter((x) => x !== field);
      }
      saveExcludedAllergens();
      updateExcludeCount();
      renderSections();
    });
    optLabel.appendChild(cb);
    optLabel.appendChild(document.createTextNode(` ${icon} ${label}`));
    list.appendChild(optLabel);
  }
  body.appendChild(list);
}

function updateExcludeCount() {
  const badge = document.getElementById("excludeCount");
  badge.textContent = state.excludedAllergens.length
    ? String(state.excludedAllergens.length)
    : "";
}

function openExcludePicker() {
  setPanelOpen("excludePicker", "excludePickerScrim", "excludeToggle", true);
}

function closeExcludePicker() {
  setPanelOpen("excludePicker", "excludePickerScrim", "excludeToggle", false);
}

// ---------- Disclaimer ----------

function openDisclaimer() {
  setPanelOpen("disclaimerModal", "disclaimerScrim", "disclaimerToggle", true);
}

function closeDisclaimer() {
  setPanelOpen("disclaimerModal", "disclaimerScrim", "disclaimerToggle", false);
}

// ---------- Day nav ----------

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDate(d) {
  return `${WEEKDAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function isToday(d) {
  return startOfDay(new Date()).getTime() === d.getTime();
}

function renderDayLabel() {
  const label = document.getElementById("dayLabel");
  if (state.viewMode === "week") {
    const [start, , , , end] = weekDatesFor(state.currentDate);
    label.textContent =
      start.getMonth() === end.getMonth()
        ? `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}-${end.getDate()}, ${end.getFullYear()}`
        : `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} - ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
    label.classList.toggle("isToday", weekDatesFor(state.currentDate).some(isToday));
  } else {
    label.textContent = formatDate(state.currentDate);
    label.classList.toggle("isToday", isToday(state.currentDate));
  }
}

// One day at a time in day view; a full Mon-Fri week at a time in week
// view, so the arrows always mean "next/previous thing you're looking at".
function changeDay(delta) {
  const step = state.viewMode === "week" ? delta * 7 : delta;
  const d = new Date(state.currentDate);
  d.setDate(d.getDate() + step);
  state.currentDate = d;
  renderDayLabel();
  renderSections();
}

function goToToday() {
  state.currentDate = defaultDate();
  renderDayLabel();
  renderSections();
}

// The button jumps to defaultDate(), which is tomorrow after
// END_OF_DAY_HOUR - so it should say so, rather than always saying "Today"
// and jumping to tomorrow anyway.
function updateTodayButtonLabel() {
  const btn = document.getElementById("todayBtn");
  const isToday = defaultDate().getTime() === startOfDay(new Date()).getTime();
  btn.textContent = isToday ? "Jump to Today" : "Jump to Tomorrow";
  btn.title = isToday
    ? "Show today's menu"
    : "Show tomorrow's menu - after 4pm, today's menu isn't useful anymore, so this jumps ahead";
}

function setViewMode(mode) {
  if (state.viewMode === mode) return;
  state.viewMode = mode;
  saveViewMode();
  updateViewModeButtons();
  renderDayLabel();
  renderSections();
}

function updateViewModeButtons() {
  document.getElementById("dayViewBtn").setAttribute("aria-pressed", String(state.viewMode === "day"));
  document.getElementById("weekViewBtn").setAttribute("aria-pressed", String(state.viewMode === "week"));
}

// Next (or same, if it already matches) date on/after `from` with the given
// getDay() weekday. Used to tell a weekday-restricted menu when it's next
// showing, when the current day doesn't match.
function nextOccurrence(from, weekday) {
  const d = new Date(from);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

// Monday-Friday of the week containing `date` (school menus never have
// weekend data, so there's no point showing those two empty columns).
function weekDatesFor(date) {
  const mondayOffset = (date.getDay() + 6) % 7; // Mon=0 ... Sun=6
  const monday = new Date(date);
  monday.setDate(monday.getDate() - mondayOffset);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
}

// ---------- Rendering menu sections ----------

// The district's own web menu view respects these two flags (e.g. milk
// items come back with hide_on_web_menu_view: "1" and never show up on
// the real site's calendar). Left off for now - milk should show - but
// the plumbing (fetched fields + this check) stays in place in case that
// changes later. Flip to true to hide whatever the district marks hidden.
const HONOR_HIDE_FLAGS = false;

function isHiddenFromWebView(product) {
  if (!HONOR_HIDE_FLAGS) return false;
  const truthy = (v) => v === true || v === "1" || v === 1;
  return truthy(product.hide_on_web_menu_view) || truthy(product.hide_on_calendars);
}

// false: allergen badges are icon-only, with the name(s) available on
// hover/long-press via the title attribute (current default). true: badges
// show icon + label text in a bordered "Allergens" box, no hover needed -
// better for touch devices that can't hover, noisier for everything else.
const ALLERGEN_SHOW_LABELS = false;

const CATEGORY_ORDER = ["Entrees", "Vegetable", "Fruit", "Milk", "Condiment"];

function sortItemsForDay(items) {
  return [...items].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.product.category);
    const bi = CATEGORY_ORDER.indexOf(b.product.category);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

// Splits a day's items (in original API order - order matters here) into
// station-shaped chunks: one or more Entrees, plus the sides that follow
// them before the next Entree run starts (that station's own sides - e.g.
// fries with a burger combo). A "Shared Items" item (category Ancillary)
// marks the end of the per-station portion - anything after it is common
// across every station (the salad bar, milk, condiments) and comes back
// separately as `commonSides` rather than attached to the last group.
// Used only for High Schools - see the comment where this is called in
// renderOneMenu. With no Shared Items marker (every other menu, since
// they never interleave sides between entrees), this collapses to a
// single group holding all the sides, identical to the old flat layout.
function groupEntreeRuns(dayItemsInOrder) {
  const sentinelIndex = dayItemsInOrder.findIndex(
    (it) => it.product.category === "Ancillary" && it.product.name.trim() === "Shared Items"
  );
  const stationItems = sentinelIndex === -1 ? dayItemsInOrder : dayItemsInOrder.slice(0, sentinelIndex);
  const commonSides = sentinelIndex === -1 ? [] : dayItemsInOrder.slice(sentinelIndex + 1);

  const groups = [];
  let current = null;
  for (const it of stationItems) {
    if (it.product.category === "Entrees") {
      if (!current || current.sides.length > 0) {
        current = { entrees: [], sides: [] };
        groups.push(current);
      }
      current.entrees.push(it);
    } else if (current) {
      current.sides.push(it);
    }
  }
  return { groups, commonSides };
}

// Display order for the district's own non-entree categories. Anything not
// listed here (including the occasional blank category - a gap in their
// data, e.g. "Mayo Dispenser") is grouped under "Other" at the end.
const SIDE_CATEGORY_ORDER = ["Vegetable", "Fruit", "Milk", "Condiment", "Grain"];
const SIDE_CATEGORY_LABELS = {
  Vegetable: "Vegetables",
  Fruit: "Fruits",
  Milk: "Milk",
  Condiment: "Condiments",
  Grain: "Grains",
};

function renderSideGroups(sideItems) {
  if (!sideItems.length) return "";
  const byCategory = new Map();
  for (const it of sideItems) {
    const cat = it.product.category || "";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(it);
  }
  const orderedCats = [
    ...SIDE_CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !SIDE_CATEGORY_ORDER.includes(c)),
  ];
  const rows = [];
  for (const cat of orderedCats) {
    const label = SIDE_CATEGORY_LABELS[cat] || cat || "Other";
    const items = byCategory.get(cat).map((it) => `<li>${renderItemLine(it)}</li>`).join("");
    rows.push(`
      <div class="sideGroup">
        <div class="sideLabel">${label}</div>
        <ul class="sideList">${items}</ul>
      </div>
    `);
  }
  return rows.join("");
}

async function renderSections() {
  const container = document.getElementById("sections");
  const emptyState = document.getElementById("emptyState");

  if (state.selectedIds.length === 0) {
    container.innerHTML = "";
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  container.innerHTML = "";
  const sectionEls = {};
  for (const id of state.selectedIds) {
    const info = MENU_BY_ID[id];
    if (!info) continue; // stale id from an old config, ignore
    const section = document.createElement("section");
    section.className = "menuSection";
    section.innerHTML = `
      <h2>${info.school} - ${info.name}</h2>
      <div class="sectionBody"><p class="loading">Loading...</p></div>
    `;
    container.appendChild(section);
    sectionEls[id] = section.querySelector(".sectionBody");
  }

  const renderOne = state.viewMode === "week" ? renderOneMenuWeek : renderOneMenu;
  await Promise.all(state.selectedIds.map((id) => renderOne(id, sectionEls[id])));

  if (state.viewMode === "week") syncWeekScrolls();
}

// Every week row uses the same fixed-width day columns (see .weekDayCard),
// so their scrollable widths always match - scrolling one can just copy
// its scrollLeft onto the others to keep every menu on the same day.
// Re-attached on every render since renderSections() replaces the DOM
// nodes each time, so nothing to explicitly tear down.
//
// A touch fling fires many 'scroll' events per frame - writing
// scrollLeft on every other row synchronously for each one caused
// visible jank, so this batches it to at most once per animation frame
// via requestAnimationFrame, always using whichever row moved most
// recently as the source.
function syncWeekScrolls() {
  const scrollers = document.querySelectorAll(".weekScroll");
  if (scrollers.length < 2) return;
  let sourceEl = null;
  let queued = false;
  for (const el of scrollers) {
    el.addEventListener(
      "scroll",
      () => {
        sourceEl = el;
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          for (const other of scrollers) {
            if (other !== sourceEl) other.scrollLeft = sourceEl.scrollLeft;
          }
          queued = false;
        });
      },
      { passive: true }
    );
  }
}

// Computes the HTML for one menu on one date - shared by day view (one
// call) and week view (one call per weekday column). Never touches the
// DOM directly, so it works the same either way.
async function computeDayHtml(info, date) {
  const weekday = date.getDay();

  if (info.dayFilter !== null && weekday !== info.dayFilter) {
    const next = nextOccurrence(date, info.dayFilter);
    return `<p class="notScheduled">Not scheduled this day. Next: ${formatDate(next)}.</p>`;
  }

  let docId;
  try {
    docId = await fetchDocIdForDate(info.apiId, date);
  } catch (e) {
    return `<p class="error">Couldn't load this menu (${e.message}).</p>`;
  }

  if (!docId) {
    return `<p class="empty">No menu published for ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}.</p>`;
  }

  let items;
  try {
    items = await fetchMenuItems(docId);
  } catch (e) {
    return `<p class="error">Couldn't load items (${e.message}).</p>`;
  }

  const dayItems = items.filter(
    (it) => it.day === date.getDate() && it.product && !isHiddenFromWebView(it.product)
  );

  if (dayItems.length === 0) {
    return `<p class="empty">No items published for this day yet.</p>`;
  }

  const grade = IDEA_CENTER_GRADE_BY_WEEKDAY[weekday];
  const gradeBadge =
    info.school === "Idea Center" && grade
      ? `<span class="gradeBadge">${grade}</span>`
      : "";

  // "Entrees" is the district's category for whatever a kid actually picks
  // between that morning - at breakfast that's the daily hot item plus the
  // rotating cereal options, at lunch it's usually 2 (sometimes 3) dishes.
  // Everything else (fruit, milk, condiments) comes with the tray either
  // way, so it's called out separately rather than lumped into one list.
  //
  // High school lunch only: it's actually split across several food
  // stations (Ballpark Classics, Taco Street, etc. - confirmed against
  // the district's other menu site), each with its own entrees. There's
  // no field identifying which station an item belongs to, but stations
  // are entered as contiguous runs - one or more entrees, then that
  // station's specific sides, before the next station's entrees start.
  // groupEntreeRuns() finds those runs from the item order itself: real
  // separation shows up as more than one group. Some high school days
  // happen to have no side item between two stations, so it'll still
  // under-split those - not perfect, but never worse than one flat box.
  // Deliberately scoped to High Schools only, rather than relying on it
  // being a no-op everywhere else.
  const { groups: entreeGroups, commonSides } =
    info.group === "High Schools"
      ? groupEntreeRuns(dayItems)
      : {
          // Every other menu: exactly what it's always been - one group
          // holding all the entrees, its sides right below it, nothing
          // held back as "common".
          groups: (() => {
            const entrees = dayItems.filter((it) => it.product.category === "Entrees");
            const sides = dayItems.filter((it) => it.product.category !== "Entrees");
            return entrees.length ? [{ entrees, sides }] : [];
          })(),
          commonSides: [],
        };

  // Each station's own sides (fries with a combo, toppings for a build-
  // your-own, etc.) render right under its Entree box, not pooled with
  // everyone else's - see groupEntreeRuns(). Only truly shared items
  // (after the "Shared Items" marker, or the whole day when there's no
  // station split at all) land in the common section at the bottom.
  const choicesHtml = entreeGroups
    .map((group) => {
      const entrees = sortItemsForDay(group.entrees);
      const sides = sortItemsForDay(group.sides);
      return `
        <div class="choiceGroup">
          <div class="choiceLabel">Entree</div>
          <ul class="choiceList">
            ${entrees.map((it) => `<li>${renderItemLine(it)}</li>`).join("")}
          </ul>
        </div>
        ${renderSideGroups(sides)}
      `;
    })
    .join("");

  const commonSidesHtml = renderSideGroups(sortItemsForDay(commonSides));

  return `
    ${gradeBadge ? `<div class="sectionMeta">${gradeBadge}</div>` : ""}
    ${choicesHtml}
    ${commonSidesHtml}
  `;
}

async function renderOneMenu(menuId, bodyEl) {
  if (!bodyEl) return;
  const info = MENU_BY_ID[menuId];
  bodyEl.innerHTML = await computeDayHtml(info, state.currentDate);
}

async function renderOneMenuWeek(menuId, bodyEl) {
  if (!bodyEl) return;
  const info = MENU_BY_ID[menuId];
  const dates = weekDatesFor(state.currentDate);
  const dayHtmls = await Promise.all(dates.map((d) => computeDayHtml(info, d)));

  const cardsHtml = dates
    .map((d, i) => {
      const cls = isToday(d) ? "weekDayCard today" : "weekDayCard";
      return `
        <div class="${cls}">
          <div class="weekDayHeader">
            <span class="weekDayWeekday">${WEEKDAY_NAMES[d.getDay()].slice(0, 3)}</span>
            ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}
          </div>
          ${dayHtmls[i]}
        </div>
      `;
    })
    .join("");

  bodyEl.innerHTML = `<div class="weekScroll">${cardsHtml}</div>`;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// The API sends allergen_* flags as "1"/null rather than real booleans.
function isAllergenFlagged(v) {
  return v === true || v === "1" || v === 1;
}

// "meat" isn't a real API field - a product counts as meat when it isn't
// flagged vegetarian.
function isMeat(product) {
  return !isAllergenFlagged(product.allergen_vegetarian);
}

// allergen_dairy and allergen_milk are separate API fields sharing one
// badge (see ALLERGEN_DEFS), but in every menu checked so far allergen_dairy
// is always "0" - allergen_milk is the one that actually carries the flag.
// Rather than assume that never changes, excluding "Milk" checks both.
const ALLERGEN_FIELD_ALIASES = {
  allergen_dairy: "allergen_milk",
  allergen_milk: "allergen_dairy",
};

function isFieldExcluded(field) {
  return (
    state.excludedAllergens.includes(field) ||
    state.excludedAllergens.includes(ALLERGEN_FIELD_ALIASES[field])
  );
}

// Badges for one product's flagged allergens, deduped so dairy+milk (same
// emoji) merge into one badge instead of showing the same icon twice.
// "Positive" entries (vegetarian - not a warning) are kept separate from
// the actual allergens rather than lumped into an "Allergens" grouping.
// Also figures out whether the item should be struck through (matches
// something in state.excludedAllergens) and whether the Allergens box
// itself should turn red (specifically an excluded *allergen* - "meat"
// alone doesn't turn the box red, since it isn't shown in it).
function allergenBadgesHtml(product) {
  const byIcon = new Map(); // icon (or "" for text-only) -> labels[]
  const positive = []; // [{ icon, label }]
  let hasExcludedAllergen = false;
  for (const def of ALLERGEN_DEFS) {
    if (!isAllergenFlagged(product[def.field])) continue;
    if (def.positive) {
      positive.push(def);
      continue;
    }
    if (isFieldExcluded(def.field)) hasExcludedAllergen = true;
    const icon = def.textOnly ? "" : def.icon;
    if (!byIcon.has(icon)) byIcon.set(icon, []);
    byIcon.get(icon).push(def.label);
  }

  const isExcluded =
    hasExcludedAllergen || (state.excludedAllergens.includes("meat") && isMeat(product));

  // Positive badges (vegetarian) stay inline right after the item name.
  // The Allergens box, if any, is a block of its own on the line below -
  // see renderItemLine.
  const positiveHtml = positive
    .map((def) => `<span class="allergenBadge allergenBadge-positive" title="${escapeHtml(def.label)}">${def.icon}</span>`)
    .join("");
  return {
    positiveHtml,
    warningHtml: renderAllergenWarnings(byIcon, hasExcludedAllergen),
    isExcluded,
  };
}

// Always shown in a labeled "Allergens" box - ALLERGEN_SHOW_LABELS only
// decides what's inside it: readable text+icon chips, or (default)
// icon-only badges with the name on hover/long-press. `isAlert` turns the
// box red instead of amber, when one of the shown allergens is excluded.
function renderAllergenWarnings(byIcon, isAlert) {
  if (byIcon.size === 0) return "";
  const chips = [...byIcon.entries()]
    .map(([icon, labels]) => {
      if (ALLERGEN_SHOW_LABELS) {
        return `<span class="allergenChip">${icon ? `${icon} ` : ""}${escapeHtml(labels.join("/"))}</span>`;
      }
      const label = escapeHtml(labels.join(", "));
      return icon
        ? `<span class="allergenBadge" title="${label}">${icon}</span>`
        : `<span class="allergenBadge allergenBadge-text" title="${label}">${label}</span>`;
    })
    .join("");
  const groupCls = isAlert ? "allergenGroup allergenGroup-alert" : "allergenGroup";
  return `
    <span class="${groupCls}">
      <span class="allergenGroupLabel">Allergens</span>
      <span class="allergenRow">${chips}</span>
    </span>
  `;
}

function renderItemLine(it) {
  const { positiveHtml, warningHtml, isExcluded } = allergenBadgesHtml(it.product);
  const nameCls = isExcluded ? "itemName itemName-excluded" : "itemName";
  return `<span class="${nameCls}">${escapeHtml(it.product.name)}</span>${positiveHtml}${warningHtml}`;
}

// ---------- Wire up ----------

document.getElementById("pickerToggle").addEventListener("click", openPicker);
document.getElementById("pickerClose").addEventListener("click", closePicker);
document.getElementById("pickerDone").addEventListener("click", closePicker);
document.getElementById("pickerScrim").addEventListener("click", closePicker);
document.getElementById("excludeToggle").addEventListener("click", openExcludePicker);
document.getElementById("excludePickerClose").addEventListener("click", closeExcludePicker);
document.getElementById("excludePickerDone").addEventListener("click", closeExcludePicker);
document.getElementById("excludePickerScrim").addEventListener("click", closeExcludePicker);
document.getElementById("disclaimerToggle").addEventListener("click", openDisclaimer);
document.getElementById("disclaimerClose").addEventListener("click", closeDisclaimer);
document.getElementById("disclaimerDone").addEventListener("click", closeDisclaimer);
document.getElementById("disclaimerScrim").addEventListener("click", closeDisclaimer);
document.getElementById("prevDay").addEventListener("click", () => changeDay(-1));
document.getElementById("nextDay").addEventListener("click", () => changeDay(1));
document.getElementById("todayBtn").addEventListener("click", goToToday);
document.getElementById("dayViewBtn").addEventListener("click", () => setViewMode("day"));
document.getElementById("weekViewBtn").addEventListener("click", () => setViewMode("week"));

buildPicker();
updatePickerCount();
buildExcludePicker();
updateExcludeCount();
renderDayLabel();
updateTodayButtonLabel();
updateViewModeButtons();
renderSections();
