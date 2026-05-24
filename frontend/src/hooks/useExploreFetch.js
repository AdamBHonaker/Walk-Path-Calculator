import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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

  // OPT-025: derive the backend `with_heatmaps` filter from the four toggle
  // prefs. Layer names must match the backend's `_HEATMAP_LAYER_NAMES`
  // ({"residential","parks","green_space","tree_canopy"}). Drives both the
  // request body and the toggle-expansion effect below.
  const requestHeatmaps = useMemo(() => {
    const out = [];
    if (explorePrefs.showResidentialHeatmap) out.push("residential");
    if (explorePrefs.showParksHeatmap)       out.push("parks");
    if (explorePrefs.showTreeCanopyHeatmap)  out.push("tree_canopy");
    if (explorePrefs.showGreenSpaceHeatmap)  out.push("green_space");
    return out;
  }, [
    explorePrefs.showResidentialHeatmap,
    explorePrefs.showParksHeatmap,
    explorePrefs.showTreeCanopyHeatmap,
    explorePrefs.showGreenSpaceHeatmap,
  ]);

  // Tracks the heatmap set the last successful fetch was built against. Lets
  // the toggle-expansion effect below skip a network round-trip when a user
  // toggles a heatmap OFF (no fetch needed) or back ON when the existing
  // exploreResult already carries its geojson (the layer just unhides from
  // the same cached data).
  const lastFetchedHeatmapsRef = useRef(null);

  const fetchExploreResult = useCallback(async (overrides = {}) => {
    const prefs = explorePrefsRef.current;
    const origin = overrides.origin ?? prefs.origin;
    const maxMinutes = overrides.maxMinutes ?? prefs.maxMinutes;
    const categories = overrides.categories ?? requestCategories;
    const withHeatmaps = overrides.withHeatmaps ?? requestHeatmaps;

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
        origin,
        maxMinutes,
        categories,
        withHeatmaps,
        signal,
      });
      if (signal.aborted) return;
      setExploreResult(data);
      lastFetchedHeatmapsRef.current = withHeatmaps;
    } catch (err) {
      if (err.name === "AbortError" || signal.aborted) return;
      const message = err.name === "TimeoutError"
        ? "The explorer didn't respond in time. Please try again."
        : err.message || "The explorer hit a snag — try again.";
      setExploreError(message);
    } finally {
      if (!signal.aborted) setExploreLoading(false);
    }
  }, [requestCategories, requestHeatmaps]);

  // First entry into explore mode → fire an initial fetch so the user sees an
  // isochrone immediately on switch (no "click Discover" dead state).
  //
  // OPT-057: the prior `if (exploreLoading) return;` in-flight guard was
  // removed. `fetchExploreResult` already implements cancel-and-replace
  // via `exploreAbortRef.current?.abort()` before starting the new
  // request, so a rapid mode toggle (explore → route → explore) now
  // aborts the stale fetch and starts a fresh one with the current
  // params, rather than silently dropping the new request and letting
  // the prior one's stale params surface in the result.
  useEffect(() => {
    if (mode !== "explore") return;
    if (exploreResult) return;
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
    // If origin is "current" but coords haven't arrived yet (geolocation
    // in flight), skip silently — handleExploreLocateMe will fire its own
    // fetch once coords land. Without this, a category toggle during the
    // locating window would surface a misleading "Allow location access"
    // error to the user.
    const o = explorePrefsRef.current.origin;
    if (o.kind === "current" && (o.lat == null || o.lon == null)) return;
    fetchExploreResult();
    // exploreResult / fetchExploreResult / mode intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestCategories]);

  // OPT-025: re-fetch when the user toggles ON a heatmap whose data the
  // current exploreResult doesn't carry. Toggling OFF is silent (the layer
  // hides client-side via the existing show* prefs), and toggling back ON
  // a heatmap whose geojson is already in exploreResult is silent too.
  useEffect(() => {
    if (mode !== "explore") return;
    if (!exploreResult) return;
    const last = lastFetchedHeatmapsRef.current;
    if (last === null) return;
    const o = explorePrefsRef.current.origin;
    if (o.kind === "current" && (o.lat == null || o.lon == null)) return;
    const lastSet = new Set(last);
    const needsExpansion = requestHeatmaps.some(h => !lastSet.has(h));
    if (needsExpansion) fetchExploreResult();
    // exploreResult / fetchExploreResult / mode intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestHeatmaps]);

  return {
    exploreResult,
    exploreLoading,
    exploreError,
    setExploreError,
    fetchExploreResult,
    explorePrefsRef,
  };
}
