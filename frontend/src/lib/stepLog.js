// Multi-Day Step Accumulator: persists logged walks under
// `walkpath:stepLog`, prunes entries older than STEP_LOG_TTL_DAYS on read.

import { loadJSON, saveJSON, safeRemove } from "./storage.js";

export const STEP_LOG_KEY      = "walkpath:stepLog";
export const STEP_LOG_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function pruneExpired(entries, now = Date.now()) {
  const cutoff = now - STEP_LOG_TTL_DAYS * DAY_MS;
  return entries.filter(e => typeof e?.timestamp === "number" && e.timestamp >= cutoff);
}

export function loadStepLog() {
  const parsed = loadJSON(STEP_LOG_KEY, []);
  if (!Array.isArray(parsed)) return [];
  const pruned = pruneExpired(parsed);
  if (pruned.length !== parsed.length) saveJSON(STEP_LOG_KEY, pruned);
  return pruned;
}

export function logWalk({ steps, miles, origin, destination }) {
  const existing = loadStepLog();
  const now = Date.now();
  const d = new Date(now);
  const entry = {
    timestamp: now,
    // Local-date YYYY-MM-DD — ISO toString would format UTC and group
    // late-night Chicago walks under the wrong day.
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    steps: Number(steps) || 0,
    miles: Number(miles) || 0,
    origin: String(origin ?? ""),
    destination: String(destination ?? ""),
  };
  return saveJSON(STEP_LOG_KEY, [entry, ...existing]) ? entry : null;
}

export function clearStepLog() {
  safeRemove(STEP_LOG_KEY);
}
