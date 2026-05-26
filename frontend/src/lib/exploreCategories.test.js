import { describe, it, expect } from "vitest";
import {
  EXPLORE_GROUPS,
  ALL_CATEGORIES,
  CATEGORY_BY_KEY,
  PIN_CATEGORIES,
  REQUESTABLE_CATEGORY_KEYS,
  filterPlacesByVisibleCategories,
} from "./exploreCategories.js";

describe("exploreCategories — structural integrity", () => {
  it("every group has a unique key", () => {
    const keys = EXPLORE_GROUPS.map(g => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every category has a unique key across all groups", () => {
    const keys = ALL_CATEGORIES.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("CATEGORY_BY_KEY contains every category", () => {
    expect(Object.keys(CATEGORY_BY_KEY).length).toBe(ALL_CATEGORIES.length);
    for (const c of ALL_CATEGORIES) {
      expect(CATEGORY_BY_KEY[c.key]).toBe(c);
    }
  });

  it("every non-heatmap category exposes a label, color, and glyph", () => {
    for (const c of PIN_CATEGORIES) {
      expect(typeof c.label).toBe("string");
      expect(c.label.length).toBeGreaterThan(0);
      expect(typeof c.color).toBe("string");
      expect(typeof c.glyph).toBe("string");
      expect(c.glyph.length).toBeGreaterThan(0);
    }
  });

  it("residential category is heatmapOnly with a null glyph", () => {
    const residential = CATEGORY_BY_KEY.residential;
    expect(residential).toBeDefined();
    expect(residential.heatmapOnly).toBe(true);
    expect(residential.glyph).toBeNull();
  });

  it("REQUESTABLE_CATEGORY_KEYS excludes heatmap-only categories", () => {
    expect(REQUESTABLE_CATEGORY_KEYS).not.toContain("residential");
    expect(REQUESTABLE_CATEGORY_KEYS.length).toBe(PIN_CATEGORIES.length);
  });

  it("subcategories on every category have unique keys within their parent", () => {
    for (const c of ALL_CATEGORIES) {
      if (!c.subs) continue;
      const subKeys = c.subs.map(s => s.key);
      expect(new Set(subKeys).size).toBe(subKeys.length);
    }
  });
});

describe("filterPlacesByVisibleCategories", () => {
  const library    = { category: "libraries",    subcategory: null,         lat: 41.95, lon: -87.65, name: "Branch A" };
  const pharmacy   = { category: "medical",      subcategory: "pharmacy",   lat: 41.95, lon: -87.65, name: "Pharm" };
  const hospital   = { category: "medical",      subcategory: "hospital",   lat: 41.95, lon: -87.65, name: "Hosp" };
  const urgentCare = { category: "medical",      subcategory: "urgent_care",lat: 41.95, lon: -87.65, name: "UC" };
  const cafe       = { category: "coffee_bakery",subcategory: "cafe",       lat: 41.95, lon: -87.65, name: "Cafe" };
  const noCoords   = { category: "libraries",    subcategory: null,         name: "No coords" };

  it("returns [] when places is not an array", () => {
    expect(filterPlacesByVisibleCategories(null, new Set(["libraries"]))).toEqual([]);
    expect(filterPlacesByVisibleCategories(undefined, new Set())).toEqual([]);
  });

  it("drops places without valid lat/lon even with null activeSubs", () => {
    expect(filterPlacesByVisibleCategories([library, noCoords], null)).toEqual([library]);
  });

  it("null activeSubs returns every place with valid coords (legacy debug path)", () => {
    const out = filterPlacesByVisibleCategories([library, pharmacy, hospital], null);
    expect(out).toEqual([library, pharmacy, hospital]);
  });

  it("keeps a null-sub place when its parent category is in activeSubs", () => {
    const out = filterPlacesByVisibleCategories([library], new Set(["libraries"]));
    expect(out).toEqual([library]);
  });

  it("narrows medical to just pharmacies when only the sub is selected", () => {
    const out = filterPlacesByVisibleCategories(
      [pharmacy, hospital, urgentCare],
      new Set(["medical/pharmacy"]),
    );
    expect(out).toEqual([pharmacy]);
  });

  it("keeps both bare-parent matches and composite-sub matches when both are active", () => {
    const out = filterPlacesByVisibleCategories(
      [pharmacy, hospital, cafe],
      new Set(["medical", "coffee_bakery/cafe"]),
    );
    expect(out).toEqual([pharmacy, hospital, cafe]);
  });

  it("preserves null-sub curated places when a sibling sub of their parent is selected", () => {
    // Defensive: if a future category mixes curated null-sub entries with
    // selectable subs, the null-sub entries should still surface alongside
    // the user's specific sub pick.
    const curatedLibrary = { ...library };
    const subLibrary     = { category: "libraries", subcategory: "research", lat: 41.95, lon: -87.65, name: "Research" };
    const out = filterPlacesByVisibleCategories(
      [curatedLibrary, subLibrary],
      new Set(["libraries/research"]),
    );
    expect(out).toEqual([curatedLibrary, subLibrary]);
  });

  it("does not leak null-sub places across categories", () => {
    // A medical/pharmacy selection must NOT keep a libraries (null-sub) place.
    const out = filterPlacesByVisibleCategories(
      [library, pharmacy],
      new Set(["medical/pharmacy"]),
    );
    expect(out).toEqual([pharmacy]);
  });
});
