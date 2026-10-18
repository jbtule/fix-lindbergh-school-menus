// Offline support for the app itself (index.html, JS, CSS, icons). Menu
// data already survives the vendor API being unreachable via menu-api.js's
// localStorage cache - but with no network at all the browser couldn't load
// the page to read that cache. This fills that gap.
//
// Network-first, not cache-first: online, every request goes to the network
// exactly as before (so deploy-pages.yml's ?v= cache-busting and
// checkForUpdate() in app.js keep working unchanged), and the response is
// saved. Only when the network fails is the saved copy served. Same-origin
// GETs only - cross-origin requests (vendor API, ical feeds, badges) pass
// through untouched.
const CACHE = "app-v1";

// Fetched up front so the app works offline after a single visit - without
// this, files loaded before the worker first activated wouldn't be saved
// until the next visit. Unversioned URLs; the page asks for ?v=<hash>
// versions, which match these via ignoreSearch below.
const PRECACHE = [
  "./",
  "index.html",
  "style.css",
  "version.js",
  "manifest.json",
  "src/app.js",
  "src/config.js",
  "src/menu-api.js",
  "src/menu-logic.js",
  "src/ical-naming.js",
  "src/station-boundaries.js",
  "icons/favicon-32.png",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/qr.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Individually, so one missing optional file (station-boundaries.js
      // is optional per deploy-pages.yml) doesn't fail the whole install.
      Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {}))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Saves a fresh response, dropping any older ?v= copies of the same file so
// the cache holds one version per path instead of one per deploy.
async function save(request, response) {
  const cache = await caches.open(CACHE);
  const path = new URL(request.url).pathname;
  for (const old of await cache.keys()) {
    if (new URL(old.url).pathname === path && old.url !== request.url) await cache.delete(old);
  }
  await cache.put(request, response);
}

async function networkFirst(event) {
  const { request } = event;
  try {
    const response = await fetch(request);
    if (response.ok) event.waitUntil(save(request, response.clone()));
    return response;
  } catch (err) {
    const cache = await caches.open(CACHE);
    const cached =
      (await cache.match(request)) ||
      (await cache.match(request, { ignoreSearch: true })) ||
      (request.mode === "navigate" ? await cache.match("index.html", { ignoreSearch: true }) : undefined);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(event));
});
