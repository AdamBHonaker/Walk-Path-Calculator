// Persistence + helpers for the "Recent routes" chip strip.
// Stored as a flat array under `walkpath:recentSearches`; entries support
// both legacy 2-stop ({origin, destination}) and multi-stop ({stops}) shapes.

import { loadJSON, saveJSON, safeRemove } from "./storage.js";
// MAX_STOPS lives in urlParams.js (the single source of truth — F-23).
// Re-exported here so historical importers of `./recentSearches.js` MAX_STOPS
// keep working without duplicating the literal.
import { MAX_STOPS } from "./urlParams.js";

export { MAX_STOPS };

export const RECENT_KEY = "walkpath:recentSearches";
export const RECENT_MAX = 10;

export function loadRecentSearches() {
  const parsed = loadJSON(RECENT_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveRecentSearch(originOrStops, destination) {
  let stops;
  if (Array.isArray(originOrStops)) {
    stops = originOrStops.slice(0, MAX_STOPS).map(String);
  } else {
    stops = [String(originOrStops), String(destination)];
  }
  if (stops.length < 2) return null;
  // OPT-056: single-pass dedupe + clean. Load is one JSON.parse via
  // loadRecentSearches. The new key is stringified once into `sig`. We
  // walk existing entries in a single loop, computing each entry's
  // stops shape inline (no re-stringify) and using a Set<string> of
  // stop signatures for O(1) "have we seen this?" — combining the prior
  // separate "drop corrupt" + "dedupe" filter passes into one. Corrupt
  // entries (fewer than 2 stops, the same shape `recentEntryStops`
  // refuses to render) are skipped here too so they don't crowd the
  // 10-slot window. Final write is one JSON.stringify + setItem.
  const existing = loadRecentSearches();
  const sig = JSON.stringify(stops);
  const entry = {
    stops,
    origin: stops[0],
    destination: stops[stops.length - 1],
    timestamp: Date.now(),
  };
  const seen = new Set([sig]); // pre-populate so any equal entry drops out
  const kept = [entry];
  for (const r of existing) {
    if (kept.length >= RECENT_MAX) break;
    const stopsArr = recentEntryStops(r);
    if (stopsArr.length < 2) continue;          // legacy corrupt — skip
    const rSig = JSON.stringify(stopsArr);
    if (seen.has(rSig)) continue;               // duplicate — skip
    seen.add(rSig);
    kept.push(r);
  }
  return saveJSON(RECENT_KEY, kept) ? kept : null;
}

export function clearRecentSearches() {
  safeRemove(RECENT_KEY);
}

export function recentEntryStops(entry) {
  if (Array.isArray(entry?.stops) && entry.stops.length >= 2) return entry.stops;
  if (entry?.origin && entry?.destination) return [entry.origin, entry.destination];
  return [];
}

export function formatRecentChip(stops) {
  if (!stops?.length) return "";
  if (stops.length <= 4) return stops.join(" → ");
  return `${stops[0]} → … → ${stops[stops.length - 1]} (${stops.length} stops)`;
}
