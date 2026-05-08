import { beforeEach, describe, expect, it } from "vitest";
import {
  loadMode, saveMode,
  loadExplorePrefs, saveExplorePrefs,
  EXPLORE_DEFAULTS, EXPLORE_BUDGET_MIN, EXPLORE_BUDGET_MAX,
} from "./explorePrefs.js";

const MODE_KEY  = "walkpath:mode";
const PREFS_KEY = "walkpath:explorePrefs";

beforeEach(() => {
  localStorage.clear();
});

describe("loadMode / saveMode", () => {
  it("defaults to 'route' when nothing stored", () => {
    expect(loadMode()).toBe("route");
  });

  it("round-trips a valid mode", () => {
    saveMode("explore");
    expect(loadMode()).toBe("explore");
  });

  it("rejects an invalid stored mode value", () => {
    localStorage.setItem(MODE_KEY, "asteroid");
    expect(loadMode()).toBe("route");
  });

  it("ignores invalid values passed to saveMode", () => {
    saveMode("nonsense");
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });
});

describe("loadExplorePrefs", () => {
  it("returns a copy of defaults when nothing stored", () => {
    expect(loadExplorePrefs()).toEqual(EXPLORE_DEFAULTS);
  });

  it("rehydrates a previously saved valid object", () => {
    const next = {
      ...EXPLORE_DEFAULTS,
      maxMinutes: 30,
      selectedCategories: ["coffee_bakery"],
      selectedSubs:       ["medical/pharmacy"],
      showResidentialHeatmap: false,
    };
    saveExplorePrefs(next);
    expect(loadExplorePrefs()).toEqual(next);
  });

  it("falls back to defaults when the stored entry is corrupted JSON", () => {
    localStorage.setItem(PREFS_KEY, "not-json{{{");
    expect(loadExplorePrefs()).toEqual(EXPLORE_DEFAULTS);
  });

  it("falls back to defaults when stored entry is the wrong shape", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify("a string"));
    expect(loadExplorePrefs()).toEqual(EXPLORE_DEFAULTS);
  });

  it("clamps maxMinutes outside [5, 45]", () => {
    saveExplorePrefs({ ...EXPLORE_DEFAULTS, maxMinutes: 9999 });
    expect(loadExplorePrefs().maxMinutes).toBe(EXPLORE_BUDGET_MAX);
    saveExplorePrefs({ ...EXPLORE_DEFAULTS, maxMinutes: -3 });
    expect(loadExplorePrefs().maxMinutes).toBe(EXPLORE_BUDGET_MIN);
  });

  it("strips unknown category keys from selectedCategories", () => {
    saveExplorePrefs({
      ...EXPLORE_DEFAULTS,
      selectedCategories: ["coffee_bakery", "ufo_landings"],
    });
    expect(loadExplorePrefs().selectedCategories).toEqual(["coffee_bakery"]);
  });

  it("strips unknown sub keys from selectedSubs", () => {
    saveExplorePrefs({
      ...EXPLORE_DEFAULTS,
      selectedSubs: ["medical/pharmacy", "medical/zombies"],
    });
    expect(loadExplorePrefs().selectedSubs).toEqual(["medical/pharmacy"]);
  });

  it("falls back to default community area when the stored name isn't recognised", () => {
    saveExplorePrefs({
      ...EXPLORE_DEFAULTS,
      origin: { kind: "community_area", communityArea: "Atlantis" },
    });
    expect(loadExplorePrefs().origin).toEqual(EXPLORE_DEFAULTS.origin);
  });

  it("preserves a 'current' origin without lat/lon", () => {
    saveExplorePrefs({
      ...EXPLORE_DEFAULTS,
      origin: { kind: "current", communityArea: null },
    });
    expect(loadExplorePrefs().origin).toEqual({ kind: "current", communityArea: null });
  });
});
