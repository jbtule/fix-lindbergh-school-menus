// Station boundary hints for Lindbergh High lunch - OPTIONAL, SELF-CONTAINED.
//
// ---------------------------------------------------------------------------
// TO TURN THIS OFF: set STATION_BOUNDARY_HINTS_ENABLED to false below.
// Everything then falls back to groupEntreeRuns()'s own ordering heuristic in
// app.js and the app behaves exactly as it did before this file existed. To
// remove it entirely: delete this file, its <script> tag in index.html, the
// two marked fields in the GraphQL query in app.js, and the one marked block
// inside groupEntreeRuns().
// ---------------------------------------------------------------------------
//
// WHAT PROBLEM THIS SOLVES
//
// High school lunch is served from ~10 named food stations (Ballpark
// Classics, Taco Street, Panini Station, ...). The API has no field saying
// which station an item belongs to - the schema was checked exhaustively.
// groupEntreeRuns() therefore infers station boundaries from item order
// alone: a new station starts when an Entrees item follows one that already
// collected side items. That fails whenever two adjacent stations have no
// side item between them, which happens constantly - Panini Station and Red
// Dragon merged on all 21 school days of September 2026.
//
// This file supplies a boundary verdict for specific item pairs, derived from
// real ground truth, and groupEntreeRuns() consults it before falling back to
// its own rule.
//
// WHERE THE DATA CAME FROM (and why it can never be refreshed)
//
// The district's previous menu provider, Nutrislice, published month-long
// PDFs that DID show the station layout. One such PDF - Lindbergh High Lunch,
// September 2026 - was parsed into per-day station rosters and joined against
// this API's data for the same month. That gave 21 school days of ground
// truth covering ~10 stations each.
//
// Nutrislice has since been shut down. There will be no more PDFs. These
// tables are frozen at September 2026 and CANNOT be regenerated, extended, or
// re-validated. Treat them as a fixed historical artifact, not a live source.
//
// HOW IT WORKS
//
// For each adjacent pair of Entrees items (in the API's own order) we ask
// "is there a station boundary between these two?" and consult two tables in
// order, falling through to the ordering heuristic if neither has an opinion:
//
//  1. SKU_PAIR - keyed on the two items' providerProductID ("R809|R1085").
//     Exact, but only covers recipes seen in September.
//  2. CONCEPT_PAIR - keyed on a coarser "concept" parsed out of
//     product_fullname, plus whether sides sat between the pair
//     ("Panini|Red Dragon|0"). Generalizes to recipes never seen before,
//     because a new recipe usually reuses an existing concept.
//
// Both tables contain ONLY pairs whose verdict was unanimous across every
// occurrence in September. Pairs that disagreed with themselves were dropped
// rather than guessed - that is what keeps this from inventing boundaries the
// data does not support.
//
// THE CONCEPT FIELD
//
// product_fullname is free text the district maintains, shaped roughly as
// "<Concept>, <description...> - <portion>", e.g.
//   "Ballpark, Chicken, Tenders, Spicy, Breaded, w/Roll (2M,2G) - 3 Tenders"
//   "MWWM, Red Dragon, Chicken, Popcorn, Kung Pao (2M,1G) - 10 pieces"
// The concept is a kitchen recipe-family label, NOT a station name - one
// concept can feed several stations and one station can draw on several
// concepts. It is only useful as a boundary signal, never as a label.
// Three quirks are normalized below: "MWWM" is a wrapper prefix (the real
// concept is the token after it), a few spellings vary, and some recipes were
// entered with no concept at all (their first token is just the food name) -
// those return null so the table abstains rather than asserting.
//
// HOW WELL IT WORKS (measured leave-one-day-out over September 2026)
//
//   boundary decisions   89.4pct -> 98.8pct accurate, precision 100pct
//   whole station boxes  63pct   -> 90pct   exactly right
//
// Precision 100pct means it never split a station that should have stayed
// whole; it only finds boundaries the ordering heuristic missed.
//
// KNOWN LIMITS - none of these are bugs to fix
//
//  - Panini Station vs Luigi's Eatery stays wrong on some days. "Delicious
//    Cheese Pizza" is served by Panini on some days and Luigi's on others,
//    with identical SKU, identical concept and identical surrounding order.
//    Nothing in the API distinguishes those days. That single item accounts
//    for 19 of the 22 boxes still wrong.
//  - Accuracy will drift downward as the district edits menus, and nothing
//    will signal that it has. The numbers above are September 2026 only.
//  - Scoped to High Schools by stationHintsApplyTo() in this file, not by
//    the caller - see the note on STATION_MENU_GROUP below.

const STATION_BOUNDARY_HINTS_ENABLED = true;

// Both features below are high-school-only, and the guard lives here rather
// than at the call site on purpose. Every table in this file was derived
// solely from Lindbergh High lunch, so it is meaningless - and actively
// harmful - anywhere else: an elementary taco day carrying "Fresh Pico" would
// otherwise render a box labelled "Taco Street". Keeping the check next to
// the data it protects means a future caller cannot lose it by accident,
// which is exactly how it was lost once already.
const STATION_MENU_GROUP = "High Schools";

function stationHintsApplyTo(menuGroup) {
  return menuGroup === STATION_MENU_GROUP;
}

// product_fullname first-token fixups: spelling variants and a wrapper prefix.
const BOUNDARY_CONCEPT_ALIASES = {
  "AdobeGrill": "Adobe Grill",
  "Gourmet Greens Salad": "Gourmet Greens",
  "Traditional": "Traditional Cuisine",};

// First tokens that are not concepts at all - these recipes were entered
// without a concept prefix, so the token is just the food ("Cheese Stuffed
// Breadsticks", "Pizza"). Each labels exactly one recipe, so it carries no
// generalizing power; the SKU table already covers those items exactly.
const BOUNDARY_NON_CONCEPTS = new Set([
  "Beef",
  "Breadstick",
  "Cheese Stuffed Breadsticks",
  "Pizza",
  "Sandwich",
  "Sauce",]);

// Verdicts keyed "<providerProductID>|<providerProductID>". true = the two
// items sit in different stations. 159 unanimous pairs; 1 was dropped as
// self-contradictory ("Delicious Cheese Pizza" -> "Pretzel Rods w/Cheese
// Dip", see KNOWN LIMITS).
const BOUNDARY_SKU_PAIRS = {
  "IE001|R441": true,
  "IE003|R3125": true,
  "IE003|R3497": true,
  "R1021|R3175": true,
  "R1023|R1030": false,
  "R1027|R1021": false,
  "R1027|R1197": false,
  "R1030|R2516": true,
  "R1037|R898": false,
  "R1085|R2071": true,
  "R1085|R2375": true,
  "R10903|R2568": true,
  "R1115|R124": true,
  "R1115|R331": true,
  "R111|R2071": true,
  "R111|R4133": true,
  "R1195|R2777": false,
  "R1197|R3406": true,
  "R121|R3198": false,
  "R124|R1085": false,
  "R124|R2504": true,
  "R124|R3132": true,
  "R1254|R1532": false,
  "R1254|R2153": false,
  "R1254|R2884": false,
  "R1509|R525": true,
  "R1532|R2153": false,
  "R1532|R2568": true,
  "R1535|R111": true,
  "R1565|R224": false,
  "R1606|R213": false,
  "R1613|R1780": true,
  "R1613|R3166": true,
  "R1613|R3172": true,
  "R1614|R1616": false,
  "R1614|R2071": true,
  "R1616|IE003": false,
  "R1616|R213": false,
  "R1739|R2324": false,
  "R1780|R898": true,
  "R1875|IE003": false,
  "R1875|R194": false,
  "R1878|R2166": false,
  "R1879|R1614": false,
  "R194|R224": false,
  "R194|R2921": false,
  "R2071|R3497": false,
  "R2071|R3713": false,
  "R2071|R4133": false,
  "R2139|R3197": true,
  "R213|R1509": true,
  "R213|R287": false,
  "R213|R3168": true,
  "R213|R3170": true,
  "R213|R3497": true,
  "R213|R354": false,
  "R2153|R2884": false,
  "R2166|IE001": false,
  "R2166|R2071": true,
  "R2166|R213": true,
  "R2166|R2921": false,
  "R2166|R438": true,
  "R2166|R446": true,
  "R224|R2166": false,
  "R224|R2921": false,
  "R226|R194": false,
  "R2324|R1115": false,
  "R233|R1878": false,
  "R2375|R2327": false,
  "R2504|R1565": true,
  "R2516|R3126": false,
  "R2568|R124": true,
  "R2568|R2900": true,
  "R2568|R3085": true,
  "R2568|R3110": true,
  "R2568|R3126": true,
  "R2568|R353": true,
  "R2568|R374": true,
  "R2691|R1613": false,
  "R2691|R694": false,
  "R2760|R925": false,
  "R2777|R1115": false,
  "R287|R437": false,
  "R2884|R1532": false,
  "R2884|R2568": true,
  "R2884|R353": false,
  "R2884|R4133": false,
  "R2900|R3038": false,
  "R2921|R1614": true,
  "R2921|R1875": true,
  "R2921|R2166": false,
  "R2921|R437": true,
  "R2921|R441": true,
  "R2921|R442": true,
  "R2954|R1254": false,
  "R2954|R1875": false,
  "R2954|R4133": false,
  "R3016|R450": false,
  "R3038|R353": false,
  "R3085|R374": false,
  "R3110|R353": false,
  "R3120|R124": false,
  "R3125|R124": false,
  "R3126|R353": false,
  "R3132|R3129": false,
  "R3166|R1739": true,
  "R3170|R1195": true,
  "R3172|R2760": true,
  "R3175|R809": false,
  "R3197|R2327": false,
  "R3198|R1879": true,
  "R331|R2139": false,
  "R3406|R3124": false,
  "R342|R2954": false,
  "R342|R3497": false,
  "R342|R4133": false,
  "R3497|R1254": false,
  "R3497|R2071": false,
  "R3497|R2954": false,
  "R3497|R3713": false,
  "R3497|R4133": false,
  "R353|R10903": false,
  "R353|R194": true,
  "R353|R224": true,
  "R353|R233": true,
  "R353|R806": false,
  "R354|R1509": true,
  "R366|R213": false,
  "R369|R111": false,
  "R369|R2166": true,
  "R3700|R1613": false,
  "R3713|R342": false,
  "R374|R1875": true,
  "R374|R2954": true,
  "R374|R353": false,
  "R4133|R1254": false,
  "R4133|R1532": false,
  "R4133|R2071": false,
  "R4133|R2954": false,
  "R4133|R3497": false,
  "R4133|R3713": false,
  "R437|R2691": false,
  "R437|R592": true,
  "R438|R3700": false,
  "R441|R213": false,
  "R442|R1606": false,
  "R446|R1613": false,
  "R450|R2071": true,
  "R450|R3497": true,
  "R525|R1037": false,
  "R592|R898": true,
  "R694|R3016": true,
  "R806|R226": true,
  "R806|R2921": true,
  "R809|R1085": false,
  "R898|R1027": false,
  "R898|R124": true,
  "R898|R3120": true,
  "R925|R1616": true,};

// Verdicts keyed "<concept>|<concept>|<1 if sides sat between, else 0>".
// 40 unanimous transitions; 3 were dropped as self-contradictory (all of them
// led by "Ballpark", the one concept that spans seven different stations).
const BOUNDARY_CONCEPT_PAIRS = {
  "Adobe Grill|Adobe Grill|0": false,
  "Adobe Grill|Ballpark|1": true,
  "Adobe Grill|Delicatessen|1": true,
  "Adobe Grill|Panini|0": false,
  "Adobe Grill|Panini|1": true,
  "Adobe Grill|Traditional Cuisine|1": true,
  "Ballpark|Ballpark|1": true,
  "Ballpark|Delicatessen|0": false,
  "Ballpark|Gourmet Greens|1": true,
  "Ballpark|Luigi's|1": true,
  "Ballpark|Panini|0": false,
  "Ballpark|Panini|1": true,
  "Ballpark|Power Pack|0": false,
  "Ballpark|Red Dragon|0": true,
  "Brunch 4 Lunch|Ballpark|0": false,
  "Brunch 4 Lunch|Brunch 4 Lunch|0": false,
  "Brunch 4 Lunch|Gourmet Greens|0": false,
  "Brunch 4 Lunch|Power Pack|0": false,
  "Delicatessen|Ballpark|0": false,
  "Delicatessen|Brunch 4 Lunch|0": false,
  "Delicatessen|Delicatessen|0": false,
  "Delicatessen|Gourmet Greens|0": false,
  "Delicatessen|Panini|0": false,
  "Delicatessen|Power Pack|0": false,
  "Gourmet Greens|Delicatessen|0": false,
  "Gourmet Greens|Gourmet Greens|0": false,
  "Gourmet Greens|Power Pack|0": false,
  "Luigi's|Luigi's|0": false,
  "Luigi's|Luigi's|1": true,
  "Luigi's|Panini|0": false,
  "Panini|Adobe Grill|0": false,
  "Panini|Ballpark|0": false,
  "Panini|Gourmet Greens|0": true,
  "Panini|Panini|0": false,
  "Panini|Red Dragon|0": true,
  "Power Pack|Brunch 4 Lunch|0": false,
  "Red Dragon|Adobe Grill|1": true,
  "Red Dragon|Taco Street|1": true,
  "Taco Street|Adobe Grill|0": false,
  "Traditional Cuisine|Ballpark|0": false,};

// "Ballpark, Chicken, Tenders, ..." -> "Ballpark". Returns null when the
// product has no usable concept, which makes the caller abstain.
function boundaryConceptOf(product) {
  const full = (product && product.product_fullname) || "";
  if (!full) return null;
  const parts = full.split(",").map((s) => s.replace("INACTIVE", "").trim());
  // "MWWM" is a wrapper, not a concept - the real one follows it.
  let concept = parts[0] === "MWWM" && parts.length > 1 ? parts[1] : parts[0];
  concept = BOUNDARY_CONCEPT_ALIASES[concept] || concept;
  if (!concept || BOUNDARY_NON_CONCEPTS.has(concept)) return null;
  return concept;
}

// true  - these two entrees are in different stations (start a new box)
// false - same station (keep them together)
// null  - no opinion; the caller should use its own ordering heuristic.
function stationBoundaryHint(menuGroup, prevProduct, product, sidesBetween) {
  if (!STATION_BOUNDARY_HINTS_ENABLED) return null;
  if (!stationHintsApplyTo(menuGroup)) return null;
  if (!prevProduct || !product) return null;

  const skuKey = `${prevProduct.providerProductID}|${product.providerProductID}`;
  if (Object.prototype.hasOwnProperty.call(BOUNDARY_SKU_PAIRS, skuKey)) {
    return BOUNDARY_SKU_PAIRS[skuKey];
  }

  const a = boundaryConceptOf(prevProduct);
  const b = boundaryConceptOf(product);
  if (a && b) {
    const conceptKey = `${a}|${b}|${sidesBetween ? 1 : 0}`;
    if (Object.prototype.hasOwnProperty.call(BOUNDARY_CONCEPT_PAIRS, conceptKey)) {
      return BOUNDARY_CONCEPT_PAIRS[conceptKey];
    }
  }
  return null;
}


// ===========================================================================
// PART 2 - STATION NAMES (independent of the boundary hints above)
//
// TO TURN THIS OFF: set STATION_NAMES_ENABLED to false. Boxes then render
// with the generic "Entree" label exactly as before. This is a SEPARATE
// switch from STATION_BOUNDARY_HINTS_ENABLED - either part can run without
// the other.
//
// Names about half the boxes on a high-school lunch day and leaves the rest
// generic. It never guesses: a box is named only when the evidence points at
// exactly one station, so an unnamed box is the expected outcome, not a bug.
//
// EVIDENCE, in the order it is combined
//
//  1. A "pure" concept on one of the box's entrees - a product_fullname
//     concept that mapped to exactly one station across all of September
//     (see the concept notes in PART 1). Only 5 qualify; "Ballpark" and
//     "Luigi's" span too many stations to be usable.
//  2. A "pure" side item in the box - Red Dragon's fortune cookie, Taco
//     Street's jalapenos, Luigi's parmesan. 24 qualify.
//  3. One positional rule: a box sitting between a box named Luigi's Eatery
//     and one named Red Dragon is Panini Station. True on all 21 days of
//     September, and it is the ONLY way Panini Station ever gets named - it
//     has no distinctive concept and no distinctive side of its own.
//
// If steps 1-2 turn up evidence for more than one station, the box is left
// unnamed rather than picking a winner.
//
// WHY THE SIDE TABLE IS KEYED THE WAY IT IS
//
// Side evidence is calibrated on where a side lands in the API's own item
// ORDER, not on which box the source PDF drew it in. Those disagree: the PDF
// prints "Shredded Lettuce, Tomato Slices & Pickles" inside the Classic
// Stacks box, but in API order it follows Panini Station's entrees. Building
// the table the PDF's way mislabelled 5 boxes; rebuilding it positionally,
// the way this code actually sees the data at runtime, removed all 5 and
// increased coverage at the same time.
//
// Entries also need at least 5 observations. Without that floor, thinly
// attested sides like "Light Italian Dressing" (4 sightings at one station,
// 1 at another) look pure and mislabel a box.
//
// HOW WELL IT WORKS (leave-one-day-out over September 2026, scored against
// the boxes this app actually produces, so a merged box counts as a failure)
//
//   126 of 224 boxes named (56%), 0 named incorrectly
//
// Stations named every day: Bento Box, Build Your Own Classic Stacks,
// Luigi's Eatery, Panini Station, Red Dragon, Taco Street. Traditional
// Cuisine some days. Ballpark Classics, Bella Cibo and Little Italy are
// never named - no pure concept, no distinctive side. Leaving them generic
// is deliberate.
//
// SAME FROZEN-DATA CAVEAT AS PART 1 - September 2026 only, cannot be
// re-derived, will drift silently as the district edits menus.
// ===========================================================================

const STATION_NAMES_ENABLED = true;

// concept (already normalized by boundaryConceptOf) -> station
const STATION_NAME_BY_CONCEPT = {
  "Brunch 4 Lunch": "Bento Box",
  "Gourmet Greens": "Bento Box",
  "Power Pack": "Bento Box",
  "Red Dragon": "Red Dragon",
  "Traditional Cuisine": "Traditional Cuisine",};

// lowercased, whitespace-collapsed side item name -> station
const STATION_NAME_BY_SIDE = {
  "black olives": "Taco Street",
  "classic hamburger bun": "Bento Box",
  "creamy ranch dressing": "Build Your Own Classic Stacks",
  "fortune cookie": "Red Dragon",
  "fresh diced tomatoes": "Taco Street",
  "fresh pico": "Taco Street",
  "fresh red onions": "Build Your Own Classic Stacks",
  "fresh shredded lettuce": "Taco Street",
  "fresh sliced tomatoes": "Build Your Own Classic Stacks",
  "homemade burger spread": "Build Your Own Classic Stacks",
  "light sour cream": "Taco Street",
  "mexican style corn on the cob": "Taco Street",
  "parmesan cheese bulk": "Luigi's Eatery",
  "picante salsa": "Taco Street",
  "roasted teriyaki broccoli": "Red Dragon",
  "sauteed red peppers & onions": "Taco Street",
  "sliced american cheese": "Build Your Own Classic Stacks",
  "sliced banana peppers": "Build Your Own Classic Stacks",
  "sliced dill pickles": "Build Your Own Classic Stacks",
  "sliced jalapenos": "Taco Street",
  "spicy chili garlic lo mein": "Red Dragon",
  "spicy red pepper flakes": "Luigi's Eatery",
  "tangy lomein noodles": "Red Dragon",
  "veggie fried rice": "Red Dragon",};

function stationNameKey(name) {
  return String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
}

// menuGroup: info.group for the menu being rendered - anything other than
// "High Schools" yields all-null (see STATION_MENU_GROUP).
// groups: the array groupEntreeRuns() returns, [{entrees, sides}, ...].
// Returns an array of the same length holding a station name or null.
function stationNamesFor(menuGroup, groups) {
  const names = groups.map(() => null);
  if (!STATION_NAMES_ENABLED) return names;
  if (!stationHintsApplyTo(menuGroup)) return names;

  groups.forEach((group, i) => {
    const found = new Set();
    for (const it of group.entrees || []) {
      const concept = boundaryConceptOf(it.product);
      if (concept && STATION_NAME_BY_CONCEPT[concept]) found.add(STATION_NAME_BY_CONCEPT[concept]);
    }
    for (const it of group.sides || []) {
      const key = stationNameKey(it.product && it.product.name);
      if (STATION_NAME_BY_SIDE[key]) found.add(STATION_NAME_BY_SIDE[key]);
    }
    // Conflicting evidence means the box probably spans two stations - say
    // nothing rather than pick one.
    if (found.size === 1) names[i] = [...found][0];
  });

  // Positional rule, applied after the evidence pass so it can lean on it.
  for (let i = 1; i < names.length - 1; i++) {
    if (names[i] === null && names[i - 1] === "Luigi's Eatery" && names[i + 1] === "Red Dragon") {
      names[i] = "Panini Station";
    }
  }
  return names;
}
