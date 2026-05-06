import { useState, useEffect } from "react";

// Subscribe to a CSS media query. Returns the current match state and re-renders
// when the match toggles. SSR-safe (returns false until mounted in a browser).
//
// The 480px mobile threshold in App.jsx routes the map-first MobileLayout;
// the 481–1023px tablet range uses the desktop layout with a narrower sidebar.
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
