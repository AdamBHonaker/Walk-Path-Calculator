import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BACKEND_URL } from "../lib/backendUrl.js";
import { fetchExplore } from "../lib/exploreApi.js";

export function useExploreFetch({ mode, explorePrefs }) {
  const [exploreResult, setExploreResult] = useState(null);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreError, setExploreError] = useState("");

  const exploreAbortRef = useRef(null);
  useEffect(() => () => exploreAbortRef.current?.abort(), []);

  // Keep the latest prefs in a ref so the slider's onPointerUp callback doesn't
  // capture stale values when the user drags immediately after editing the dropdown.
  const explorePrefsRef = useRef(explorePrefs);
  useEffect(() => { explorePrefsRef.current = explorePrefs; }, [explorePrefs]);

  // The /explore endpoint accepts top-level category keys only. Subcategories affect
  // which pins draw on the map but not the request; the backend returns every place
  // under a selected parent and the frontend post-filters by subcategory in activeSubs.
  // Empty selection → send a sentinel so the backend doesn't collapse [] to "all".
  const requestCategories = useMemo(() => {
    const fromCats = explorePrefs.selectedCategories;
    const fromSubs = explorePrefs.selectedSubs.map(k => k.split("/", 1)[0]);
    const merged = Array.from(new Set([...fromCats, ...fromSubs]));
    return merged.length === 0 ? ["__none__"] : merged;
  }, [explorePrefs.selectedCategories, explorePrefs.selectedSubs]);

  const fetchExploreResult = useCallback(async (overrides = {}) => {
    const prefs = explorePrefsRef.current;
    const origin = overrides.origin ?? prefs.origin;
    const maxMinutes = overrides.maxMinutes ?? prefs.maxMinutes;
    const categories = overrides.categories ?? requestCategories;

    if (origin.kind === "current" && (origin.lat == null || origin.lon == null)) {
      setExploreError("Allow location access to explore from where you are.");
      return;
    }

    exploreAbortRef.current?.abort();
    exploreAbortRef.current = new AbortController();
    const signal = exploreAbortRef.current.signal;
    setExploreLoading(true);
    setExploreError("");
    try {
      const data = await fetchExplore({
        backendUrl: BACKEND_URL,
        origin,
        maxMinutes,
        categories,
        signal,
      });
      if (signal.aborted) return;
      setExploreResult(data);
    } catch (err) {
      if (err.name === "AbortError" || signal.aborted) return;
      setExploreError(err.message || "The explorer hit a snag — try again.");
    } finally {
      if (!signal.aborted) setExploreLoading(false);
    }
  }, [requestCategories]);

  // First entry into explore mode → fire an initial fetch so the user sees an
  // isochrone immediately on switch (no "click Discover" dead state).
  useEffect(() => {
    if (mode !== "explore") return;
    if (exploreResult) return;
    if (exploreLoading) return;
    fetchExploreResult();
    // Intentional: only run on mode-flip-into-explore + when result is empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Re-fetch when category selection changes (so the place pins refresh).
  // Origin / maxMinutes changes go through the explicit submit button so we
  // don't spam the backend on every drag tick.
  useEffect(() => {
    if (mode !== "explore") return;
    if (!exploreResult) return; // initial-fetch effect above will handle it
    fetchExploreResult();
    // exploreResult / fetchExploreResult / mode intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestCategories]);

  return {
    exploreResult,
    exploreLoading,
    exploreError,
    setExploreError,
    fetchExploreResult,
    explorePrefsRef,
  };
}
