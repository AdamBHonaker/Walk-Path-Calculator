// Persisted personalize-modal values. dailyGoal / walkPace / accessPrefs /
// height-ft / height-in / weightKg all share the same shape: a value is held
// in localStorage so a PWA SW reload mid-session doesn't wipe it. Range
// guards on read defend against a hand-edited storage entry resurrecting an
// out-of-range value.
//
// Note on the `walkpath:` prefix — load-bearing per CLAUDE.md, kept to avoid
// orphaning user data from earlier installs.

import { safeGet, loadJSON } from "./storage.js";

export function loadDailyGoal() {
  const raw = safeGet("walkpath:dailyGoal");
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return n >= 1_000 && n <= 100_000 ? n : null;
}

export function loadStoredHeightFt() {
  const raw = safeGet("walkpath:heightFt");
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 4 && n <= 7 ? n : null;
}

export function loadStoredHeightIn() {
  const raw = safeGet("walkpath:heightIn");
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 && n <= 11 ? n : null;
}

export function loadStoredWeightKg() {
  const raw = safeGet("walkpath:weightKg");
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 30 && n <= 300 ? n : null;
}

export function loadStoredPace() {
  const v = safeGet("walkpath:walkPace");
  if (v === "leisurely" || v === "normal" || v === "brisk") return v;
  return "normal";
}

export function loadAccessPrefs() {
  const parsed = loadJSON("walkpath:accessPrefs", {});
  return {
    avoidStairs: !!parsed?.avoidStairs,
    preferPedestrian: !!parsed?.preferPedestrian,
  };
}
