# Manual verification scripts

These are **not** part of `npm test` and don't run in CI - they use
[Playwright](https://playwright.dev) to drive a real browser against a
locally-served copy of the site, and several of them call the live vendor
API, so their exact output depends on whatever menu data is published the
day you run them. They exist for a human tester, or an AI agent making a
change to `src/`, to actually watch the app render before/after a change -
the same kind of ad-hoc check that verified every fix made during the
session that added these files, just written down instead of thrown away.

None of them assert on specific menu content (that changes daily) - they
assert on *behavior*: does the page render without console errors, does a
Snack-type menu get the right label and category split, does a cached menu
survive the vendor API being unreachable. Read the console output; a
script prints what it found and lets you judge whether it looks right,
rather than a bare pass/fail.

## Running one

```sh
npm install                      # installs playwright (see package.json)
npx playwright install chromium  # one-time, downloads the browser binary
python3 -m http.server 8934 &    # from the repo root, in another terminal
node test/manual/render-smoke.mjs
```

Each script hardcodes `http://localhost:8934` - start the dev server first
(see the README's "Local development" section).

## What's here

- **`render-smoke.mjs`** - loads the app, selects a menu (Sappington Lunch
  by default; pass a different menu id as `argv[2]`), steps through the
  visible week, and reports any console/page errors plus what rendered.
  The first thing to run after any change to `src/app.js`.
- **`snack-category.mjs`** - the most involved case from this session:
  confirms Flyers Club and ECE Snack render their real food under a
  prominent "Snack" label while milk/condiments/juice stay ordinary sides,
  in both day view and the built `.ics` description (`npm run build-ical`
  must have been run first for the ics half).
- **`offline-cache.mjs`** - warms the localStorage cache for a menu, then
  blocks every vendor domain via Playwright request routing (simulating
  offline) and confirms the page still renders the last-fetched menu
  instead of an error, and that a previously-uncached menu still shows the
  normal "Couldn't load" message rather than crashing.
