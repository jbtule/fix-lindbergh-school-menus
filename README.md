# Lindbergh School Menus (Unofficial)

**[tools.tuley.name/fix-lindbergh-school-menus](https://tools.tuley.name/fix-lindbergh-school-menus/)**
· built with [Claude Code](https://claude.com/claude-code)

A static, mobile-friendly menu viewer for Lindbergh School District (Missouri),
built because the district's official menu site is slow and hard to use day
to day. **This is not built, run, or endorsed by Lindbergh School District** -
it's a parent's side project that calls the same public menu API the
official site uses, just reformatted. See the in-app disclaimer for details,
and the "How it works" section below for exactly what that means and why it
could stop working at any time.

## Features

- **Multi-select menu picker** across every school level (Elementary,
  Middle, High, Pre-K), remembered across visits - selected menus lay
  out side by side on a wide enough screen instead of always stacking
- **Day view** (default) or **Week view** (Mon-Fri, horizontally
  scrollable, all selected menus scroll in sync), toggle remembered
- Defaults to today - or tomorrow after 4pm, once the current day's menu
  isn't useful anymore
- **Idea Center** menus split into Full Week plus one option per grade's
  day (attendance there is grade-specific, one day a week). Selecting
  several for the same meal combines them into one section instead of
  duplicating it - e.g. Full Week plus a specific grade's day shows every
  day, with that grade's badge only on their day, not all of them
- Each day's items split into a clear **Entree** choice (or several, for
  high school lunch's food-station format - see the caveat in
  `src/config.js`) vs. sides grouped by category, with **collapsible
  categories** (Vegetables/Fruits open by default, the rest collapsed) -
  a global, persisted preference. Flyers Club and ECE's Snack menu get the
  same treatment under a **Snack** label instead, since their real food is
  the whole meal, not a side (milk, condiments, and juice still stay
  ordinary sides - see `SNACK_MEAL_NAMES`/`isSnackSideItem()` in
  `src/config.js`)
- **Allergen badges** per item (icon-only with tap/hover for the name by
  default; a full-text-label mode is a one-line flip in `src/app.js`),
  including derived **Vegetarian**/**Vegan** badges (vegan requires none
  of dairy/milk/egg on top of the vegetarian flag)
- A **"Dietary" picker** - peanut, tree nut, milk, fish, shellfish, egg,
  wheat, soy, sesame, each struck through when present, plus Vegetarian/
  Vegan, struck through when *absent* - that flags matching items and
  turns their allergen box red
- Knows real **no-school days** (holidays, in-service days, etc.) from the
  district's own event calendar, and shows that specific school's own
  wording for it where available - rather than a generic "no menu" for
  every day nothing's published
- Each menu's heading has an **Actions** menu (⋯) with:
  - **Print** - that menu alone as a clean category-by-day table (full
    detail: entrees, sides, allergens, skipping anything collapsed on
    screen) or a compact whole-month calendar (entree names only). Hidden
    when running as a home-screen app, since standalone mode can't open a
    print dialog
  - **Subscribe** - adds that menu as a live calendar in Apple Calendar,
    Google Calendar, or Outlook, so it shows up alongside the rest of a
    family's schedule and updates on its own (see "ical feeds" below)
- **Installable** to a phone's home screen (manifest + icons) - a subtle
  "Install" hint on mobile prompts a real one-tap install where the
  browser supports it, or walks through the manual Add to Home Screen
  steps on iOS Safari, which doesn't. Auto-reloads itself when a new
  version is deployed
- **Works offline, and skips the loading flash on repeat visits**: every
  fetched menu, and the no-school calendar, is cached to `localStorage`.
  A menu that's been viewed before paints instantly from that cache while
  the live data loads quietly in the background (repainting only if
  something changed); if the network fails entirely, the last-fetched
  version keeps showing instead of an error (see `src/menu-api.js`)
- Optional Google Translate widget, matching the language list seen on
  the district's own site - a one-line flip (`TRANSLATE_WIDGET_ENABLED`
  in `src/app.js`) to remove entirely. Printing gives an active translation a
  real chance to apply to the print content before printing (a brief
  on-screen "Preparing translated print..." moment), rather than always
  printing in English

## How it works

The district's real menu site (`schoolnutritionandfitness.com`) is an
Angular/React SPA built by a third-party vendor (looks like iSite
Software) - Lindbergh is a customer of it, not the operator. Digging
through its JS bundles turned up:

- A GraphQL API (`api.schoolnutritionandfitness.com/graphql`) that
  returns the actual menu items for a given document id
- A REST API (`.../webmenus2/api/menutypeController.php`) that resolves
  a menu-type + month to the right document id

Both have wide-open CORS (they reflect whatever `Origin` calls them), so
this site calls them directly from the browser - no backend, no API key,
just static files on GitHub Pages. `src/config.js` has the full story of
how each menu-type id was found, plus notes on data quirks encountered
along the way (a blank-category gap in their data, a stale duplicate
menu-type that got dropped, why high-school lunch's "food station" split
is best-effort only, etc.).

Neither menu API has a holiday/day-off flag, so knowing an empty day is a
real no-school day (rather than just nothing published yet) comes from a
third source: the district's own event calendar
(`www.lindberghschools.ws`, a separate Finalsite-CMS-backed site).
Unlike the menu APIs, that one has no CORS headers at all, so it can't be
fetched from the browser directly - the daily ical-building cron (see
"ical feeds" below) fetches it server-side instead and publishes a small
same-origin JSON summary the app reads back.

**This is not a published, supported integration.** The vendor could
change the API shape or lock down CORS at any time without notice, which
would break this site. It's provided for convenience only - always
double-check anything that actually matters, especially allergy or
dietary information, against the official source.

## For other districts

`schoolnutritionandfitness.com` is a multi-tenant platform - if your
district uses it too, this could plausibly be adapted. Every district is
scoped under its own GraphQL `organization(id: "<sid>")`; the `sid` and
individual menu-type ids in `src/config.js` would need to be rediscovered for
a new district by walking the same `organization` -> `site` -> `menuTypes`
chain documented there.

## Local development

The site itself is plain static files, loaded as ES modules - no build
step, no bundler.

```sh
python3 -m http.server 8934
```

Then open `http://localhost:8934/`. Every `?v=dead` you'll see in the source
is a placeholder - real cache-busting hashes and `version.js`'s content are
generated at deploy time (see `.github/workflows/deploy-pages.yml`), not
something to worry about locally.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy-pages.yml`, which
stages the site's files, fills in the footer's commit-SHA badge and the
`?v=` cache-busting hashes/`version.js` (both placeholders in the
committed source - see above), and deploys to GitHub Pages. Requires the
repo's Settings -> Pages -> Build and deployment -> Source to be set to
"GitHub Actions" (one-time).

## ical feeds

`src/menu-api.js` (the vendor fetch code) and `src/config.js` (the district's menu
tree) are shared with `scripts/build-ical.js`, a Node script that builds a
`.ics` calendar per menu - plus one per combination of Idea Center
day-variants (e.g. "Tuesdays + Thursdays") - into `dist/ical/`, along with
`no-school-days.json` (see "How it works" above). Each event's
description lists the day's entree(s) with allergens, then every side
bulleted underneath; Flyers Club/ECE Snack get the same Entree-level
treatment the app gives them on screen, rather than being listed as
sides. A scheduled GitHub Action (`.github/workflows/build-ical.yml`)
runs it daily and deploys the output to Cloudflare Pages at
`lindbergh-school-menus-unofficial.asset-data.stream`, which is what the
app's Subscribe feature links to (see `ICAL_BASE_URL` in `src/config.js`).
This part *does* need Node (≥18) and its one dependency:

```sh
npm install
npm run build-ical
```

To deploy the built calendars outside the scheduled cron (rare - the
daily run already keeps them current):

```sh
npx wrangler pages deploy dist/ical --project-name=lindbergh-school-menus-unofficial
```

## License

MIT - see [LICENSE](LICENSE).
