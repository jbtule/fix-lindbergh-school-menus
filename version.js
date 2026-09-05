// Generated at deploy time by .github/workflows/deploy-pages.yml - see
// checkForUpdate() in app.js. This checked-in copy ("dead") is what local
// dev serves; it's meaningless there since checkForUpdate() only matters
// against a real deploy. Must stay hex-only (matching every other ?v=
// placeholder in this repo) - checkForUpdate()'s regex only captures
// [a-f0-9]+, so a non-hex placeholder like "dev" silently truncates to a
// partial match ("de") that never equals the untruncated constant,
// tricking every page load into thinking a new version just deployed and
// reloading itself forever.
const APP_VERSION = "dead";
