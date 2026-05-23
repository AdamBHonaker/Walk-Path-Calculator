// Persisted prefs for the Neighborhood Explorer.
//
// Three scopes:
//   - mode:     "route" | "explore" — which top-level mode the user is in.
//               Persists so a returning visitor sees what they last used.
//   - prefs:    selectedGroups / selectedCategories / selectedSubs / origin
//               choice / community area / max_minutes — the explorer's
//               complete input state minus transient result data.
//   - residential heatmap toggle — separate so it can default ON without
//     dragging the rest of the prefs into a brand-new shape.
//
// Storage keys keep the legacy `walkpath:` prefix per CLAUDE.md to avoid
// orphaning anyone who already has prefs from earlier builds.

import { loadJSON, safeGet, safeSet, saveJSON } from "./storage.js";
import { COMMUNITY_AREA_NAMES } from "./communityAreas.js";
import { ALL_CATEGORIES, EXPLORE_GROUPS } from "./exploreCategories.js";

const MODE_KEY  = "walkpath:mode";
const PREFS_KEY = "walkpath:explorePrefs";

const VALID_MODES = new Set(["route", "explore"]);
const VALID_ORIGIN_KINDS = new Set(["current", "community_area"]);

const MAX_MINUTES_MIN = 5;
const MAX_MINUTES_MAX = 45;

const DEFAULT_PREFS = {
  origin: { kind: "community_area", communityArea: "Loop" },
  maxMinutes: 20,
  // Groups expanded by default — `outdoors` is included so the pre-checked
  // `parks` default is visible without a click. The user's expansion state
  // is remembered after their first interaction.
  expandedGroups: ["food_drink", "daily_life", "outdoors", "public_services"],
  selectedCategories: ["libraries", "parks"],
  selectedSubs: [],
  showResidentialHeatmap: true,
  // CPD park footprint heatmap. Defaults off — additive to existing
  // residential overlay, and a fresh user shouldn't see two heatmaps at
  // once.
  showParksHeatmap: false,
  // OSM-derived tree canopy density (three opacity bands). Defaults off
  // per spec — existing users shouldn't see a new overlay they didn't
  // opt into.
  showTreeCanopyHeatmap: false,
  // OSM-derived non-CPD green space (cemeteries, golf courses, nature
  // reserves, recreation grounds). Defaults off.
  showGreenSpaceHeatmap: false,
};

export function loadMode() {
  const raw = safeGet(MODE_KEY);
  return VALID_MODES.has(raw) ? raw : "route";
}

export function saveMode(mode) {
  if (VALID_MODES.has(mode)) safeSet(MODE_KEY, mode);
}

const VALID_CATEGORY_KEYS = new Set(ALL_CATEGORIES.map(c => c.key));
const VALID_SUB_KEYS = new Set(
  ALL_CATEGORIES.flatMap(c => (c.subs || []).map(s => `${c.key}/${s.key}`)),
);
const VALID_GROUP_KEYS = new Set(EXPLORE_GROUPS.map(g => g.key));

function sanitize(prefs) {
  if (!prefs || typeof prefs !== "object") return { ...DEFAULT_PREFS };

  const origin = (() => {
    const o = prefs.origin;
    if (!o || typeof o !== "object" || !VALID_ORIGIN_KINDS.has(o.kind)) {
      return { ...DEFAULT_PREFS.origin };
    }
    // Helper: validated community area or the default.
    const resolveCommunityArea = (raw) => {
      const name = typeof raw === "string" ? raw : "";
      const known = COMMUNITY_AREA_NAMES.find(
        n => n.toLowerCase() === name.toLowerCase(),
      );
      return known ?? DEFAULT_PREFS.origin.communityArea;
    };
    if (o.kind === "community_area") {
      return { kind: "community_area", communityArea: resolveCommunityArea(o.communityArea) };
    }
    // o.kind === "current": coords were never persisted, so a restored
    // "current" origin would auto-fetch into a permanent "Allow location
    // access" error. Downgrade to community-area mode (preserving the prior
    // pick if any) — the user can re-tap "📍 My location" to re-locate.
    return {
      kind: "community_area",
      communityArea: resolveCommunityArea(o.communityArea),
    };
  })();

  const maxMinutes = (() => {
    const n = Number(prefs.maxMinutes);
    if (!Number.isFinite(n)) return DEFAULT_PREFS.maxMinutes;
    return Math.max(MAX_MINUTES_MIN, Math.min(MAX_MINUTES_MAX, Math.round(n)));
  })();

  const expandedGroups = Array.isArray(prefs.expandedGroups)
    ? prefs.expandedGroups.filter(k => VALID_GROUP_KEYS.has(k))
    : [...DEFAULT_PREFS.expandedGroups];

  const selectedCategories = Array.isArray(prefs.selectedCategories)
    ? Array.from(new Set(
        prefs.selectedCategories
          // Migration: train_stations split into El + Metra (2026-05). The
          // legacy key maps to the El category so a returning user keeps
          // their rapid-transit selection.
          .map(k => (k === "train_stations" ? "el_train_stations" : k))
          .filter(k => VALID_CATEGORY_KEYS.has(k)),
      ))
    : [];

  const selectedSubs = Array.isArray(prefs.selectedSubs)
    ? Array.from(new Set(prefs.selectedSubs.filter(k => VALID_SUB_KEYS.has(k))))
    : [];

  const showResidentialHeatmap = typeof prefs.showResidentialHeatmap === "boolean"
    ? prefs.showResidentialHeatmap
    : DEFAULT_PREFS.showResidentialHeatmap;

  const showParksHeatmap = typeof prefs.showParksHeatmap === "boolean"
    ? prefs.showParksHeatmap
    : DEFAULT_PREFS.showParksHeatmap;

  const showTreeCanopyHeatmap = typeof prefs.showTreeCanopyHeatmap === "boolean"
    ? prefs.showTreeCanopyHeatmap
    : DEFAULT_PREFS.showTreeCanopyHeatmap;

  const showGreenSpaceHeatmap = typeof prefs.showGreenSpaceHeatmap === "boolean"
    ? prefs.showGreenSpaceHeatmap
    : DEFAULT_PREFS.showGreenSpaceHeatmap;

  return {
    origin,
    maxMinutes,
    expandedGroups,
    selectedCategories,
    selectedSubs,
    showResidentialHeatmap,
    showParksHeatmap,
    showTreeCanopyHeatmap,
    showGreenSpaceHeatmap,
  };
}

export function loadExplorePrefs() {
  return sanitize(loadJSON(PREFS_KEY, null));
}

export function saveExplorePrefs(prefs) {
  saveJSON(PREFS_KEY, sanitize(prefs));
}

export const EXPLORE_DEFAULTS = Object.freeze(DEFAULT_PREFS);
export const EXPLORE_BUDGET_MIN = MAX_MINUTES_MIN;
export const EXPLORE_BUDGET_MAX = MAX_MINUTES_MAX;

// Heatmap layer catalog. `key` matches the `heatmapKey` field on entries in
// exploreCategories.js (passed up from the category panel's checkbox); `prefKey`
// names the boolean field on the explorePrefs object. Adding a new heatmap
// means: add an entry here, add a default to DEFAULT_PREFS above + a matching
// branch in sanitize(), and surface the toggle in the category panel — the
// toggle/select-all/clear-all handlers in App.jsx drive themselves from this
// list.
export const HEATMAP_LAYERS = [
  { key: "residential",   prefKey: "showResidentialHeatmap" },
  { key: "parks_heatmap", prefKey: "showParksHeatmap" },
  { key: "tree_canopy",   prefKey: "showTreeCanopyHeatmap" },
  { key: "green_space",   prefKey: "showGreenSpaceHeatmap" },
];
