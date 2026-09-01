// Lindbergh School Menus - static front end for the district's menu API.
// See config.js for the menu-type ids and how they were discovered.

const STORAGE_KEY = "lsm.selectedMenus";

// After 4pm, school's out and the day's menu is no longer useful - default
// ahead to tomorrow instead.
const END_OF_DAY_HOUR = 16;

const state = {
  selectedIds: loadSelectedIds(),
  currentDate: defaultDate(),
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

function openPicker() {
  document.getElementById("picker").hidden = false;
  document.getElementById("pickerScrim").hidden = false;
  document.getElementById("pickerToggle").setAttribute("aria-expanded", "true");
}

function closePicker() {
  document.getElementById("picker").hidden = true;
  document.getElementById("pickerScrim").hidden = true;
  document.getElementById("pickerToggle").setAttribute("aria-expanded", "false");
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
  label.textContent = formatDate(state.currentDate);
  label.classList.toggle("isToday", isToday(state.currentDate));
}

function changeDay(delta) {
  const d = new Date(state.currentDate);
  d.setDate(d.getDate() + delta);
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
  btn.textContent = defaultDate().getTime() === startOfDay(new Date()).getTime()
    ? "Today"
    : "Tomorrow";
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

// ---------- Rendering menu sections ----------

const CATEGORY_ORDER = ["Entrees", "Vegetable", "Fruit", "Milk", "Condiment"];

function sortItemsForDay(items) {
  return [...items].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.product.category);
    const bi = CATEGORY_ORDER.indexOf(b.product.category);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
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
    const items = byCategory.get(cat).map((it) => `<li>${escapeHtml(it.product.name)}</li>`).join("");
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

  await Promise.all(
    state.selectedIds.map((id) => renderOneMenu(id, sectionEls[id]))
  );
}

async function renderOneMenu(menuId, bodyEl) {
  if (!bodyEl) return;
  const info = MENU_BY_ID[menuId];
  const date = state.currentDate;
  const weekday = date.getDay();

  if (info.dayFilter !== null && weekday !== info.dayFilter) {
    const next = nextOccurrence(date, info.dayFilter);
    bodyEl.innerHTML = `<p class="notScheduled">Not scheduled today. Next: ${formatDate(next)}.</p>`;
    return;
  }

  let docId;
  try {
    docId = await fetchDocIdForDate(info.apiId, date);
  } catch (e) {
    bodyEl.innerHTML = `<p class="error">Couldn't load this menu (${e.message}).</p>`;
    return;
  }

  if (!docId) {
    bodyEl.innerHTML = `<p class="empty">No menu published for ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}.</p>`;
    return;
  }

  let items;
  try {
    items = await fetchMenuItems(docId);
  } catch (e) {
    bodyEl.innerHTML = `<p class="error">Couldn't load items (${e.message}).</p>`;
    return;
  }

  const dayItems = items.filter((it) => it.day === date.getDate() && it.product);

  if (dayItems.length === 0) {
    bodyEl.innerHTML = `<p class="empty">No items published for this day yet.</p>`;
    return;
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
  const entreeItems = sortItemsForDay(dayItems.filter((it) => it.product.category === "Entrees"));
  const sideItems = sortItemsForDay(dayItems.filter((it) => it.product.category !== "Entrees"));

  const choicesHtml = entreeItems.length
    ? `
      <div class="choiceGroup">
        <div class="choiceLabel">Entree</div>
        <ul class="choiceList">
          ${entreeItems.map((it) => `<li>${escapeHtml(it.product.name)}</li>`).join("")}
        </ul>
      </div>
    `
    : "";

  const sidesHtml = renderSideGroups(sideItems);

  bodyEl.innerHTML = `
    ${gradeBadge ? `<div class="sectionMeta">${gradeBadge}</div>` : ""}
    ${choicesHtml}
    ${sidesHtml}
  `;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---------- Wire up ----------

document.getElementById("pickerToggle").addEventListener("click", openPicker);
document.getElementById("pickerClose").addEventListener("click", closePicker);
document.getElementById("pickerDone").addEventListener("click", closePicker);
document.getElementById("pickerScrim").addEventListener("click", closePicker);
document.getElementById("prevDay").addEventListener("click", () => changeDay(-1));
document.getElementById("nextDay").addEventListener("click", () => changeDay(1));
document.getElementById("todayBtn").addEventListener("click", goToToday);

buildPicker();
updatePickerCount();
renderDayLabel();
updateTodayButtonLabel();
renderSections();
