// Unit tests for the pure grouping/ordering/category logic in
// src/menu-logic.js and src/config.js - the layer responsible for most of
// the rendering bugs found this session (a day with no Entrees-category
// item silently losing all its items, the Snack/juice/milk category edge
// cases, category display order). No DOM, no network, no fixtures beyond
// small hand-built item arrays shaped like the real API response - run
// with `npm test`.
//
// These deliberately don't cover src/app.js itself (HTML string building,
// DOM rendering, state/localStorage) or the live vendor API - see
// test/manual/ for scripts that exercise those against a running dev
// server and the real API by hand.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  splitEntreesAndSides,
  groupEntreeRuns,
  orderSideCategories,
  SIDE_CATEGORY_ORDER,
} from "../src/menu-logic.js";
import { SNACK_MEAL_NAMES, isSnackSideItem } from "../src/config.js";

// A minimal stand-in for one API item - just enough shape for the logic
// under test (day/allergen fields are irrelevant here).
function item(name, category) {
  return { day: 1, product: { name, category } };
}

describe("splitEntreesAndSides", () => {
  test("regular menu: splits by category", () => {
    const items = [item("Grilled Cheese", "Entrees"), item("Green Beans", "Vegetable"), item("Milk", "Milk")];
    const groups = splitEntreesAndSides("Lunch", items);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].entrees.map((i) => i.product.name), ["Grilled Cheese"]);
    assert.deepEqual(
      groups[0].sides.map((i) => i.product.name),
      ["Green Beans", "Milk"]
    );
  });

  test("regular menu: no items at all returns no groups", () => {
    assert.deepEqual(splitEntreesAndSides("Lunch", []), []);
  });

  test("regular menu, sides-only day: kept as one entree-less group, not dropped", () => {
    // The exact shape of the original bug: a day with real items but none
    // categorized "Entrees" used to vanish entirely instead of showing its
    // sides. Not a Snack-menu name, so this exercises the non-snack path.
    const items = [item("Fruit Cup", "Fruit"), item("Milk", "Milk")];
    const groups = splitEntreesAndSides("Lunch", items);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].entrees, []);
    assert.deepEqual(
      groups[0].sides.map((i) => i.product.name),
      ["Fruit Cup", "Milk"]
    );
  });

  test("Flyers Club: a single Grain item counts as the entree", () => {
    const items = [item("Chocolate Scooby-Doo", "Grain")];
    const groups = splitEntreesAndSides("Flyers Club", items);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].entrees.map((i) => i.product.name), ["Chocolate Scooby-Doo"]);
    assert.deepEqual(groups[0].sides, []);
  });

  test("ECE Snack: real food is the entree, milk/condiment/juice stay sides", () => {
    const items = [
      item("Fresh Broccoli Florets", "Vegetable"),
      item("1% Low Fat White Milk Local", "Milk"),
      item("Creamy Ranch Dressing", "Condiment"),
      item("100% Fruit Punch Juice", "Fruit"),
    ];
    const groups = splitEntreesAndSides("Snack", items);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].entrees.map((i) => i.product.name), ["Fresh Broccoli Florets"]);
    assert.deepEqual(groups[0].sides.map((i) => i.product.name), [
      "1% Low Fat White Milk Local",
      "Creamy Ranch Dressing",
      "100% Fruit Punch Juice",
    ]);
  });

  test("ECE Snack: real solid fruit (not juice) still counts as the entree", () => {
    const items = [item("Fresh Orange Slices", "Fruit"), item("1% Low Fat White Milk Local", "Milk")];
    const groups = splitEntreesAndSides("Snack", items);
    assert.deepEqual(groups[0].entrees.map((i) => i.product.name), ["Fresh Orange Slices"]);
    assert.deepEqual(groups[0].sides.map((i) => i.product.name), ["1% Low Fat White Milk Local"]);
  });
});

describe("groupEntreeRuns (High School station splitting)", () => {
  test("no Shared Items marker, no side between two entrees: one group", () => {
    const items = [item("Burger", "Entrees"), item("Pizza", "Entrees"), item("Fries", "Vegetable")];
    const { groups, commonSides } = groupEntreeRuns(items, "High Schools");
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].entrees.map((i) => i.product.name), ["Burger", "Pizza"]);
    assert.deepEqual(groups[0].sides.map((i) => i.product.name), ["Fries"]);
    assert.deepEqual(commonSides, []);
  });

  test("a side between two entrees starts a new station group", () => {
    const items = [
      item("Burger", "Entrees"),
      item("Fries", "Vegetable"),
      item("Pizza", "Entrees"),
      item("Salad", "Vegetable"),
    ];
    const { groups } = groupEntreeRuns(items, "High Schools");
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].entrees.map((i) => i.product.name), ["Burger"]);
    assert.deepEqual(groups[0].sides.map((i) => i.product.name), ["Fries"]);
    assert.deepEqual(groups[1].entrees.map((i) => i.product.name), ["Pizza"]);
    assert.deepEqual(groups[1].sides.map((i) => i.product.name), ["Salad"]);
  });

  test("Shared Items marker splits off commonSides from the last station", () => {
    const items = [
      item("Burger", "Entrees"),
      item("Fries", "Vegetable"),
      item("Shared Items", "Ancillary"),
      item("Milk", "Milk"),
      item("Ketchup", "Condiment"),
    ];
    const { groups, commonSides } = groupEntreeRuns(items, "High Schools");
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].sides.map((i) => i.product.name), ["Fries"]);
    assert.deepEqual(commonSides.map((i) => i.product.name), ["Milk", "Ketchup"]);
  });

  test("no Entrees-category item at all: one sides-only group, not dropped", () => {
    // Same bug class as splitEntreesAndSides()'s sides-only case, guarded
    // independently here since groupEntreeRuns() is a separate code path.
    const items = [item("Fruit Cup", "Fruit")];
    const { groups, commonSides } = groupEntreeRuns(items, "High Schools");
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].entrees, []);
    assert.deepEqual(groups[0].sides.map((i) => i.product.name), ["Fruit Cup"]);
    assert.deepEqual(commonSides, []);
  });

  test("no items at all: no groups", () => {
    assert.deepEqual(groupEntreeRuns([], "High Schools"), { groups: [], commonSides: [] });
  });
});

describe("orderSideCategories", () => {
  test("known categories sort in SIDE_CATEGORY_ORDER, regardless of input order", () => {
    const shuffled = ["Milk", "Grain", "Condiment", "Fruit", "Vegetable"];
    assert.deepEqual(orderSideCategories(shuffled), SIDE_CATEGORY_ORDER);
  });

  test("Grain sorts before Milk/Condiment", () => {
    const ordered = orderSideCategories(["Condiment", "Milk", "Grain"]);
    assert.ok(ordered.indexOf("Grain") < ordered.indexOf("Milk"));
    assert.ok(ordered.indexOf("Grain") < ordered.indexOf("Condiment"));
  });

  test("unknown categories sort after known ones, in encounter order", () => {
    const ordered = orderSideCategories(["Mystery B", "Vegetable", "Mystery A"]);
    assert.deepEqual(ordered, ["Vegetable", "Mystery B", "Mystery A"]);
  });

  test("empty input", () => {
    assert.deepEqual(orderSideCategories([]), []);
  });
});

describe("isSnackSideItem / SNACK_MEAL_NAMES", () => {
  test("Flyers Club and Snack are the only snack-treated menu names", () => {
    assert.ok(SNACK_MEAL_NAMES.has("Flyers Club"));
    assert.ok(SNACK_MEAL_NAMES.has("Snack"));
    assert.ok(!SNACK_MEAL_NAMES.has("Lunch"));
    assert.ok(!SNACK_MEAL_NAMES.has("Breakfast"));
  });

  test("Milk and Condiment categories are excluded", () => {
    assert.ok(isSnackSideItem({ name: "1% Low Fat White Milk Local", category: "Milk" }));
    assert.ok(isSnackSideItem({ name: "Creamy Ranch Dressing", category: "Condiment" }));
  });

  test("juice is excluded by name, despite sharing the Fruit category with real fruit", () => {
    assert.ok(isSnackSideItem({ name: "100% Fruit Punch Juice", category: "Fruit" }));
    assert.ok(isSnackSideItem({ name: "100% Orange Juice", category: "Fruit" }));
    assert.ok(!isSnackSideItem({ name: "Fresh Orange Slices", category: "Fruit" }));
    assert.ok(!isSnackSideItem({ name: "Sweet Diced Peaches", category: "Fruit" }));
  });

  test("real food (Grain/Vegetable/Entrees/etc.) is never excluded", () => {
    assert.ok(!isSnackSideItem({ name: "Chocolate Scooby-Doo", category: "Grain" }));
    assert.ok(!isSnackSideItem({ name: "Fresh Broccoli Florets", category: "Vegetable" }));
    assert.ok(!isSnackSideItem({ name: "Delicious Blueberry Muffin", category: "Entrees" }));
  });
});
