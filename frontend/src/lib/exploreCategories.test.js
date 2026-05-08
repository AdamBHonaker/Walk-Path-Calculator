import { describe, it, expect } from "vitest";
import {
  EXPLORE_GROUPS,
  ALL_CATEGORIES,
  CATEGORY_BY_KEY,
  PIN_CATEGORIES,
  REQUESTABLE_CATEGORY_KEYS,
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
