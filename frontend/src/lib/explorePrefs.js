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
import { ALL_CATEGORIES } from "./exploreCategories.js";

const MODE_KEY  = "walkpath:mode";
const PREFS_KEY = "walkpath:explorePrefs";

const VALID_MODES = new Set(["route", "explore"]);
const VALID_ORIGIN_KINDS = new Set(["current", "community_area"]);

const MAX_MINUTES_MIN = 5;
const MAX_MINUTES_MAX = 45;

const DEFAULT_PREFS = {
  origin: { kind: "community_area", communityArea: "Loop" },
  maxMinutes: 20,
  // Two top-level groups expanded by default — enough to demonstrate the
  // panel without forcing every group open. The user's expansion state is
  // remembered after their first interaction.
  expandedGroups: ["food_drink", "daily_life"],
  selectedCategories: [],
  selectedSubs: [],
  showResidentialHeatmap: true,
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
const VALID_GROUP_KEYS = new Set(
  // Read at module load time; OK because EXPLORE_GROUPS is static.
  // We only need the top-level group keys.
  ["daily_life", "food_drink", "outdoors", "culture", "living"],
);

function sanitize(prefs) {
  if (!prefs || typeof prefs !== "object") return { ...DEFAULT_PREFS };

  const origin = (() => {
    const o = prefs.origin;
    if (!o || typeof o !== "object" || !VALID_ORIGIN_KINDS.has(o.kind)) {
      return { ...DEFAULT_PREFS.origin };
    }
    if (o.kind === "community_area") {
      const name = typeof o.communityArea === "string" ? o.communityArea : "";
      const known = COMMUNITY_AREA_NAMES.find(
        n => n.toLowerCase() === name.toLowerCase(),
      );
      return { kind: "community_area", communityArea: known ?? DEFAULT_PREFS.origin.communityArea };
    }
    return { kind: "current", communityArea: null };
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
    ? Array.from(new Set(prefs.selectedCategories.filter(k => VALID_CATEGORY_KEYS.has(k))))
    : [];

  const selectedSubs = Array.isArray(prefs.selectedSubs)
    ? Array.from(new Set(prefs.selectedSubs.filter(k => VALID_SUB_KEYS.has(k))))
    : [];

  const showResidentialHeatmap = typeof prefs.showResidentialHeatmap === "boolean"
    ? prefs.showResidentialHeatmap
    : DEFAULT_PREFS.showResidentialHeatmap;

  return {
    origin,
    maxMinutes,
    expandedGroups,
    selectedCategories,
    selectedSubs,
    showResidentialHeatmap,
  };
}

export function loadExplorePrefs() {
  return sanitize(loadJSON(PREFS_KEY, null));
}

export function saveExplorePrefs(prefs) {
  saveJSON(PREFS_KEY, sanitize(prefs));
}

export const EXPLORE_DEFAULTS = { ...DEFAULT_PREFS };
export const EXPLORE_BUDGET_MIN = MAX_MINUTES_MIN;
export const EXPLORE_BUDGET_MAX = MAX_MINUTES_MAX;
