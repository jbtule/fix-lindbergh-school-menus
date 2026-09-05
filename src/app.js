// Lindbergh School Menus - static front end for the district's menu API.
// See config.js for the menu-type ids and how they were discovered, and
// menu-api.js for the actual vendor fetch calls (shared with the
// ical-building cron script - see scripts/build-ical.js).
// APP_VERSION comes from version.js (loaded before this file) - see
// checkForUpdate() below and .github/workflows/deploy-pages.yml, which
// generates the real value at deploy time.

import {
  MENU_GROUPS,
  MENU_BY_ID,
  ALLERGEN_DEFS,
  EXCLUDE_OPTIONS,
  VEGAN_BADGE,
  VEGAN_DISQUALIFYING_FIELDS,
  IDEA_CENTER_GRADE_BY_WEEKDAY,
  ICAL_BASE_URL,
  mealEmoji,
  SNACK_MEAL_NAMES,
  isSnackSideItem,
} from "./config.js?v=dead";
import { fetchMonthsList, fetchDocIdForDate, fetchMenuItems } from "./menu-api.js?v=dead";
import { icsSlugFor } from "./ical-naming.js?v=dead";

const STORAGE_KEY = "lsm.selectedMenus";
const EXCLUDE_STORAGE_KEY = "lsm.excludedAllergens";
const VIEW_MODE_STORAGE_KEY = "lsm.viewMode";
const COLLAPSED_STORAGE_KEY = "lsm.collapsedCategories";

// After 4pm, school's out and the day's menu is no longer useful - default
// ahead to tomorrow instead.
const END_OF_DAY_HOUR = 16;

// Side categories (raw API values, not display labels) open by default -
// everything else (Milk, Condiment, Grain, the blank/"Other" bucket, and
// any category not yet seen) starts collapsed. Entree boxes are never
// collapsible.
const DEFAULT_EXPANDED_CATEGORIES = new Set(["Vegetable", "Fruit"]);

const state = {
  selectedIds: loadSelectedIds(),
  excludedAllergens: loadExcludedAllergens(),
  currentDate: defaultDate(),
  viewMode: loadViewMode(), // "day" | "week"
  // Only holds entries the user has actually toggled, so it stays a
  // sparse diff against DEFAULT_EXPANDED_CATEGORIES - see
  // isCategoryCollapsed(). One global setting applied the same way on
  // every menu, not per-section, per how it's asked for.
  collapsedOverrides: loadCollapsedOverrides(),
};

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Today, unless it's past END_OF_DAY_HOUR - then the next day, since
// that's what's actually relevant to check next. Either way, school menus
// never have weekend data (see weekDatesFor()), so a landing on Sat/Sun
// keeps advancing to the following Monday instead of showing an empty day.
function defaultDate() {
  const now = new Date();
  const d = startOfDay(now);
  if (now.getHours() >= END_OF_DAY_HOUR) {
    d.setDate(d.getDate() + 1);
  }
  while (d.getDay() === 0 || d.getDay() === 6) {
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

function loadCollapsedOverrides() {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveCollapsedOverrides() {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(state.collapsedOverrides));
  } catch (e) {
    /* ignore - see saveSelectedIds */
  }
}

function isCategoryCollapsed(category) {
  if (Object.prototype.hasOwnProperty.call(state.collapsedOverrides, category)) {
    return state.collapsedOverrides[category];
  }
  return !DEFAULT_EXPANDED_CATEGORIES.has(category);
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
          const baseName = variants[0].baseName || variants[0].name;
          // Idea Center's baseName is always "Idea Center Breakfast"/
          // "Idea Center Lunch" - the meal is its last word (same
          // convention as scripts/build-ical.js's ideaCenterMeal).
          const emoji = mealEmoji(baseName.split(" ").pop());
          const bh = document.createElement("h5");
          bh.textContent = baseName;
          schoolEl.appendChild(bh);
          schoolEl.appendChild(
            buildMenuCheckboxList(
              variants.map((v) => ({
                id: v.id,
                label: `${emoji} ${v.name.slice((v.baseName || "").length).replace(/^\s*-\s*/, "")}`,
              }))
            )
          );
        }
      } else {
        schoolEl.appendChild(
          buildMenuCheckboxList(s.menus.map((m) => ({ id: m.id, label: `${mealEmoji(m.name)} ${m.name}` })))
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
  for (const { field, label, icon, excluding } of EXCLUDE_OPTIONS) {
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
    optLabel.appendChild(document.createTextNode(` ${excluding ? "🚫 " : ""}${icon} ${label}`));
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

function openLanguagePicker() {
  setPanelOpen("languagePicker", "languagePickerScrim", "languageToggle", true);
}

function closeLanguagePicker() {
  setPanelOpen("languagePicker", "languagePickerScrim", "languageToggle", false);
}

// Home-screen ("standalone") web app - no way to feature-detect this
// directly, so it's a heuristic based on how the page is currently being
// displayed. Two consumers: CAN_PRINT below, and updateInstallHint()
// further down.
const IS_STANDALONE =
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

// Home-screen web apps strip out all browser chrome, and window.print()
// has no print sheet left to attach to there - iOS in particular just
// silently no-ops it rather than erroring. There's no way to feature-detect
// that failure directly, so IS_STANDALONE decides whether the Print entry
// in the Actions popover even shows up - see openActionMenu().
const CAN_PRINT = !IS_STANDALONE;

// One shared small popover (positioned under whichever section's Actions
// icon was tapped) rather than one per menu section, since only one can
// ever be open at a time - see the markup comment in index.html. Its two
// entries (Print, Calendar Subscribe) each open a full side panel of their
// own - see openPrintPanel()/openSubscribePanel() below - the popover
// itself just picks which one.
let actionMenuGroup = null;

function openActionMenu(anchor, group) {
  actionMenuGroup = group;
  const popover = document.getElementById("actionPopover");
  // Disabled rather than hidden when !CAN_PRINT - explains why (see the
  // hint span in index.html) instead of the entry just vanishing.
  document.getElementById("actionPopoverPrint").disabled = !CAN_PRINT;
  document.getElementById("actionPopoverPrintHint").hidden = CAN_PRINT;
  popover.hidden = false;
  const rect = anchor.getBoundingClientRect();
  popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
  const left = Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - popover.offsetWidth - 8);
  popover.style.left = `${Math.max(left, window.scrollX + 8)}px`;
}

function closeActionMenu() {
  document.getElementById("actionPopover").hidden = true;
  actionMenuGroup = null;
}

// ---------- Print panel ----------

let printPanelGroup = null;

function openPrintPanel(group) {
  printPanelGroup = group;
  document.getElementById("printMenuName").textContent = `${group.school} - ${group.name}`;
  document.getElementById("printPanel").hidden = false;
  document.getElementById("printPanelScrim").hidden = false;
}

function closePrintPanel() {
  document.getElementById("printPanel").hidden = true;
  document.getElementById("printPanelScrim").hidden = true;
  printPanelGroup = null;
}

// ---------- Calendar subscribe panel ----------

let subscribeUrl = null; // the plain https .ics URL for whatever group is open

// Each calendar app wants a different URL shape to actually trigger its own
// "subscribe" flow on tap - the plain https URL alone (what #subscribeUrl
// shows for copy/paste) only works handed to Apple's Calendar app or typed
// into one of the others' own "subscribe by URL" screen directly.
//   apple   - webcal: is a registered protocol Calendar.app/iOS handle
//             directly, no site visit involved.
//   google  - undocumented but long-stable "render?cid=" deep link that
//             opens Google Calendar straight to its own add-subscription
//             confirmation, pre-filled. The cid value itself needs to be
//             a webcal: URL, not https: - confirmed against a working
//             third-party site (pack3721.github.io/cub-cal) using the
//             identical pattern; we'd been passing the plain https: URL,
//             which is the likely reason Google Calendar kept failing to
//             load it ("Calendar could not load the data").
//   outlook - Outlook.com's own subscribe-modal deep link, likewise
//             pre-filled via query params, https: URL (not webcal:).
//             /calendar/0/addcalendar was an untested guess; this
//             /owa?...&rru=addsubscription... form is the one actually
//             confirmed working (a Microsoft Q&A thread, and the same
//             pack3721.github.io/cub-cal reference that fixed the Google
//             link above uses this exact pattern too). Reportedly only
//             pre-fills the subscribe dialog when not already logged
//             into outlook.live.com in that browser - logged in, it can
//             show the "new event" compose dialog instead. Nothing we
//             can do about that from our end; it's still the correct
//             link either way.
function calendarAppLink(app, url, name) {
  const webcalUrl = url.replace(/^https?:/, "webcal:");
  switch (app) {
    case "google":
      return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`;
    case "outlook":
      return `https://outlook.live.com/owa?path=/calendar/action/compose&rru=addsubscription&url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
    default:
      return webcalUrl;
  }
}

function updateSubscribeLink() {
  const app = document.querySelector('input[name="calendarApp"]:checked').value;
  const name = document.getElementById("subscribeMenuName").textContent;
  const link = document.getElementById("subscribeLink");
  link.href = calendarAppLink(app, subscribeUrl, name);
  // Google/Outlook open their own confirmation page - that should happen in
  // a new tab, not navigate away from the app. webcal: is a protocol
  // handoff, not a page load, so target is irrelevant there either way.
  link.target = app === "apple" ? "" : "_blank";
}

function openSubscribePanel(group) {
  document.getElementById("subscribeMenuName").textContent = `${group.school} - ${group.name}`;
  subscribeUrl = `${ICAL_BASE_URL}/${icsSlugFor(group)}.ics`;
  document.getElementById("subscribeUrl").textContent = subscribeUrl;
  updateSubscribeLink();
  document.getElementById("subscribePanel").hidden = false;
  document.getElementById("subscribePanelScrim").hidden = false;
}

function closeSubscribePanel() {
  document.getElementById("subscribePanel").hidden = true;
  document.getElementById("subscribePanelScrim").hidden = true;
}

// ---------- Install (Add to Home Screen) ----------

// No cross-browser API to ask "is this installable" or to trigger the
// install UI directly. Chrome/Edge/Android fire beforeinstallprompt when
// the page qualifies - intercepted and stashed here, since browsers only
// allow calling .prompt() on it later, in response to an actual user
// gesture (the panel's own button), not immediately on capture. Safari
// never fires this event at all - not "hasn't yet", never - so iOS gets
// detected separately below and shown manual instructions instead.
let deferredInstallPrompt = null;
const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  updateInstallHint();
});

// Covers installing via the browser's own menu instead of this button.
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallHint();
});

// Nothing to offer once already installed. Otherwise: show it if a real
// install prompt is available (Chrome/Edge/Android), or on iOS regardless
// (no prompt event ever fires there, but "Share > Add to Home Screen" is
// always an option) - anywhere else, nothing useful to tell that visitor,
// so it stays hidden rather than showing a dead end.
function updateInstallHint() {
  document.getElementById("installHint").hidden = IS_STANDALONE || !(deferredInstallPrompt || IS_IOS);
}

function openInstallPanel() {
  const body = document.getElementById("installPanelBody");
  const goBtn = document.getElementById("installPanelGo");
  const benefit = "Get quick access - no address bar, its own icon on your Home Screen.";
  if (deferredInstallPrompt) {
    body.textContent = benefit;
    goBtn.textContent = "Install";
  } else {
    // iOS - no API to trigger this, only Safari's own Share sheet can, so
    // there's nothing for the button to actually do here but close the
    // panel once they've read the steps.
    body.textContent = `Tap the Share icon, then "Add to Home Screen". ${benefit}`;
    goBtn.textContent = "Understood";
  }
  document.getElementById("installPanel").hidden = false;
  document.getElementById("installPanelScrim").hidden = false;
}

function closeInstallPanel() {
  document.getElementById("installPanel").hidden = true;
  document.getElementById("installPanelScrim").hidden = true;
}

// Same single-shared-instance approach as the print popover above: one
// element repositioned under whichever (i) was tapped.
let stationInfoAnchor = null;

function openStationInfo(anchor) {
  const popover = document.getElementById("stationInfoPopover");
  stationInfoAnchor = anchor;
  popover.hidden = false;
  const rect = anchor.getBoundingClientRect();
  popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
  // Prefer left-aligned under the (i), but pull it back inside the viewport
  // when that would overflow the right edge - these buttons sit well into
  // the page, so on a phone the natural position is usually off-screen.
  // clientWidth, not innerWidth: it excludes a classic scrollbar.
  const viewport = document.documentElement.clientWidth;
  const width = popover.offsetWidth;
  const left = Math.min(rect.left + window.scrollX, window.scrollX + viewport - width - 8);
  popover.style.left = `${Math.max(left, window.scrollX + 8)}px`;
}

function closeStationInfo() {
  document.getElementById("stationInfoPopover").hidden = true;
  stationInfoAnchor = null;
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
// Day view also skips weekends - school menus never have weekend data (see
// weekDatesFor()) - continuing in the same direction rather than landing on
// an empty Sat/Sun. Week view doesn't need this: +/-7 days always lands on
// the same weekday it started on.
function changeDay(delta) {
  const step = state.viewMode === "week" ? delta * 7 : delta;
  const d = new Date(state.currentDate);
  d.setDate(d.getDate() + step);
  if (state.viewMode !== "week") {
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() + (delta < 0 ? -1 : 1));
    }
  }
  state.currentDate = d;
  renderDayLabel();
  renderSections();
}

function goToToday() {
  state.currentDate = defaultDate();
  renderDayLabel();
  renderSections();
}

// The button jumps to defaultDate(), which is the next day after
// END_OF_DAY_HOUR (and always skips straight past any weekend) - so it
// should say so, rather than always saying "Today" and jumping ahead
// anyway. "Next Weekday" rather than "Tomorrow" since that's not always
// literally tomorrow - e.g. Friday evening, or any time Sat/Sun.
function updateTodayButtonLabel() {
  const btn = document.getElementById("todayBtn");
  const isToday = defaultDate().getTime() === startOfDay(new Date()).getTime();
  btn.textContent = isToday ? "Jump to Today" : "Jump to Next Weekday";
  btn.title = isToday
    ? "Show today's menu"
    : "Show the next school day's menu - skips weekends, and jumps ahead after 4pm since today's menu isn't useful anymore";
}

function setViewMode(mode) {
  if (state.viewMode === mode) return;
  state.viewMode = mode;
  saveViewMode();
  updateViewModeButtons();
  updateBodyViewModeClass();
  renderDayLabel();
  renderSections();
}

// Lets CSS give day view's menu sections a fixed width (so they can sit
// side by side on a wide screen - see .menuSection) without also
// shrinking week view's rows, which need the full width for their
// horizontal day-scroller.
function updateBodyViewModeClass() {
  document.body.classList.toggle("week-view", state.viewMode === "week");
}

function updateViewModeButtons() {
  document.getElementById("dayViewBtn").setAttribute("aria-pressed", String(state.viewMode === "day"));
  document.getElementById("weekViewBtn").setAttribute("aria-pressed", String(state.viewMode === "week"));
}

// Next (or same, if it already matches) date on/after `from` matching any
// weekday in the set. Used to tell a weekday-restricted combined menu (see
// groupSelectedMenus()) when it's next showing, when the current day
// doesn't match any of its selected days.
function nextOccurrenceAmong(from, weekdaySet) {
  for (let i = 0; i < 7; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    if (weekdaySet.has(d.getDay())) return d;
  }
  return from; // weekdaySet was empty - shouldn't happen when this is called
}

// Idea Center variants (Full Week + one per grade's day) all share the
// same underlying apiId - selecting several combines them into one
// section instead of showing duplicates, since they're all "the same
// menu," just restricted to different days. Every other menu has an
// apiId unique to itself, so it can never merge with anything else here.
// hasFullWeek wins over specificDays for *whether content shows* (Full
// Week has no day restriction at all), but specificDays alone still
// drives the grade badge - see computeDayHtml() - so a grade badge only
// ever shows on a day that was explicitly selected as that grade's day,
// never just because Full Week happens to include it too.
function groupSelectedMenus(selectedIds) {
  const byApiId = new Map();
  const order = [];
  for (const id of selectedIds) {
    const info = MENU_BY_ID[id];
    if (!info) continue; // stale id from an old config, ignore
    if (!byApiId.has(info.apiId)) {
      const combined = {
        name: info.baseName,
        school: info.school,
        group: info.group,
        apiId: info.apiId,
        hasFullWeek: false,
        specificDays: new Set(),
      };
      byApiId.set(info.apiId, combined);
      order.push(combined);
    }
    const combined = byApiId.get(info.apiId);
    if (info.dayFilter === null) combined.hasFullWeek = true;
    else combined.specificDays.add(info.dayFilter);
  }
  return order;
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

// The district's own site offers Google's Website Translator widget (a
// free, no-API-key, no-account third-party widget - unlike the paid
// Google Cloud Translation API) for both its own UI text and the actual
// (dynamic, unbounded, can't be hand-translated) menu item names. Added
// on request, but genuinely optional - nobody had actually asked for
// non-English support yet at the time. Flip to false to fully remove it:
// when disabled, nothing is fetched from Google at all, not just hidden.
const TRANSLATE_WIDGET_ENABLED = true;

// Matches the language list the district's own site offers (seen live -
// they must feed this into includedLanguages from a per-district setting
// somewhere, since it isn't in their bundled JS as a fixed list),
// presumably tailored to their families' actual home languages rather
// than Google's full ~100-language default. The "show full list" checkbox
// in the Language picker re-inits the widget without this restriction.
const TRANSLATE_LANGUAGES = "en,es,fr,hy,zh-CN,ko,pt,ru,vi";
const TRANSLATE_FULL_LIST_KEY = "lsm.translateFullList";
// One-shot flag (sessionStorage, not localStorage - only meant to
// survive the single reload the checkbox triggers, not linger forever)
// so the panel reopens automatically afterward instead of the toggle
// dropping the user back at a closed picker.
const REOPEN_TRANSLATE_PANEL_KEY = "lsm.reopenTranslatePanel";

function loadTranslateFullList() {
  try {
    return localStorage.getItem(TRANSLATE_FULL_LIST_KEY) === "true";
  } catch (e) {
    return false;
  }
}

function saveTranslateFullList(value) {
  try {
    localStorage.setItem(TRANSLATE_FULL_LIST_KEY, String(value));
  } catch (e) {
    /* ignore - see saveSelectedIds */
  }
}

// Rebuildable, since the checkbox needs to re-init the widget with
// different options - Google's widget has no "update config" API of its
// own, so this just clears the container and constructs a fresh one.
function initTranslateElement() {
  const el = document.getElementById("google_translate_element");
  el.innerHTML = "";
  const options = { pageLanguage: "en" };
  if (!loadTranslateFullList()) options.includedLanguages = TRANSLATE_LANGUAGES;
  new google.translate.TranslateElement(options, el.id);
}

// Dynamically injects Google's script only when enabled, rather than a
// static <script> tag in index.html, so disabling this really means zero
// network requests to Google - not just an empty/hidden widget.
function loadTranslateWidget() {
  if (!TRANSLATE_WIDGET_ENABLED) return;
  document.getElementById("languageToggle").hidden = false;
  document.getElementById("translateFullListToggle").checked = loadTranslateFullList();
  window.googleTranslateElementInit = initTranslateElement;
  const script = document.createElement("script");
  script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
  script.async = true;
  document.head.appendChild(script);
}

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
function groupEntreeRuns(dayItemsInOrder, menuGroup) {
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
  // A day with no Entrees-category item at all (same case the non-high-
  // school branch below guards against - a snack-only menu is often just
  // one Grain-category item) never starts a group above, silently
  // dropping every item in stationItems. One sides-only group instead.
  if (groups.length === 0 && stationItems.length) {
    groups.push({ entrees: [], sides: stationItems });
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
    const collapsed = isCategoryCollapsed(cat);
    const catAttr = escapeHtml(cat);
    rows.push(`
      <div class="sideGroup${collapsed ? " collapsed" : ""}" data-category="${catAttr}">
        <button class="sideLabel" data-category="${catAttr}">${escapeHtml(label)}</button>
        <ul class="sideList">${items}</ul>
      </div>
    `);
  }
  // Wrapped in their own flex row so collapsed groups (small pills) can
  // sit side by side and wrap, while an expanded one still takes a full
  // row of its own - see .sideGroup/.sideGroup.collapsed.
  return `<div class="sideGroups">${rows.join("")}</div>`;
}

async function renderSections() {
  const container = document.getElementById("sections");
  const emptyState = document.getElementById("emptyState");
  const pickerToggle = document.getElementById("pickerToggle");
  closeActionMenu(); // its anchor is about to be torn down either way
  closeStationInfo(); // ditto - the (i) buttons are about to be replaced
  clearPrintArea(); // whatever was last printed is about to be out of date

  if (state.selectedIds.length === 0) {
    container.innerHTML = "";
    emptyState.hidden = false;
    pickerToggle.classList.add("pulse");
    return;
  }
  const groups = groupSelectedMenus(state.selectedIds);
  if (groups.length === 0) {
    container.innerHTML = "";
    emptyState.hidden = false;
    pickerToggle.classList.add("pulse");
    return;
  }
  emptyState.hidden = true;
  pickerToggle.classList.remove("pulse");

  container.innerHTML = "";
  const sectionEls = groups.map((group) => {
    const section = document.createElement("section");
    section.className = "menuSection";
    section.innerHTML = `
      <h2>
        ${group.school} - ${group.name}
        <button class="sectionActionsBtn" aria-label="Menu actions" title="Print, subscribe...">⋯ Actions</button>
      </h2>
      <div class="sectionBody"><p class="loading">Loading...</p></div>
    `;
    container.appendChild(section);
    const actionsBtn = section.querySelector(".sectionActionsBtn");
    actionsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!document.getElementById("actionPopover").hidden && actionMenuGroup === group) {
        closeActionMenu();
      } else {
        openActionMenu(actionsBtn, group);
      }
    });
    return section.querySelector(".sectionBody");
  });

  const renderOne = state.viewMode === "week" ? renderOneMenuWeek : renderOneMenu;
  await Promise.all(groups.map((group, i) => renderOne(group, sectionEls[i])));

  if (state.viewMode === "week") {
    syncWeekScrolls();
    scrollWeekToCurrentDate();
  }
}

// Scrolls to whichever date the nav is pointing at (the ".current" card -
// see renderOneMenuWeek) so e.g. "Jump to Next Weekday" actually brings
// that day into view instead of leaving the row sitting on Monday. Only
// needs to run on one row: syncWeekScrolls()'s listener mirrors the
// resulting scroll position onto every other selected menu's row as it
// animates.
function scrollWeekToCurrentDate() {
  // scrollIntoView(), Element.scrollTo({behavior:"smooth"}), and plain
  // offsetLeft all proved unreliable (settled short, didn't move at all,
  // or offsetLeft was relative to some ancestor other than the scroll
  // container). getBoundingClientRect() gives real on-screen geometry
  // regardless of positioning context, so the delta from it is exact.
  // Runs on every selected menu's row directly rather than leaning on
  // syncWeekScrolls() to propagate from just one.
  for (const target of document.querySelectorAll(".weekDayCard.current")) {
    const container = target.parentElement;
    const delta = target.getBoundingClientRect().left - container.getBoundingClientRect().left;
    container.scrollLeft += delta;
  }
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

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The district's own event calendar (see SCHOOL_CALENDAR_ICS_URL in
// config.js) says which days actually have no school, distilled by
// scripts/build-ical.js's daily cron into this small same-origin-CORS
// JSON - that endpoint itself has no CORS headers, so the browser can't
// fetch it directly. Shape: { dates: ["2026-09-07", ...], labels: {
// district: {date: text}, [school]: {date: text}, ... } } - `dates` is the
// complete, authoritative list (the district calendar); `labels[school]`
// is that specific school's own wording for a date, when it has an entry
// (see SCHOOL_CALENDAR_IDS's comment - not every school phrases every
// no-school day the same way, or lists every one at all).
//
// Cached for the page's lifetime (one request, however many empty days get
// checked against it); resolves to { dates: new Set(), labels: {} } on any
// failure (offline, not yet published, ICAL_BASE_URL unreachable) rather
// than rejecting, so a day just falls back to fetchDayItems()'s own
// heuristic instead of erroring.
let noSchoolDaysPromise = null;
function fetchNoSchoolDays() {
  if (!noSchoolDaysPromise) {
    noSchoolDaysPromise = fetch(`${ICAL_BASE_URL}/no-school-days.json`)
      .then((res) => (res.ok ? res.json() : { dates: [], labels: {} }))
      .then((data) => ({ dates: new Set(data.dates), labels: data.labels || {} }))
      .catch(() => ({ dates: new Set(), labels: {} }));
  }
  return noSchoolDaysPromise;
}

// That specific school's own wording for a no-school date, falling back to
// the district calendar's (always present for any date in `dates`).
function noSchoolLabelFor(noSchoolDays, school, isoDate) {
  return noSchoolDays.labels[school]?.[isoDate] || noSchoolDays.labels.district?.[isoDate];
}

// Computes the HTML for one menu on one date - shared by day view (one
// call) and week view (one call per weekday column). Never touches the
// DOM directly, so it works the same either way.
// Resolves which items (if any) apply to one menu on one date, or a short
// explanation when none do - shared by computeDayHtml() (on-screen day/
// week view) and computeDayItemsForPrint() (the clean week print table),
// so both agree on what counts as "not scheduled" vs. "nothing published
// yet" vs. an actual fetch failure.
async function fetchDayItems(info, date) {
  const weekday = date.getDay();

  if (!info.hasFullWeek && !info.specificDays.has(weekday)) {
    const next = nextOccurrenceAmong(date, info.specificDays);
    return { kind: "notScheduled", message: `Not scheduled this day. Next: ${formatDate(next)}.` };
  }

  let docId;
  try {
    docId = await fetchDocIdForDate(info.apiId, date);
  } catch (e) {
    return { kind: "error", message: `Couldn't load this menu (${e.message}).` };
  }

  if (!docId) {
    return {
      kind: "empty",
      message: `No menu published for ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}.`,
    };
  }

  let items;
  try {
    items = await fetchMenuItems(docId);
  } catch (e) {
    return { kind: "error", message: `Couldn't load items (${e.message}).` };
  }

  const dayItems = items.filter(
    (it) => it.day === date.getDate() && it.product && !isHiddenFromWebView(it.product)
  );

  if (dayItems.length === 0) {
    // First choice: the district's own calendar (see fetchNoSchoolDays())
    // says definitively, not a guess, whether this is an actual day off -
    // and, where available, that specific school's own reason for it.
    const noSchoolDays = await fetchNoSchoolDays();
    const isoDate = toISODate(date);
    if (noSchoolDays.dates.has(isoDate)) {
      // Every stored label already says "no school" in some form (that's
      // exactly what parseNoSchoolLabels() filtered on to collect it), so
      // prefixing our own "No school today" would always double up on
      // that - just show the label itself, generic fallback text only for
      // the (shouldn't-happen) case where somehow no label exists at all.
      const label = noSchoolLabelFor(noSchoolDays, info.school, isoDate);
      return {
        kind: "empty",
        message: label ? `${label}.` : "No school today.",
        isNoSchoolDay: true,
      };
    }
    // Fallback: the menu API has no holiday/day-off flag at all, so absent
    // the calendar above there's no way to know *why* a day has no items -
    // could be a holiday the calendar just doesn't have yet, an in-service
    // day, or a gap in the district's menu data. What IS knowable from data
    // already fetched: whether a LATER day this same month already has
    // items. If so, the district has clearly published past this point, so
    // this gap is intentional rather than "not entered yet" - but that's
    // all this weaker signal supports claiming; it says nothing about the
    // reason, so "yet" is the only word this drops, not a guess at what the
    // day is.
    const hasLaterItems = items.some((it) => it.day > date.getDate());
    return {
      kind: "empty",
      message: hasLaterItems ? "No menu published for this day." : "No items published for this day yet.",
      hasLaterItems,
    };
  }

  return { items: dayItems };
}

async function computeDayHtml(info, date) {
  const weekday = date.getDay();

  const result = await fetchDayItems(info, date);
  if (result.kind) return `<p class="${result.kind}">${result.message}</p>`;
  const dayItems = result.items;

  // Only shows on a day that was explicitly selected as that grade's day
  // (specificDays) - never just because "Full Week" happens to include
  // it too. Selecting Full Week alone (no specific grade-day alongside
  // it) shows no grade badges at all.
  const grade = info.specificDays.has(weekday) ? IDEA_CENTER_GRADE_BY_WEEKDAY[weekday] : null;
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
      ? groupEntreeRuns(dayItems, info.group)
      : {
          // Every other menu: exactly what it's always been - one group
          // holding all the entrees, its sides right below it, nothing
          // held back as "common". Keyed on having ANY item at all, not
          // specifically an entree - a sides-only day (a Flyers Club/Snack
          // menu is often just one Grain-category item, no Entrees-category
          // product at all) was silently dropping its items entirely, since
          // this used to require entrees.length > 0 just to keep the group.
          //
          // Flyers Club/Snack menus (see SNACK_MEAL_NAMES) are special-cased
          // further: their real food is the whole meal, not a side that
          // comes along with a "real" entree, so it counts as an entree
          // here rather than being filtered by category. Milk, condiments,
          // and juice (see isSnackSideItem()) still ride along as ordinary
          // sides even here - ECE's Snack menu pairs those with its
          // actual food, and they aren't "the snack" the way that food is.
          groups: (() => {
            const isSnackMenu = SNACK_MEAL_NAMES.has(info.name);
            const entrees = isSnackMenu
              ? dayItems.filter((it) => !isSnackSideItem(it.product))
              : dayItems.filter((it) => it.product.category === "Entrees");
            const sides = isSnackMenu
              ? dayItems.filter((it) => isSnackSideItem(it.product))
              : dayItems.filter((it) => it.product.category !== "Entrees");
            return entrees.length || sides.length ? [{ entrees, sides }] : [];
          })(),
          commonSides: [],
        };

  // Each station's own sides (fries with a combo, toppings for a build-
  // your-own, etc.) render right under its Entree box, not pooled with
  // everyone else's - see groupEntreeRuns(). Only truly shared items
  // (after the "Shared Items" marker, or the whole day when there's no
  // station split at all) land in the common section at the bottom.
  // --- station-boundaries.js hook (optional) --------------------------
  // Names whichever boxes it can identify with certainty; every entry is
  // null when the feature is off or the file is absent, which leaves the
  // generic "Entree" label below untouched. Delete these four lines and
  // the `label` expression to remove naming.
  //
  // info.group is passed so station-boundaries.js can enforce its own
  // high-school-only scope - see STATION_MENU_GROUP there.
  const stationNames =
    typeof stationNamesFor === "function"
      ? stationNamesFor(info.group, entreeGroups)
      : entreeGroups.map(() => null);
  // --------------------------------------------------------------------
  const choicesHtml = entreeGroups
    .map((group, groupIndex) => {
      const entrees = sortItemsForDay(group.entrees);
      const sides = sortItemsForDay(group.sides);
      // Sides-only day (see the comment above on keeping this group at
      // all) - nothing to label as an "Entree" choice, so skip that box
      // and just show whatever items there are.
      if (entrees.length === 0) return renderSideGroups(sides);
      // A named box gets an (i) explaining that the name is inferred; an
      // unnamed one keeps the plain "Entree" label with nothing to explain.
      const stationName = stationNames[groupIndex];
      const label = stationName || (SNACK_MEAL_NAMES.has(info.name) ? "Snack" : "Entree");
      const infoBtn = stationName
        ? `<button type="button" class="stationInfo" aria-label="About station names">i</button>`
        : "";
      return `
        <div class="choiceGroup">
          <div class="choiceLabelRow">
            <div class="choiceLabel">${escapeHtml(label)}</div>
            ${infoBtn}
          </div>
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

async function renderOneMenu(info, bodyEl) {
  if (!bodyEl) return;
  bodyEl.innerHTML = await computeDayHtml(info, state.currentDate);
}

async function renderOneMenuWeek(info, bodyEl) {
  if (!bodyEl) return;
  const dates = weekDatesFor(state.currentDate);
  const dayHtmls = await Promise.all(dates.map((d) => computeDayHtml(info, d)));

  const cardsHtml = dates
    .map((d, i) => {
      let cls = "weekDayCard";
      if (isToday(d)) cls += " today";
      // Scroll target for scrollWeekToCurrentDate() - real today, or
      // whatever "Jump to Today/Next Weekday" points to right now. Both
      // computed fresh against the clock (not state.currentDate): paging
      // week-to-week shifts state.currentDate by whole weeks, which
      // preserves its weekday forever, so matching against it directly
      // would keep re-marking (and re-scrolling to) that same weekday on
      // every future/past week - never resetting to a sensible default.
      if (isToday(d) || d.getTime() === defaultDate().getTime()) cls += " current";
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

// ---------- Print ----------

// Monday-Friday dates (1..last day) for the month containing `date`,
// arranged into a rectangular grid whose columns are always Mon/Tue/Wed/
// Thu/Fri, padded with `null` for the days outside the month - so e.g. a
// month starting on a Wednesday still lines up under the right weekday
// header instead of shifting the whole grid left.
function buildMonthGrid(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const rows = [];
  const rowByMonday = new Map();
  for (let day = 1; day <= lastDate; day++) {
    const d = new Date(year, month, day);
    const weekday = d.getDay();
    if (weekday === 0 || weekday === 6) continue; // no weekend menus
    const col = weekday - 1; // Mon=0 ... Fri=4
    const monday = new Date(d);
    monday.setDate(monday.getDate() - col);
    const key = monday.getTime();
    let row = rowByMonday.get(key);
    if (!row) {
      row = new Array(5).fill(null);
      rowByMonday.set(key, row);
      rows.push(row);
    }
    row[col] = d;
  }
  return rows;
}

// Compact, entree-only text for one menu's one day in the month print - no
// sides/allergens, since a whole month has to fit on a page. Returns
// { text } when there's something to show, or { note } for a short
// explanation (not scheduled that weekday, nothing published yet, etc.)
// so the caller can render a muted line instead of a blank-looking cell.
async function computeMonthEntrees(info, date) {
  const result = await fetchDayItems(info, date);
  if (result.kind === "notScheduled") return { note: "Not scheduled" };
  if (result.kind === "error") return { note: "Couldn't load" };
  // "yet" implies it's still coming - drop it once a later day this same
  // month already has data, since that means this gap is intentional, not
  // pending (though not why - see the hasLaterItems comment in
  // fetchDayItems()). isNoSchoolDay is the stronger, confirmed case - the
  // district's (or that school's own) calendar, not a guess - so it reuses
  // fetchDayItems()'s own message (the specific reason, e.g. "Labor Day-
  // No School") instead of a generic "No menu", just without the trailing
  // period to match this note's terser style ("Not scheduled" etc.).
  if (result.kind === "empty") {
    if (result.isNoSchoolDay) return { note: result.message.replace(/\.$/, "") };
    return { note: result.hasLaterItems ? "No menu" : "No menu yet" };
  }

  // Flyers Club/Snack (see SNACK_MEAL_NAMES): the real food is never filed
  // under "Entrees" - treat it as an entree rather than filtering by
  // category, same as computeDayHtml() above, excluding milk/condiments/
  // juice (isSnackSideItem()) the same way.
  const entrees = SNACK_MEAL_NAMES.has(info.name)
    ? result.items.filter((it) => !isSnackSideItem(it.product))
    : result.items.filter((it) => it.product.category === "Entrees");
  if (entrees.length === 0) return { note: "No menu yet" };
  return { items: sortItemsForDay(entrees) };
}

// Full detail (entrees, sides, allergens) for one menu's current Mon-Fri
// week - reuses computeDayHtml() directly, so a category collapsed on
// screen (see .sideGroup.collapsed handling in the print media query)
// comes out exactly as collapsed on paper. Printed one menu at a time -
// see the per-section print icon in renderSections().
// One item's plain-text print line: the name, any positive (vegetarian/
// vegan) badge inline exactly as shown on screen (already unboxed, just
// an icon+title), and negative allergens as a bare row of icons after it
// rather than allergenBadgesHtml()'s bordered "Allergens" box - the whole
// point of the print table is not looking like an interactive UI dumped
// onto paper. A dietary exclusion still stands out (bold + the danger
// color) without needing a box to do it.
function printItemLine(it) {
  const { positiveHtml, isExcluded } = allergenBadgesHtml(it.product);
  const icons = ALLERGEN_DEFS.filter(
    (def) => !def.positive && isAllergenFlagged(it.product[def.field])
  ).map((def) => def.icon || def.label);
  // Still labeled "Allergens" (the on-screen box's own label - see
  // renderAllergenWarnings()), just as plain text after the icons rather
  // than inside a bordered/colored box.
  const allergensHtml = icons.length
    ? ` <span class="printItemAllergens"><span class="printAllergenLabel">Allergens:</span> ${icons.join(" ")}</span>`
    : "";
  // Strikethrough rather than color, so an excluded item still reads on a
  // black-and-white printer, not just a color one.
  const nameCls = isExcluded ? "printItemName printItemName-excluded" : "printItemName";
  return `<li><span class="${nameCls}">${escapeHtml(it.product.name)}</span>${positiveHtml}${allergensHtml}</li>`;
}

// Same fetchDayItems() result as the on-screen view, but grouped by raw
// category rather than turned into HTML - the print table builds its own
// rows from this instead of reusing computeDayHtml()'s station-grouped,
// collapsible-pill markup (built for interactive on-screen use, not a
// plain grid). "Entrees" is deliberately not split into high-school food
// stations here - that grouping is a visual aid for the choice-box UI,
// not meaningful in a table cell.
async function computeDayItemsForPrint(info, date) {
  const result = await fetchDayItems(info, date);
  if (result.kind) return { note: result.message };
  // Flyers Club/Snack (see SNACK_MEAL_NAMES): remap every item's row to
  // "Entrees" so it lands in the print table's always-first row rather than
  // whatever side category the district actually filed it under - matches
  // the on-screen treatment in computeDayHtml(). Milk, condiments, and
  // juice (isSnackSideItem()) keep their own real category/row instead.
  const isSnackMenu = SNACK_MEAL_NAMES.has(info.name);
  const byCategory = new Map();
  for (const it of result.items) {
    const cat =
      isSnackMenu && !isSnackSideItem(it.product)
        ? "Entrees"
        : it.product.category || "";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(it);
  }
  const weekday = date.getDay();
  const grade =
    info.school === "Idea Center" && info.specificDays.has(weekday)
      ? IDEA_CENTER_GRADE_BY_WEEKDAY[weekday]
      : null;
  return { byCategory, grade };
}

// Tried making print honor an active Google Translate selection, three
// different ways: re-trigger the widget's hidden language <select> to
// force a reprocess and wait silently; wait passively (no retrigger) on
// the theory the widget keeps watching the page on its own; and, on the
// theory display:none content gets skipped, keep #printArea in the
// render tree (positioned off-screen) instead of hidden while waiting.
// All three were tested for real, on a phone with translation genuinely
// active - none of them ever caught the widget touching freshly-built
// print content, timing out with zero mutations seen every time. Whatever
// mechanism (if any) the widget has for catching up with new content
// added well after its initial pass, there's no way found here to hook
// into it. Print is English-only regardless of the page's translation.

// Whether #printArea currently holds real, button-built content is marked
// on the element itself, not tracked in a boolean tied to the print moment.
//
// Two earlier attempts both tied it to the moment and both broke on iOS.
// window.print() blocks until the dialog closes on desktop, but iOS
// Safari's is non-blocking and its print lifecycle does not line up with
// the desktop one: it returns immediately, and afterprint can fire before
// the preview has even rendered. So a flag cleared right after the call
// was already false at the real print moment - and so was a flag cleared
// on afterprint. Either way the beforeprint that actually mattered saw
// false and overwrote the freshly built menu with the fallback note below,
// which is the "print shows the wrong content on iPhone" bug.
//
// A data attribute on the content is not subject to that race: it is set
// when the content is built and cleared when the content stops being
// current (the next render), regardless of what order the print events
// arrive in, or whether they arrive at all - iOS Safari has historically
// not fired them reliably.
function markPrintAreaReady() {
  document.getElementById("printArea").dataset.printReady = "1";
}

// Restores #printArea to the fallback note rather than emptying it - see the
// markup comment in index.html for why the note has to be resting content
// instead of something beforeprint injects.
//
// Wrapped in a .printMenuSection so the note has the same shape as real print
// content rather than being a bare <p>. This was written while chasing a
// report of the note printing blank on iPhone, which then stopped
// reproducing and was never explained - quite possibly just a stale cached
// copy on the phone. Kept because matching the structure of everything else
// in #printArea is worth having on its own, NOT because it is a known fix.
const PRINT_FALLBACK_NOTE = `
    <section class="printMenuSection">
      <p class="printFallbackNote">
        Nothing to print yet - cancel this, then use \u{22EF} Actions > Print
        next to a menu's heading instead. It opens the print dialog for you.
      </p>
    </section>
  `;

function clearPrintArea() {
  const area = document.getElementById("printArea");
  delete area.dataset.printReady;
  area.innerHTML = PRINT_FALLBACK_NOTE;
}

function printNow() {
  markPrintAreaReady();
  window.print();
}

// A printed menu stops being "what you asked to print" once the print UI has
// closed, so retire it then and the next native print gets the fallback note
// instead of silently reprinting it.
//
// DESKTOP ONLY, and that restriction is the whole point. This file already
// establishes, further up, that iOS fires afterprint BEFORE the print preview
// has rendered - that is the bug data-print-ready exists to work around.
// Anything that mutates #printArea from afterprint therefore destroys the
// content on iOS before it is ever printed: hooking retirement to it made
// iPhone print the fallback note in every case, button included. A
// visibilitychange variant was tried too and failed the same way, since iOS's
// non-blocking window.print() lets the share sheet's hidden/visible
// transition land before the preview renders.
//
// So on touch devices nothing retires printed content early; it stays until
// the next render (see renderSections). A Share > Print immediately after
// printing therefore reprints the same menu, which is a far better failure
// than breaking the Print button. Detected by capability rather than by
// sniffing the user agent.
function retirePrintedContent() {
  if (document.getElementById("printArea").dataset.printReady === "1") {
    clearPrintArea();
  }
}
if (!window.matchMedia("(hover: none) and (pointer: coarse)").matches) {
  window.addEventListener("afterprint", retirePrintedContent);
}

// Third attempt at honoring an active Google Translate selection when
// printing. The first two (re-trigger the widget's hidden language
// <select> and wait silently; wait passively with #printArea positioned
// off-screen instead of display:none) both timed out with zero mutations
// ever seen, tested for real on a phone with translation active. This one
// makes #printArea genuinely on-screen - not hidden, not off-screen, a
// real full-viewport overlay - from before any content is even injected
// into it, on the theory the widget might only act on content that looks
// like regular, visible page content from the moment it exists. Only ever
// engaged when a translation is actually active - untranslated printing
// is unaffected, no visible flash, no delay.
function isTranslationActive() {
  return (
    document.documentElement.classList.contains("translated-ltr") ||
    document.documentElement.classList.contains("translated-rtl")
  );
}

const TRANSLATION_SETTLE_DELAY = 300;
// Generous on purpose while this is still being tested for real - the
// whole page is covered by the visible print preview for as long as this
// runs, so it's worth tuning down once it's clear whether this approach
// works at all.
const TRANSLATION_MAX_WAIT = 8000;

function waitForTranslation(el) {
  const start = performance.now();
  let mutationCount = 0;
  return new Promise((resolve) => {
    let settleTimer = null;
    const maxTimer = setTimeout(() => finish("timed out"), TRANSLATION_MAX_WAIT);
    const observer = new MutationObserver((records) => {
      mutationCount += records.length;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => finish("settled after mutation"), TRANSLATION_SETTLE_DELAY);
    });
    function finish(reason) {
      clearTimeout(settleTimer);
      clearTimeout(maxTimer);
      observer.disconnect();
      console.log(
        `[print translate wait] ${reason} after ${Math.round(performance.now() - start)}ms, ${mutationCount} mutation record(s) seen`
      );
      resolve();
    }
    observer.observe(el, { childList: true, subtree: true, characterData: true });
  });
}

// Shows the "Preparing translated print..." banner and waits - only ever
// called when isTranslationActive() is already true, so no check needed
// here; the caller (printWeek()/printMonth()) is what decides whether any
// of this engages at all.
async function prepareForPrint(area) {
  const banner = document.getElementById("printPreparingBanner");
  banner.hidden = false;
  try {
    await waitForTranslation(area);
  } finally {
    banner.hidden = true;
  }
}

// Clean, table-shaped week print - a plain category-by-day grid, easy to
// scan at a glance and free of anything that only makes sense as a
// clickable on-screen control. Categories collapsed on screen (see
// isCategoryCollapsed()) are left out of the grid entirely, same as they
// are on screen, just by omitting the row rather than hiding it.
async function printWeek(group) {
  const dates = weekDatesFor(state.currentDate);
  const area = document.getElementById("printArea");
  const translated = isTranslationActive();

  // Genuinely visible on screen from before any content lands in it, not
  // just for the wait afterward - see the comment above isTranslationActive().
  if (translated) area.classList.add("printPreviewing");

  area.innerHTML = `
    <section class="printMenuSection">
      <h2>${escapeHtml(group.school)} - ${escapeHtml(group.name)}</h2>
      <p class="loading">Loading...</p>
    </section>
  `;
  const loading = area.querySelector(".loading");

  const dayResults = await Promise.all(dates.map((d) => computeDayItemsForPrint(group, d)));

  // Whatever categories actually showed up this week, in the site's usual
  // side-category order, minus anything collapsed on screen. "Entrees"
  // always leads regardless of that order, and is never collapsible.
  const categoriesPresent = new Set();
  for (const r of dayResults) {
    if (r.byCategory) for (const cat of r.byCategory.keys()) categoriesPresent.add(cat);
  }
  categoriesPresent.delete("Entrees");
  const sideCats = [
    ...SIDE_CATEGORY_ORDER.filter((c) => categoriesPresent.has(c)),
    ...[...categoriesPresent].filter((c) => !SIDE_CATEGORY_ORDER.includes(c)),
  ].filter((c) => !isCategoryCollapsed(c));
  const rows = ["Entrees", ...sideCats];
  // Flyers Club/Snack (see SNACK_MEAL_NAMES): computeDayItemsForPrint()
  // already remapped its one item into the "Entrees" row - label that row
  // "Snack" here to match, rather than the generic "Entree".
  const isSnackMenu = SNACK_MEAL_NAMES.has(group.name);

  const headerRow = `
    <tr>
      <th></th>
      ${dates
        .map((d, i) => {
          const grade = dayResults[i].grade;
          return `
            <th>
              ${WEEKDAY_NAMES[d.getDay()].slice(0, 3)} ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}
              ${grade ? `<span class="printGradeNote">${escapeHtml(grade)}</span>` : ""}
            </th>
          `;
        })
        .join("")}
    </tr>
  `;

  const bodyRows = rows
    .map((cat) => {
      const label = cat === "Entrees" ? (isSnackMenu ? "Snack" : "Entree") : SIDE_CATEGORY_LABELS[cat] || cat || "Other";
      const cells = dayResults
        .map((r) => {
          if (r.note) return cat === "Entrees" ? `<td class="printWeekNote">${escapeHtml(r.note)}</td>` : "<td></td>";
          const items = r.byCategory.get(cat);
          if (!items) return "<td></td>";
          return `<td><ul class="printItemList">${sortItemsForDay(items).map((it) => printItemLine(it)).join("")}</ul></td>`;
        })
        .join("");
      return `<tr><th class="printWeekRowLabel">${escapeHtml(label)}</th>${cells}</tr>`;
    })
    .join("");

  loading.outerHTML = `
    <table class="printWeekTable">
      <thead>${headerRow}</thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;

  if (translated) await prepareForPrint(area);
  printNow();
  area.classList.remove("printPreviewing");
}

// Compact whole-month calendar, entree names only, for one menu - see
// computeMonthEntrees() for why it's entree-only rather than reusing
// computeDayHtml() the way printWeek() does. Printed one menu at a time -
// see the per-section print icon in renderSections().
async function printMonth(group) {
  const grid = buildMonthGrid(state.currentDate);
  const monthLabel = `${MONTH_NAMES[state.currentDate.getMonth()]} ${state.currentDate.getFullYear()}`;
  const headerRow = `<tr>${WEEKDAY_NAMES.slice(1, 6)
    .map((n) => `<th>${n}</th>`)
    .join("")}</tr>`;
  const area = document.getElementById("printArea");
  const translated = isTranslationActive();

  if (translated) area.classList.add("printPreviewing");

  area.innerHTML = `
    <section class="printMenuSection">
      <h2>${escapeHtml(group.school)} - ${escapeHtml(group.name)} - ${monthLabel}</h2>
      <p class="loading">Loading...</p>
    </section>
  `;
  const loading = area.querySelector(".loading");

  const rowsHtml = await Promise.all(
    grid.map(async (row) => {
      const cells = await Promise.all(
        row.map(async (d) => {
          if (!d) return "<td></td>";
          const result = await computeMonthEntrees(group, d);
          const body = result.items
            ? `<ul class="printItemList">${result.items.map((it) => `<li>${escapeHtml(it.product.name)}</li>`).join("")}</ul>`
            : `<span class="printMonthNote">${escapeHtml(result.note)}</span>`;
          return `<td><span class="printMonthDate">${d.getDate()}</span>${body}</td>`;
        })
      );
      return `<tr>${cells.join("")}</tr>`;
    })
  );
  loading.outerHTML = `
    <table class="printMonthTable">
      <thead>${headerRow}</thead>
      <tbody>${rowsHtml.join("")}</tbody>
    </table>
  `;

  if (translated) await prepareForPrint(area);
  printNow();
  area.classList.remove("printPreviewing");
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

// See VEGAN_BADGE/VEGAN_DISQUALIFYING_FIELDS in config.js for what this
// does and doesn't account for.
function isVegan(product) {
  return (
    isAllergenFlagged(product.allergen_vegetarian) &&
    !VEGAN_DISQUALIFYING_FIELDS.some((f) => isAllergenFlagged(product[f]))
  );
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
      // Vegan is a stronger, more specific claim than vegetarian - show
      // just that badge instead of both when it applies.
      positive.push(def.field === "allergen_vegetarian" && isVegan(product) ? VEGAN_BADGE : def);
      continue;
    }
    if (isFieldExcluded(def.field)) hasExcludedAllergen = true;
    const icon = def.textOnly ? "" : def.icon;
    if (!byIcon.has(icon)) byIcon.set(icon, []);
    byIcon.get(icon).push(def.label);
  }

  const isExcluded =
    hasExcludedAllergen ||
    (state.excludedAllergens.includes("vegetarian") && isMeat(product)) ||
    (state.excludedAllergens.includes("vegan") && !isVegan(product));

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
document.getElementById("languageToggle").addEventListener("click", openLanguagePicker);
document.getElementById("languagePickerClose").addEventListener("click", closeLanguagePicker);
document.getElementById("languagePickerDone").addEventListener("click", closeLanguagePicker);
document.getElementById("languagePickerScrim").addEventListener("click", closeLanguagePicker);
document.getElementById("translateFullListToggle").addEventListener("change", (e) => {
  // Rebuilding the widget in place (clear the container, construct a new
  // one) left it empty until a real page reload - it seems to rely on
  // some internal state tied to its first init that doesn't survive
  // being torn down and reconstructed. A full reload is the reliable
  // version of the same thing: it goes through loadTranslateWidget()
  // fresh, same as any normal page load.
  saveTranslateFullList(e.target.checked);
  try {
    sessionStorage.setItem(REOPEN_TRANSLATE_PANEL_KEY, "1");
  } catch (err) {
    /* ignore - see saveSelectedIds; worst case the panel just doesn't
       reopen automatically */
  }
  location.reload();
});
document.getElementById("actionPopoverPrint").addEventListener("click", () => {
  const group = actionMenuGroup;
  closeActionMenu();
  if (group) openPrintPanel(group);
});
document.getElementById("actionPopoverSubscribe").addEventListener("click", () => {
  const group = actionMenuGroup;
  closeActionMenu();
  if (group) openSubscribePanel(group);
});
// Closing on outside click/scroll - opening itself is handled per-icon in
// renderSections(), since each icon needs to know which menu it's for.
document.addEventListener("click", (e) => {
  if (document.getElementById("actionPopover").hidden) return;
  if (e.target.closest("#actionPopover")) return;
  closeActionMenu();
});
window.addEventListener("scroll", closeActionMenu, { passive: true, capture: true });

document.getElementById("printPanelGo").addEventListener("click", () => {
  const group = printPanelGroup;
  const range = document.querySelector('input[name="printRange"]:checked').value;
  closePrintPanel();
  if (!group) return;
  if (range === "month") printMonth(group);
  else printWeek(group);
});
document.getElementById("printPanelClose").addEventListener("click", closePrintPanel);
document.getElementById("printPanelScrim").addEventListener("click", closePrintPanel);

for (const radio of document.querySelectorAll('input[name="calendarApp"]')) {
  radio.addEventListener("change", updateSubscribeLink);
}
// Same "picking an action closes the panel" pattern as the print panel -
// doesn't wait to see whether the webcal:/Google/Outlook handoff actually
// succeeds, just like printPanelGo doesn't wait for the print dialog.
document.getElementById("subscribeLink").addEventListener("click", closeSubscribePanel);
document.getElementById("subscribePanelClose").addEventListener("click", closeSubscribePanel);
document.getElementById("subscribePanelScrim").addEventListener("click", closeSubscribePanel);

document.getElementById("installHint").addEventListener("click", openInstallPanel);
document.getElementById("installPanelClose").addEventListener("click", closeInstallPanel);
document.getElementById("installPanelScrim").addEventListener("click", closeInstallPanel);
document.getElementById("installPanelGo").addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    // iOS - nothing to do but dismiss (the button reads "Understood" here).
    closeInstallPanel();
    return;
  }
  closeInstallPanel();
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  updateInstallHint();
});

// Delegated: the (i) buttons are re-created on every render.
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".stationInfo");
  if (btn) {
    const wasOpen =
      !document.getElementById("stationInfoPopover").hidden && stationInfoAnchor === btn;
    closeStationInfo();
    if (!wasOpen) openStationInfo(btn);
    return;
  }
  if (document.getElementById("stationInfoPopover").hidden) return;
  if (e.target.closest("#stationInfoPopover")) return;
  closeStationInfo();
});
window.addEventListener("scroll", closeStationInfo, { passive: true, capture: true });
// The print CSS hides everything except #printArea, which is only ever
// filled by printWeek()/printMonth() - so a native Ctrl+P/Cmd+P (or
// iOS's Share > Print) without ever tapping a menu's own Print button
// first would otherwise print whatever #printArea last happened to hold
// (stale content from an earlier button print, or nothing at all).
// This only does useful work on desktop, though it is left unconditional
// because it is inert rather than harmful elsewhere: it either returns early
// or writes the note over content that is already the note. iOS does not need
// it - #printArea holds the fallback note whenever there is nothing current
// to print, so a native Share > Print shows the right thing with no event
// involved. On desktop, where beforeprint is reliable and fires before the
// page is rendered for print, it additionally catches Ctrl+P/Cmd+P issued
// while a button-built menu is still sitting in #printArea, pointing the user
// at the real Print button instead of printing a menu they did not ask for.
window.addEventListener("beforeprint", () => {
  const area = document.getElementById("printArea");
  if (area.dataset.printReady === "1") return;
  area.innerHTML = PRINT_FALLBACK_NOTE;
});
document.getElementById("disclaimerToggle").addEventListener("click", openDisclaimer);
document.getElementById("disclaimerClose").addEventListener("click", closeDisclaimer);
document.getElementById("disclaimerDone").addEventListener("click", closeDisclaimer);
document.getElementById("disclaimerScrim").addEventListener("click", closeDisclaimer);
document.getElementById("prevDay").addEventListener("click", () => changeDay(-1));
document.getElementById("nextDay").addEventListener("click", () => changeDay(1));
document.getElementById("todayBtn").addEventListener("click", goToToday);
document.getElementById("dayViewBtn").addEventListener("click", () => setViewMode("day"));
document.getElementById("weekViewBtn").addEventListener("click", () => setViewMode("week"));

// Drops any stored selections/exclusions that no longer exist in the
// current config - e.g. left over in localStorage from testing an older
// version of this site. Otherwise they'd inflate the "Menus"/"Dietary"
// badge counts forever without ever showing up as a checked box or a
// rendered section (both already silently skip unknown ids) - exactly
// the "count is 1 higher than what's actually selected" bug this fixes.
function pruneStaleSelections() {
  const validIds = state.selectedIds.filter((id) => MENU_BY_ID[id]);
  if (validIds.length !== state.selectedIds.length) {
    state.selectedIds = validIds;
    saveSelectedIds();
  }
  const validAllergens = new Set(EXCLUDE_OPTIONS.map((o) => o.field));
  const validExcluded = state.excludedAllergens.filter((f) => validAllergens.has(f));
  if (validExcluded.length !== state.excludedAllergens.length) {
    state.excludedAllergens = validExcluded;
    saveExcludedAllergens();
  }
}
pruneStaleSelections();

// Icon-only allergen badges (ALLERGEN_SHOW_LABELS = false, the default)
// rely on their title attribute for the name - fine on desktop via
// hover, but iOS Safari has no touch equivalent for title tooltips at
// all. This shows a small bubble with that same text on tap instead;
// the title attribute stays too, so desktop hover keeps working for
// free. Delegated on document since badges get torn down and rebuilt on
// every render.
let openTooltip = null;
let tooltipTimer = null;
function closeTooltip() {
  if (openTooltip) {
    openTooltip.remove();
    openTooltip = null;
  }
  clearTimeout(tooltipTimer);
}
document.addEventListener("click", (e) => {
  const badge = e.target.closest(".allergenBadge, .allergenBadge-text");
  closeTooltip();
  if (!badge || !badge.title) return;
  e.stopPropagation();
  const bubble = document.createElement("div");
  bubble.className = "tapTooltip";
  bubble.textContent = badge.title;
  document.body.appendChild(bubble);
  const rect = badge.getBoundingClientRect();
  bubble.style.left = `${rect.left + rect.width / 2}px`;
  bubble.style.top = `${rect.top}px`;
  openTooltip = bubble;
  tooltipTimer = setTimeout(closeTooltip, 4000);
});
// The bubble is position: fixed (anchored to a spot on screen), so it'd
// otherwise stay put while the badge that opened it scrolls away
// underneath it - just close it instead of trying to track position.
window.addEventListener("scroll", closeTooltip, { passive: true, capture: true });

// Collapsing a category (Milk, Condiments, etc. - never the Entree box)
// is one global setting applied identically everywhere, not per-section,
// so toggling it updates every currently-rendered .sideGroup for that
// category directly instead of re-fetching/re-rendering everything.
// Delegated for the same reason as the tooltip listener above.
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".sideLabel");
  if (!btn) return;
  const category = btn.dataset.category;
  const collapsed = !isCategoryCollapsed(category);
  state.collapsedOverrides[category] = collapsed;
  saveCollapsedOverrides();
  const selector = `.sideGroup[data-category="${CSS.escape(category)}"]`;
  for (const el of document.querySelectorAll(selector)) {
    el.classList.toggle("collapsed", collapsed);
  }
});

buildPicker();
updatePickerCount();
buildExcludePicker();
updateExcludeCount();
renderDayLabel();
updateTodayButtonLabel();
updateViewModeButtons();
updateBodyViewModeClass();
renderSections();
loadTranslateWidget();
updateInstallHint();

// Keeps a `--<name>-height` custom property in sync with an element's
// actual rendered height, for CSS elsewhere that stacks sticky elements
// on top of each other (.dayNav under .topbar, each .menuSection h2 under
// both - see style.css) and needs to know exactly how tall the ones above
// it really are, since none of those heights are fixed - the title wraps
// to two lines on narrow screens or with larger text settings, and
// .dayNav's controls can wrap too.
function trackHeightVar(el, name) {
  const set = (height) => document.documentElement.style.setProperty(`--${name}-height`, `${height}px`);
  // Set once synchronously up front - ResizeObserver's own first callback
  // isn't guaranteed to land before the very first paint, which would
  // otherwise leave whatever sticks below `el` sitting under the CSS
  // fallback value (a rough estimate) just long enough to overlap it.
  set(el.getBoundingClientRect().height);
  // Catches every subsequent change regardless of what caused it (viewport
  // resize, text zoom, font load), not just the window "resize" event.
  new ResizeObserver((entries) => {
    const height = entries[0].borderBoxSize
      ? entries[0].borderBoxSize[0].blockSize
      : entries[0].contentRect.height;
    set(height);
  }).observe(el);
}
trackHeightVar(document.querySelector(".topbar"), "topbar");
trackHeightVar(document.querySelector(".dayNav"), "daynav");

// See REOPEN_TRANSLATE_PANEL_KEY - only ever set right before the
// reload the "Show full language list" checkbox triggers, and cleared
// immediately here so it doesn't reopen the panel on any later, normal
// visit or refresh.
try {
  if (sessionStorage.getItem(REOPEN_TRANSLATE_PANEL_KEY)) {
    sessionStorage.removeItem(REOPEN_TRANSLATE_PANEL_KEY);
    openLanguagePicker();
  }
} catch (e) {
  /* ignore - see saveSelectedIds */
}

// Both of these are only computed at click/render time, so a tab left
// open across the 4pm cutoff (or midnight) would otherwise show a stale
// "Jump to Today" label or a stuck "today" highlight until the next
// interaction. This doesn't change what's actually displayed - just
// keeps the label and highlight honest about what "now" is. Once a
// minute is plenty for something that only changes twice a day at most.
setInterval(() => {
  updateTodayButtonLabel();
  renderDayLabel();
}, 60000);

// Reloads the page when a newer version has been deployed. No service
// worker needed: deploy-pages.yml writes a fresh APP_VERSION to
// version.js on every deploy, so re-fetching index.html fresh (bypassing
// the browser's own cache - see the disclaimer for why that cache
// exists) and reading back version.js's current ?v= hash is enough to
// tell. Matters most for a home-screen icon, which has no reload button
// or address bar of its own. This is a purely informational site with
// nothing to lose mid-session, so reloading silently rather than
// prompting first is fine.
function checkForUpdate() {
  fetch("index.html", { cache: "no-store" })
    .then((res) => res.text())
    .then((html) => {
      const match = html.match(/version\.js\?v=([a-f0-9]+)/);
      if (match && match[1] !== APP_VERSION) location.reload();
    })
    .catch(() => {}); // offline, or a blip - just try again next interval
}
// The realistic usage pattern here is "open the home-screen icon, glance
// at it, close it" - almost always well under 5 minutes, so a periodic
// timer alone would rarely get a chance to fire. Checking immediately on
// load, and again every time the page comes back to the foreground,
// covers that; the interval is just a fallback for a tab left open long.
checkForUpdate();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkForUpdate();
});
setInterval(checkForUpdate, 5 * 60000);
