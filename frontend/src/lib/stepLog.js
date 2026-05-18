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
  return pruneExpired(parsed);
}

// Read the log, drop expired entries, and write the pruned list back to
// localStorage if anything changed. Kept separate from `loadStepLog` so
// the loader stays side-effect-free (lazy state initializers in React
// can run twice in StrictMode, and we don't want the writeback either
// time). The App's mount effect calls this once on startup to compact
// the persisted log; reads during render stay read-only.
export function pruneStoredStepLog() {
  const parsed = loadJSON(STEP_LOG_KEY, []);
  if (!Array.isArray(parsed)) return [];
  const pruned = pruneExpired(parsed);
  if (pruned.length !== parsed.length) saveJSON(STEP_LOG_KEY, pruned);
  return pruned;
}

// `currentLog` lets the caller pass the live state-held log so we don't
// re-read + re-parse localStorage on every click. Falls back to disk for
// callers that don't have it in hand. Either way the write is a single
// stringify + setItem.
export function logWalk({ steps, miles, minutes, origin, destination }, currentLog) {
  const existing = Array.isArray(currentLog) ? currentLog : loadStepLog();
  const now = Date.now();
  const d = new Date(now);
  const entry = {
    timestamp: now,
    // Local-date YYYY-MM-DD — ISO toString would format UTC and group
    // late-night Chicago walks under the wrong day.
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    steps: Number(steps) || 0,
    miles: Number(miles) || 0,
    minutes: Number.isFinite(Number(minutes)) ? Number(minutes) : null,
    origin: String(origin ?? ""),
    destination: String(destination ?? ""),
  };
  return saveJSON(STEP_LOG_KEY, [entry, ...existing]) ? entry : null;
}

export function clearStepLog() {
  safeRemove(STEP_LOG_KEY);
}
