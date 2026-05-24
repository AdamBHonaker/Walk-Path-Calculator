import { useState, useEffect } from "react";

// Canonical viewport breakpoints. Mirrored in App.css media queries — if these
// move, the matching `@media` rules in App.css need to move together. Kept as
// query strings (not numbers) because consumers pass them directly to
// `window.matchMedia` / `useMediaQuery`.
//
// MQ_MOBILE  : map-first MobileLayout (sheet UI), ≤ 480 px
// MQ_TABLET  : desktop two-column layout with narrower sidebar, 481–1023 px
// MQ_DESKTOP : full desktop two-column layout, ≥ 1024 px
export const MQ_MOBILE  = "(max-width: 480px)";
export const MQ_TABLET  = "(min-width: 481px) and (max-width: 1023px)";
export const MQ_DESKTOP = "(min-width: 1024px)";

// OPT-061: a module-level cache of `matchMedia` instances + subscriber sets.
// Each distinct query gets exactly one underlying `MediaQueryList` regardless
// of how many components call `useMediaQuery(q)` — the prior implementation
// registered a fresh `change` listener per call site, so on viewport resize
// the same query was evaluated N times (once per consumer). With this cache,
// one DOM event fans out to all React setters.
const _queryCache = new Map();
// Track the matchMedia function used to populate the cache. Test fixtures
// reassign `window.matchMedia` between cases to simulate different viewport
// widths; without this check, a fixture swap would leave stale MQL entries
// in the cache and downstream `useMediaQuery` reads would report the wrong
// match state. Production-side this is a no-op — `window.matchMedia` never
// changes identity in real browsers.
let _cacheMatchMedia = null;

function _ensureEntry(query) {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  if (window.matchMedia !== _cacheMatchMedia) {
    for (const entry of _queryCache.values()) {
      try { entry.mql.removeEventListener?.("change", entry.onChange); }
      catch { /* mock MQLs may not implement removeEventListener */ }
    }
    _queryCache.clear();
    _cacheMatchMedia = window.matchMedia;
  }
  let entry = _queryCache.get(query);
  if (entry) return entry;
  const mql = window.matchMedia(query);
  const listeners = new Set();
  const onChange = () => {
    const matches = mql.matches;
    for (const setter of listeners) setter(matches);
  };
  mql.addEventListener?.("change", onChange);
  entry = { mql, listeners, onChange };
  _queryCache.set(query, entry);
  return entry;
}

// Subscribe to a CSS media query. Returns the current match state and re-renders
// when the match toggles. SSR-safe (returns false until mounted in a browser).
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    const entry = _ensureEntry(query);
    return entry ? entry.mql.matches : false;
  });
  useEffect(() => {
    const entry = _ensureEntry(query);
    if (!entry) return;
    // Sync state to the current match value in case it shifted between the
    // initial useState call and effect attach (rare, but possible in test
    // environments that toggle `matchMedia` after mount).
    setMatches(entry.mql.matches);
    entry.listeners.add(setMatches);
    return () => { entry.listeners.delete(setMatches); };
  }, [query]);
  return matches;
}
