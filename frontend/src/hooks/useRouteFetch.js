import { useState, useEffect, useRef } from "react";
import { BACKEND_URL } from "../lib/backendUrl.js";
import { fetchWithTimeout } from "../lib/fetchWithTimeout.js";
import { loadRecentSearches, saveRecentSearch } from "../lib/recentSearches.js";

const MIN_LOADING_MS = 450;
function ensureMinLoadingDuration(start) {
  const remaining = MIN_LOADING_MS - (performance.now() - start);
  if (remaining > 0) return new Promise(r => setTimeout(r, remaining));
  return Promise.resolve();
}

export function useRouteFetch({
  heightFt, heightIn, weightKg, dailyGoal, walkPace, avoidStairs, preferPedestrian,
  initialUrlParams,
}) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches);

  const abortRef = useRef(null);
  const fetchRouteRef = useRef(null);
  const didAutoFetch = useRef(false);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  async function fetchRoute(stopsList) {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setLoading(true);
    setError("");
    setResult(null);

    const loadStart = performance.now();

    const height_inches =
      heightFt !== null && heightIn !== null
        ? heightFt * 12 + heightIn
        : null;

    const cleanStops = stopsList.map(s => String(s).trim()).filter(Boolean);
    const multi = cleanStops.length > 2;

    const body = multi
      ? { stops: cleanStops }
      : { origin: cleanStops[0], destination: cleanStops[1] };

    try {
      const res = await fetchWithTimeout(`${BACKEND_URL}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          height_inches,
          weight_kg:         weightKg,
          daily_goal:        dailyGoal,
          pace:              walkPace,
          avoid_stairs:      avoidStairs,
          prefer_pedestrian: preferPedestrian,
        }),
        signal,
      });

      if (!res.ok) {
        // 429 (rate limiter) and 503 (circuit breaker) both signal geocoding degraded.
        // Prefer the backend's structured detail.message when present.
        let msg = `Service error (${res.status})`;
        try {
          const d = await res.json();
          if (d.detail && typeof d.detail === "object" && d.detail.message) {
            msg = d.detail.message;
          } else if (typeof d.detail === "string") {
            msg = d.detail;
          } else if (res.status === 429) {
            msg = "The geocoding service is rate-limited — try again in a minute.";
          }
        } catch {
          if (res.status === 429) {
            msg = "The geocoding service is rate-limited — try again in a minute.";
          }
        }
        throw new Error(msg);
      }

      const data = await res.json();

      // URL + recents reflect the submitted request — write before the min-loading
      // delay so deep-link state is correct even if the user navigates away mid-skeleton.
      const urlP = new URLSearchParams();
      if (multi) {
        urlP.set("stops", cleanStops.map(encodeURIComponent).join("|"));
      } else {
        urlP.set("from", cleanStops[0]);
        urlP.set("to",   cleanStops[1]);
      }
      if (heightFt !== null) urlP.set("hft", String(heightFt));
      if (heightIn !== null) urlP.set("hin", String(heightIn));
      history.replaceState(null, "", `?${urlP.toString()}`);
      const updatedRecents = saveRecentSearch(cleanStops);
      if (updatedRecents) setRecentSearches(updatedRecents);

      await ensureMinLoadingDuration(loadStart);
      if (signal.aborted) return;
      setResult(data);
    } catch (err) {
      if (err.name === "AbortError" || signal.aborted) return;
      await ensureMinLoadingDuration(loadStart);
      if (signal.aborted) return;
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      // Only flip loading off if this fetch hasn't been superseded.
      if (!signal.aborted) setLoading(false);
    }
  }

  // Sync ref every render so useCallback-frozen handlers always call the
  // latest closure (with current height/weight/pace/prefs).
  fetchRouteRef.current = fetchRoute;

  // Auto-submit once on mount when the page loads with URL-encoded route params.
  // The ref guard opts this effect out of StrictMode's intentional double-fire in
  // dev. Safe here because the only side effect is an idempotent fetch whose
  // cleanup (abortRef.current?.abort() in fetchRoute) is independently verified.
  // Any future side effect added inside this block must be reviewed for cleanup
  // correctness — StrictMode will not warn.
  useEffect(() => {
    if (didAutoFetch.current) return;
    didAutoFetch.current = true;
    const p = initialUrlParams;
    if (p.stops?.length) {
      fetchRoute(p.stops);
    } else if (p.from && p.to) {
      fetchRoute([p.from, p.to]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { result, loading, error, recentSearches, setRecentSearches, fetchRoute, fetchRouteRef };
}
