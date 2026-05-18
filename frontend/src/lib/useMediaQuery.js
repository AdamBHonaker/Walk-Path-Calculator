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

// Subscribe to a CSS media query. Returns the current match state and re-renders
// when the match toggles. SSR-safe (returns false until mounted in a browser).
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}
