// Rewrites the menu badges between the <!-- menu-badges --> markers in
// README.md. Run by the build-ical workflow after a successful build; the
// workflow commits README.md only if this actually changed it.
//
// Two badges: how far ahead menus are posted (from
// dist/ical/coverage.json, written by build-ical.js), and the month the
// build last ran. The second one changes every month even when no new menus
// are posted (summer), which guarantees a commit at least monthly - GitHub
// disables scheduled workflows in public repos after 60 days without
// repository activity.
//
// Usage: node scripts/update-readme-badges.js [coverage.json]
import { readFile, writeFile } from "node:fs/promises";
import { ICAL_BASE_URL } from "../src/config.js";

const README = new URL("../README.md", import.meta.url);
// Per-menu table published next to the .ics feeds (scripts/status-page.js).
const STATUS_URL = `${ICAL_BASE_URL}/status`;
const START = "<!-- menu-badges:start -->";
const END = "<!-- menu-badges:end -->";

const coveragePath = process.argv[2] ?? new URL("../dist/ical/coverage.json", import.meta.url);
const { latestMonth } = JSON.parse(await readFile(coveragePath, "utf8"));
if (!/^\d{4}-\d{2}$/.test(latestMonth)) throw new Error(`Bad latestMonth: ${JSON.stringify(latestMonth)}`);

// "2026-11" -> "November 2026"; shields.io static badges use "_" for spaces
// and "--" for a literal "-".
function monthName(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
const badgeText = (s) => encodeURIComponent(s.replaceAll("-", "--").replaceAll(" ", "_"));
const badge = (label, message, color) =>
  `[![${label}: ${message}](https://img.shields.io/badge/${badgeText(label)}-${badgeText(message)}-${color})](${STATUS_URL})`;

const checked = new Date().toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "America/Chicago" });
const block = [
  START,
  badge("menus through", monthName(latestMonth), "2e7d32"),
  badge("checked", checked, "lightgrey"),
  END,
].join("\n");

const readme = await readFile(README, "utf8");
const pattern = new RegExp(`${START}[\\s\\S]*?${END}`);
if (!pattern.test(readme)) throw new Error(`README.md is missing the ${START} ... ${END} markers`);
const updated = readme.replace(pattern, block);
if (updated !== readme) {
  await writeFile(README, updated);
  console.log("Updated README badges");
} else {
  console.log("README badges already current");
}
