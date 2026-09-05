# Lindbergh School Menus (Unofficial)

**[jbtule.github.io/fix-lindbergh-school-menus](https://jbtule.github.io/fix-lindbergh-school-menus/)**
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
  `config.js`) vs. sides grouped by category, with **collapsible
  categories** (Vegetables/Fruits open by default, the rest collapsed) -
  a global, persisted preference
- **Allergen badges** per item (icon-only with tap/hover for the name by
  default; a full-text-label mode is a one-line flip in `app.js`),
  including derived **Vegetarian**/**Vegan** badges (vegan requires none
  of dairy/milk/egg on top of the vegetarian flag)
- A **"Dietary" picker** - peanut, tree nut, milk, fish, shellfish, egg,
  wheat, soy, sesame, each struck through when present, plus Vegetarian/
  Vegan, struck through when *absent* - that flags matching items and
  turns their allergen box red
- A small **print** icon next to each menu's heading, printing that menu
  one at a time as a clean category-by-day table - full detail (entrees,
  sides, allergens), skipping any category you've collapsed on screen -
  or a compact whole-month calendar (entree names only). Hidden when
  running as a home-screen app, since standalone mode can't open a print
  dialog
- Installable to a phone's home screen (manifest + icons), and
  auto-reloads itself when a new version is deployed
- Optional Google Translate widget, matching the language list seen on
  the district's own site - a one-line flip (`TRANSLATE_WIDGET_ENABLED`
  in `app.js`) to remove entirely. Printing gives an active translation a
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
just static files on GitHub Pages. `config.js` has the full story of how
each menu-type id was found, plus notes on data quirks encountered along
the way (a blank-category gap in their data, a stale duplicate menu-type
that got dropped, why high-school lunch's "food station" split is
best-effort only, etc.).

**This is not a published, supported integration.** The vendor could
change the API shape or lock down CORS at any time without notice, which
would break this site. It's provided for convenience only - always
double-check anything that actually matters, especially allergy or
dietary information, against the official source.

## For other districts

`schoolnutritionandfitness.com` is a multi-tenant platform - if your
district uses it too, this could plausibly be adapted. Every district is
scoped under its own GraphQL `organization(id: "<sid>")`; the `sid` and
individual menu-type ids in `config.js` would need to be rediscovered for
a new district by walking the same `organization` -> `site` -> `menuTypes`
chain documented there.

## Local development

The site itself is plain static files, loaded as ES modules - no build
step, no bundler.

```sh
python3 -m http.server 8934
```

Then open `http://localhost:8934/`.

There's a git pre-commit hook that stamps a content hash onto
`app.js`/`style.css`/`station-boundaries.js`/`version.js`'s references in
`index.html` (so GitHub Pages' CDN cache can't serve a stale version after
a deploy), and onto `config.js`/`menu-api.js`'s import specifiers inside
`app.js` (since those two are imported rather than script-tagged), and
writes the same combined hash to `version.js` (so a running page can
detect a new deploy and reload itself). It lives in `hooks/` rather than
`.git/hooks/` so it's version-controlled - activate it once per clone:

```sh
git config core.hooksPath hooks
```

## ical feeds

`menu-api.js` (the vendor fetch code) and `config.js` (the district's menu
tree) are shared with `scripts/build-ical.js`, a Node script that builds a
`.ics` calendar per menu - plus one per combination of Idea Center
day-variants (e.g. "Tuesdays + Thursdays") - into `dist/ical/`. A scheduled
GitHub Action (`.github/workflows/build-ical.yml`) runs it daily and
deploys the output to Cloudflare Pages. This part *does* need Node (≥18)
and its one dependency:

```sh
npm install
npm run build-ical
```

## License

MIT - see [LICENSE](LICENSE).
