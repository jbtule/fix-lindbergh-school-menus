// Unit tests for scripts/status-page.js - the per-menu status table the
// README badges link to. Pure string rendering, no network - run with
// `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStatusPage } from "../scripts/status-page.js";

const generatedAt = new Date("2026-10-03T15:00:00Z");

test("one row per menu, with formatted dates", () => {
  const html = renderStatusPage(
    [
      { name: "ECE - Lunch", lastDate: "2026-11-20", updatedAt: 1790703120 },
      { name: "Idea Center Lunch", lastDate: "2026-10-29", updatedAt: 1789653412 },
    ],
    generatedAt,
  );
  assert.equal((html.match(/<tr>/g) || []).length, 3); // header + 2 menus
  assert.match(html, /ECE - Lunch/);
  assert.match(html, /Fri, Nov 20, 2026/);
  assert.match(html, /<time datetime="2026-09-29T17:32:00.000Z">Sep 29, 2026, 12:32 PM CDT<\/time>/);
  assert.match(html, /Checked Oct 3, 2026, 10:00 AM CDT/);
});

test("a menu with no data shows a dash instead of a date", () => {
  const html = renderStatusPage([{ name: "ECE - Snack", lastDate: null, updatedAt: null }], generatedAt);
  assert.equal((html.match(/&mdash;<\/td>/g) || []).length, 2);
});

test("menu names are HTML-escaped", () => {
  const html = renderStatusPage([{ name: "A & <b>B</b>", lastDate: null, updatedAt: null }], generatedAt);
  assert.match(html, /A &amp; &lt;b&gt;B&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>B<\/b>/);
});
