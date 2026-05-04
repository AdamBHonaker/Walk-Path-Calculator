// Persistence + helpers for the "Recent routes" chip strip.
// Stored as a flat array under `walkpath:recentSearches`; entries support
// both legacy 2-stop ({origin, destination}) and multi-stop ({stops}) shapes.

import { loadJSON, saveJSON, safeRemove } from "./storage.js";

export const RECENT_KEY = "walkpath:recentSearches";
export const RECENT_MAX = 10;
export const MAX_STOPS  = 8;

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
  const existing = loadRecentSearches();
  const sig = stops.join("");
  const entry = {
    stops,
    origin: stops[0],
    destination: stops[stops.length - 1],
    timestamp: Date.now(),
  };
  const sigOf = (r) =>
    (Array.isArray(r.stops) ? r.stops : [r.origin, r.destination]).join("");
  const deduped = existing.filter(r => sigOf(r) !== sig);
  const updated = [entry, ...deduped].slice(0, RECENT_MAX);
  return saveJSON(RECENT_KEY, updated) ? updated : null;
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
