// Persisted personalize-modal values. dailyGoal / walkPace / accessPrefs /
// height-ft / height-in / weightKg / weight-unit all share the same shape:
// a value is held in localStorage so a PWA SW reload mid-session doesn't
// wipe it. Range guards on read defend against a hand-edited storage entry
// resurrecting an out-of-range value. Each key has a matching save* helper
// that owns the null/empty handling so the key string is never spelled at
// the call site.
//
// Note on the `walkpath:` prefix — load-bearing per CLAUDE.md, kept to avoid
// orphaning user data from earlier installs.

import { safeGet, safeSet, safeRemove, loadJSON, saveJSON } from "./storage.js";

const DAILY_GOAL_KEY    = "walkpath:dailyGoal";
const HEIGHT_FT_KEY     = "walkpath:heightFt";
const HEIGHT_IN_KEY     = "walkpath:heightIn";
const WEIGHT_KG_KEY     = "walkpath:weightKg";
const WALK_PACE_KEY     = "walkpath:walkPace";
const ACCESS_PREFS_KEY  = "walkpath:accessPrefs";
const WEIGHT_UNIT_KEY   = "walkpath:weightUnit";
const MOBILITY_PROFILE_KEY = "walkpath:mobilityProfile";

export function loadDailyGoal() {
  const raw = safeGet(DAILY_GOAL_KEY);
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return n >= 1_000 && n <= 100_000 ? n : null;
}

export function saveDailyGoal(value) {
  if (value == null) return safeRemove(DAILY_GOAL_KEY);
  return safeSet(DAILY_GOAL_KEY, String(value));
}

export function loadStoredHeightFt() {
  const raw = safeGet(HEIGHT_FT_KEY);
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  // Range matches the backend's 36–108 in (3–9 ft) validator in
  // backend/main.py:RouteRequest.validate_height. The dropdown caps at 8
  // (9 ft is the backend upper bound but never observed in practice).
  return Number.isFinite(n) && n >= 3 && n <= 8 ? n : null;
}

export function saveStoredHeightFt(value) {
  if (value == null) return safeRemove(HEIGHT_FT_KEY);
  return safeSet(HEIGHT_FT_KEY, String(value));
}

export function loadStoredHeightIn() {
  const raw = safeGet(HEIGHT_IN_KEY);
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 && n <= 11 ? n : null;
}

export function saveStoredHeightIn(value) {
  if (value == null) return safeRemove(HEIGHT_IN_KEY);
  return safeSet(HEIGHT_IN_KEY, String(value));
}

export function loadStoredWeightKg() {
  const raw = safeGet(WEIGHT_KG_KEY);
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 30 && n <= 300 ? n : null;
}

export function saveStoredWeightKg(value) {
  if (value == null) return safeRemove(WEIGHT_KG_KEY);
  return safeSet(WEIGHT_KG_KEY, String(value));
}

export function loadStoredPace() {
  const v = safeGet(WALK_PACE_KEY);
  if (v === "leisurely" || v === "normal" || v === "brisk") return v;
  return "normal";
}

export function saveStoredPace(value) {
  return safeSet(WALK_PACE_KEY, value);
}

export function loadAccessPrefs() {
  const parsed = loadJSON(ACCESS_PREFS_KEY, {});
  return {
    avoidStairs: !!parsed?.avoidStairs,
    preferPedestrian: !!parsed?.preferPedestrian,
  };
}

export function saveAccessPrefs(prefs) {
  return saveJSON(ACCESS_PREFS_KEY, {
    avoidStairs: !!prefs?.avoidStairs,
    preferPedestrian: !!prefs?.preferPedestrian,
  });
}

export function loadWeightUnit() {
  return safeGet(WEIGHT_UNIT_KEY) || "lb";
}

export function saveWeightUnit(unit) {
  return safeSet(WEIGHT_UNIT_KEY, unit);
}

export function loadMobilityProfile() {
  const v = safeGet(MOBILITY_PROFILE_KEY);
  return v === "wheeled" ? "wheeled" : "walking";
}

export function saveMobilityProfile(value) {
  return safeSet(MOBILITY_PROFILE_KEY, value === "wheeled" ? "wheeled" : "walking");
}

const MOBILITY_OVERRIDE_DISMISSED_KEY = "walkpath:mobilityOverrideNoticeDismissed";

export function loadMobilityOverrideDismissed() {
  return safeGet(MOBILITY_OVERRIDE_DISMISSED_KEY) === "1";
}

export function saveMobilityOverrideDismissed() {
  return safeSet(MOBILITY_OVERRIDE_DISMISSED_KEY, "1");
}
