import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import "./App.css";

// MapView and ShareDispatch both pull in maplibre-gl (~290 KB gzip). Lazy-load
// both so the initial bundle stays form-only — see FEATURE_HISTORY entry
// "Code-splitting MapView for faster cold-load".
const MapView = lazy(() => import("./MapView.jsx"));
const ShareDispatch = lazy(() =>
  import("./components/ShareDispatch.jsx").then(m => ({ default: m.ShareDispatch }))
);

import { calorieEquivalent } from "./calorieEquiv.js";
import {
  safeSet, safeRemove, saveJSON,
  loadSessionJSON, saveSessionJSON, safeSessionRemove,
} from "./lib/storage.js";
import { Masthead } from "./components/Masthead.jsx";
import { Footer } from "./components/Footer.jsx";
import { PersonalizeModal } from "./components/PersonalizeModal.jsx";
import { DirectionLedger } from "./components/DirectionLedger.jsx";
import { RouteFlavorTabs } from "./components/RouteFlavorTabs.jsx";
import { CompareDispatch } from "./components/CompareDispatch.jsx";
import { LoadingSkeleton } from "./components/LoadingSkeleton.jsx";
import { ErrorDispatch } from "./components/ErrorDispatch.jsx";
import { WeeklySummaryPanel } from "./components/WeeklySummaryPanel.jsx";
import { MobileLayout } from "./components/MobileLayout.jsx";
import { PaceSelector } from "./components/PaceSelector.jsx";
import { StepHero } from "./components/StepHero.jsx";
import { RecentSearches } from "./components/RecentSearches.jsx";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary.jsx";
import { useMediaQuery } from "./lib/useMediaQuery.js";
import { loadSheetSnap } from "./lib/sheetSnap.js";
import { resolveCurrentLocation } from "./lib/geolocation.js";
import { WPIcon } from "./wayfarer/walkpath-icons.jsx";
import { WFIcon } from "./wayfarer/icons.jsx";
import { WFCheck } from "./wayfarer/forms.jsx";
import { useTurnCoords } from "./hooks/useTurnCoords.js";
import { BACKEND_URL } from "./lib/backendUrl.js";
import { fetchWithTimeout } from "./lib/fetchWithTimeout.js";
import { lbToKg } from "./lib/units.js";
import { MAX_STOPS, parseStopsParam, readUrlParams } from "./lib/urlParams.js";
import {
  loadDailyGoal,
  loadStoredHeightFt, loadStoredHeightIn, loadStoredWeightKg,
  loadStoredPace, loadAccessPrefs,
} from "./lib/personaPrefs.js";
import {
  PACE_LABELS,
  safePaceLabel,
  motivationMessage,
  formatDirectionsText,
} from "./lib/routeFormat.js";
import {
  RECENT_KEY,
  RECENT_MAX,
  loadRecentSearches,
  saveRecentSearch,
  recentEntryStops,
  formatRecentChip,
} from "./lib/recentSearches.js";
import {
  STEP_LOG_TTL_DAYS,
  loadStepLog,
  logWalk,
  clearStepLog,
} from "./lib/stepLog.js";
import { ExploreForm } from "./components/ExploreForm.jsx";
import { ExploreCategoryPanel } from "./components/ExploreCategoryPanel.jsx";
import {
  loadMode, saveMode,
  loadExplorePrefs, saveExplorePrefs,
} from "./lib/explorePrefs.js";
import { PIN_CATEGORIES } from "./lib/exploreCategories.js";
import { fetchExplore } from "./lib/exploreApi.js";

// Re-exports for App.test.jsx — extractions to lib/ stay transparent
// to the existing test imports.
export { formatBlocks } from "./lib/directionFormat.js";
export {
  calorieEquivalent,
  RECENT_MAX,
  loadRecentSearches,
  saveRecentSearch,
  recentEntryStops,
  formatRecentChip,
  STEP_LOG_TTL_DAYS,
  loadStepLog,
  logWalk,
  clearStepLog,
  PACE_LABELS,
  safePaceLabel,
  motivationMessage,
  formatDirectionsText,
  lbToKg,
  loadDailyGoal,
  loadStoredPace,
  parseStopsParam,
  MAX_STOPS,
};

// Floor on how long the loading skeleton stays mounted, even when the fetch
// resolves quickly. Without this, on localhost (~80 ms round-trip) the skeleton
// flashes for one frame and the user perceives an instant transition that
// reads as a glitch. 450ms gives the shimmer enough time to land at least one
// full sweep so the skeleton registers as a deliberate state.
const MIN_LOADING_MS = 450;
function ensureMinLoadingDuration(start) {
  const remaining = MIN_LOADING_MS - (performance.now() - start);
  if (remaining > 0) return new Promise(r => setTimeout(r, remaining));
  return Promise.resolve();
}

let _stopIdCounter = 0;
function makeStopId() {
  _stopIdCounter += 1;
  return `stop-${_stopIdCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

// Persisted stop drafts. Saved to sessionStorage (not localStorage) so a draft
// survives a reload but doesn't haunt the user's inputs days later. Stored
// with a write timestamp; entries older than STOPS_TTL_MS are discarded on
// load as a belt-and-braces guard against very long-lived sessions.
const STOPS_KEY = "walkpath:draftStops";
const STOPS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function loadStoredStops(now = Date.now()) {
  const parsed = loadSessionJSON(STOPS_KEY, null);
  if (!parsed || typeof parsed !== "object") return null;
  if (!Array.isArray(parsed.values)) return null;
  if (typeof parsed.savedAt !== "number") return null;
  if (now - parsed.savedAt > STOPS_TTL_MS) return null;
  const values = parsed.values
    .filter(v => typeof v === "string")
    .map(v => v.slice(0, 200));
  if (values.length < 2) return null;
  return values.slice(0, MAX_STOPS);
}

export function saveStoredStops(values) {
  saveSessionJSON(STOPS_KEY, { values, savedAt: Date.now() });
}

export default function App() {
  // Parse URL params and access prefs once on mount; downstream initializers
  // and the auto-fetch effect read from these refs instead of re-parsing.
  const initialUrlParamsRef = useRef(null);
  if (initialUrlParamsRef.current === null) initialUrlParamsRef.current = readUrlParams();
  const initialUrlParams = initialUrlParamsRef.current;

  const initialAccessRef = useRef(null);
  if (initialAccessRef.current === null) initialAccessRef.current = loadAccessPrefs();
  const initialAccess = initialAccessRef.current;

  const [stops, setStops] = useState(() => {
    // Priority: URL params (shareable links) > sessionStorage draft > empty.
    // The sessionStorage path is what catches a PWA SW reload mid-edit.
    if (initialUrlParams.stops?.length) {
      return initialUrlParams.stops.map(v => ({ id: makeStopId(), value: v }));
    }
    if (initialUrlParams.from || initialUrlParams.to) {
      return [
        { id: makeStopId(), value: initialUrlParams.from || "" },
        { id: makeStopId(), value: initialUrlParams.to   || "" },
      ];
    }
    const draft = loadStoredStops();
    if (draft) return draft.map(v => ({ id: makeStopId(), value: v }));
    return [
      { id: makeStopId(), value: "" },
      { id: makeStopId(), value: "" },
    ];
  });

  const stopValues = stops.map(s => s.value);
  const origin      = stops[0]?.value ?? "";
  const destination = stops[stops.length - 1]?.value ?? "";
  const isMultiStop = stops.length > 2;

  function setStopValue(id, value) {
    setStops(prev => prev.map(s => s.id === id ? { ...s, value } : s));
  }
  function addStop() {
    setStops(prev => prev.length >= MAX_STOPS
      ? prev
      : [...prev.slice(0, -1), { id: makeStopId(), value: "" }, prev[prev.length - 1]]
    );
  }
  function removeStop(id) {
    setStops(prev => prev.length <= 2 ? prev : prev.filter(s => s.id !== id));
  }
  function moveStop(id, delta) {
    setStops(prev => {
      const idx = prev.findIndex(s => s.id === id);
      const target = idx + delta;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }
  function reverseStops() {
    setStops(prev => prev.slice().reverse().map(s => ({ ...s, id: makeStopId() })));
  }

  // Height and weight: URL params win (shareable links carry hft/hin), then
  // localStorage. Without this, a PWA SW reload would wipe what the user
  // entered in the Personalize modal.
  const [heightFt, setHeightFt]       = useState(() =>
    initialUrlParams.hft ?? loadStoredHeightFt(),
  );
  const [heightIn, setHeightIn]       = useState(() => {
    if (initialUrlParams.hft != null) return initialUrlParams.hin;
    return loadStoredHeightIn();
  });
  const [weightKg, setWeightKg]       = useState(loadStoredWeightKg);
  const [dailyGoal, setDailyGoalState] = useState(() => loadDailyGoal());
  const [walkPace, setWalkPace]         = useState(loadStoredPace);

  const [avoidStairs, setAvoidStairs]           = useState(initialAccess.avoidStairs);
  const [preferPedestrian, setPreferPedestrian] = useState(initialAccess.preferPedestrian);
  const [personalizeOpen, setPersonalizeOpen]   = useState(false);

  useEffect(() => {
    saveJSON("walkpath:accessPrefs", { avoidStairs, preferPedestrian });
  }, [avoidStairs, preferPedestrian]);

  useEffect(() => {
    safeSet("walkpath:walkPace", walkPace);
  }, [walkPace]);

  useEffect(() => {
    if (heightFt == null) safeRemove("walkpath:heightFt");
    else safeSet("walkpath:heightFt", String(heightFt));
  }, [heightFt]);

  useEffect(() => {
    if (heightIn == null) safeRemove("walkpath:heightIn");
    else safeSet("walkpath:heightIn", String(heightIn));
  }, [heightIn]);

  useEffect(() => {
    if (weightKg == null) safeRemove("walkpath:weightKg");
    else safeSet("walkpath:weightKg", String(weightKg));
  }, [weightKg]);

  // Persist stop drafts to sessionStorage on every change so a SW-triggered
  // reload (or a normal refresh) restores what the user was typing. Two
  // empty stops = nothing worth saving — clear instead.
  useEffect(() => {
    const values = stops.map(s => s.value);
    if (values.every(v => !v.trim())) safeSessionRemove(STOPS_KEY);
    else saveStoredStops(values);
  }, [stops]);

  // ── Neighborhood Explorer state ──────────────────────────────────────
  // `mode` is the top-level switch — "route" (the original feature) vs.
  // "explore" (the isochrone view). Explore prefs persist on every change
  // so a user who picks Logan Square + 25 min on Tuesday gets that back
  // on Wednesday. The result itself is not persisted — it always comes
  // from a fresh /explore call when the user enters the mode (the polygon
  // is fast, ~150 ms even at 45 min, so re-fetching is cheaper than
  // serializing it out).
  //
  // A shared route URL (?stops=… or ?from=…&to=…) forces route mode at
  // boot, overriding whatever was persisted, so the link recipient sees
  // the route the sender intended. The explorer doesn't have URL state
  // yet — that's a future enhancement.
  const _hasRouteParams = !!(initialUrlParams.stops?.length
    || (initialUrlParams.from && initialUrlParams.to));
  const [mode, setModeState]            = useState(() =>
    _hasRouteParams ? "route" : loadMode(),
  );
  const [explorePrefs, setExplorePrefs] = useState(loadExplorePrefs);
  const [exploreResult, setExploreResult]   = useState(null);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreError, setExploreError]     = useState("");
  const setMode = useCallback((next) => {
    setModeState(next);
    saveMode(next);
  }, []);
  useEffect(() => { saveExplorePrefs(explorePrefs); }, [explorePrefs]);

  const [result, setResult]           = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches);
  const [stepLog, setStepLog]               = useState(loadStepLog);
  const [walkLogged, setWalkLogged]         = useState(false);
  const [activeTurnIndex, setActiveTurnIndex] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [cardMapReady, setCardMapReady]     = useState(false);
  // Web Share API capability probe — runs once on mount so the share button
  // can label itself accurately ("Share" on mobile, "Download PNG" on
  // desktop) instead of showing an action that won't fire.
  const [canWebShare, setCanWebShare]       = useState(false);
  useEffect(() => {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
        const probe = new File([new Blob(["x"], { type: "image/png" })], "probe.png", { type: "image/png" });
        if (navigator.canShare({ files: [probe] })) setCanWebShare(true);
      }
    } catch { /* fall through to download fallback */ }
  }, []);
  const [pickMode, setPickMode]             = useState(null); // stop id | null
  const [locating, setLocating]             = useState(false);
  const [toastMsg, setToastMsg]             = useState("");
  const [activeFlavor, setActiveFlavor]     = useState("fastest");
  // SW update prompt. With registerType: "prompt" in vite.config.js, a new
  // service worker waits for our OK before activating — we surface that as
  // an actionable banner instead of silently reloading mid-session.
  const [swUpdateReady, setSwUpdateReady]   = useState(false);
  const swUpdateFnRef = useRef(null);

  // Mobile bottom-sheet state. Initial snap is the user's persisted preference
  // (loadSheetSnap), falling back to peek (0). When a new route arrives we
  // auto-promote ONLY from peek — if the user has previously chosen half or
  // full, that preference wins over auto-promote so they don't fight the UI.
  // The auto-promote itself never writes to storage; only manual drags do
  // (debounce-write lives in MobileLayout).
  // Mobile (sheet) caps at 480 px. The 481–1023 px tablet range uses the
  // desktop two-column layout with a narrower sidebar (see `app--tablet`
  // in App.css). Same `mainContents` / `mapNode` JSX in both desktop branches
  // preserves React component identity — no MapLibre re-init when a tablet
  // crosses the 1024 px threshold on rotation.
  const isMobile = useMediaQuery("(max-width: 480px)");
  const isTablet = useMediaQuery("(min-width: 481px) and (max-width: 1023px)");
  const [sheetSnap, setSheetSnap] = useState(() => loadSheetSnap() ?? 0);
  const [mapPadding, setMapPadding] = useState(null);
  const lastResultRef = useRef(null);
  // Once the user manually moves the sheet, stop auto-promoting on result
  // arrival — they've expressed a preference for this session and the sheet
  // jumping back up to half on every re-submit feels broken.
  const userMovedSheetRef = useRef(false);
  const handleSheetSnapChange = useCallback((idx) => {
    userMovedSheetRef.current = true;
    setSheetSnap(idx);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    if (result && !lastResultRef.current && !userMovedSheetRef.current) {
      setSheetSnap(prev => prev === 0 ? 1 : prev);
    }
    lastResultRef.current = result;
  }, [result, isMobile]);

  // Mode flip → if the user enters explore mode while the sheet is at peek,
  // promote it to half so the form is actually visible. Same "respect the
  // user's explicit drag" guard as the route-result auto-promote: once the
  // user has moved the sheet manually this session, mode flips don't override.
  useEffect(() => {
    if (!isMobile) return;
    if (mode !== "explore") return;
    if (userMovedSheetRef.current) return;
    setSheetSnap(prev => prev === 0 ? 1 : prev);
  }, [mode, isMobile]);

  // Mobile pick-on-map: drop the sheet to peek so the user can see the
  // map, remember the snap they were at, and restore it once the pick
  // resolves (whether by tapping a point or cancelling).
  const snapBeforePickRef = useRef(null);
  useEffect(() => {
    if (!isMobile) return;
    if (pickMode) {
      if (snapBeforePickRef.current === null) {
        snapBeforePickRef.current = sheetSnap;
      }
      if (sheetSnap !== 0) setSheetSnap(0);
    } else if (snapBeforePickRef.current !== null) {
      const restore = snapBeforePickRef.current;
      snapBeforePickRef.current = null;
      setSheetSnap(restore);
    }
    // sheetSnap intentionally omitted: we only react to pickMode transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickMode, isMobile]);

  const handleObscuredChange = useCallback((bottomPx) => {
    setMapPadding({
      top: 80,
      bottom: bottomPx + 16,
      left: 16,
      right: 16,
    });
  }, []);

  // Overlay the active flavor's per-route fields onto top-level metadata
  // (origin/dest coords, step length, etc.) so existing renderers — which read
  // `viewResult.path/directions/total_*` — work unchanged regardless of flavor.
  const viewResult = useMemo(() => {
    if (!result) return null;
    const routes = Array.isArray(result.routes) ? result.routes : null;
    if (!routes?.length) return result;
    const active = routes.find(r => r.flavor === activeFlavor) ?? routes[0];
    return { ...result, ...active };
  }, [result, activeFlavor]);

  const turnCoords = useTurnCoords(viewResult?.path, viewResult?.directions);

  useEffect(() => {
    setActiveTurnIndex(null);
    setWalkLogged(false);
    setActiveFlavor(result?.default_flavor ?? "fastest");
  }, [result]);

  function handleLogWalk() {
    if (!viewResult || walkLogged) return;
    const entry = logWalk({
      steps: viewResult.total_steps,
      miles: viewResult.total_miles,
      origin,
      destination: isMultiStop
        ? stopValues.slice(1).join(" → ")
        : destination,
    });
    if (entry) setStepLog(prev => [entry, ...prev]);
    setWalkLogged(true);
  }

  function handleClearStepLog() {
    clearStepLog();
    setStepLog([]);
  }

  const abortRef      = useRef(null);
  const cardRef       = useRef(null);
  const cardMapRef    = useRef(null);
  const toastTimerRef = useRef(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // Register the PWA service worker with a needRefresh callback. We import
  // the virtual module dynamically so test/dev environments (where the
  // module doesn't exist) silently no-op instead of throwing.
  useEffect(() => {
    let cancelled = false;
    import(/* @vite-ignore */ "virtual:pwa-register")
      .then(({ registerSW }) => {
        if (cancelled || typeof registerSW !== "function") return;
        const updateSW = registerSW({
          onNeedRefresh() { if (!cancelled) setSwUpdateReady(true); },
        });
        swUpdateFnRef.current = updateSW;
      })
      .catch(() => { /* not in a PWA build (tests/dev) — no-op */ });
    return () => { cancelled = true; };
  }, []);

  function handleApplySwUpdate() {
    const fn = swUpdateFnRef.current;
    if (typeof fn === "function") fn(true); // skipWaiting + reload
    else window.location.reload();
  }

  // Auto-submit once on mount when the page loads with URL-encoded route params
  useEffect(() => {
    const p = initialUrlParams;
    if (p.stops?.length) {
      fetchRoute(p.stops);
    } else if (p.from && p.to) {
      fetchRoute([p.from, p.to]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleHeightChange = useCallback((ft, inches) => {
    const toNum = v => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
    setHeightFt(toNum(ft));
    setHeightIn(toNum(inches));
  }, []);

  const handleWeightChange = useCallback((kg) => {
    setWeightKg(kg);
  }, []);

  const handleGoalChange = useCallback((val) => {
    setDailyGoalState(val);
    if (val != null) safeSet("walkpath:dailyGoal", String(val));
    else             safeRemove("walkpath:dailyGoal");
  }, []);

  function handleSwap() {
    if (stops.some(s => !s.value.trim())) return;
    reverseStops();
  }

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
        // 429 (rate limiter) and 503 (circuit breaker, Bolt-On C) both signal
        // "geocoding is degraded — try again later." Prefer the backend's
        // structured detail.message when present so the breaker's friendly
        // "try a Chicago neighborhood name" copy comes through.
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

      // URL + recents reflect the submitted request — write them immediately,
      // before the min-loading delay holds the skeleton, so deep-link state is
      // correct even if the user navigates away mid-skeleton.
      const urlP = new URLSearchParams();
      if (multi) {
        // Encode each stop so a literal "|" inside a label can't be
        // misread as a separator on the receiving end (parseStopsParam
        // decodes per segment).
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
      // Only flip loading off if this fetch hasn't been superseded — keeps the
      // newer fetch's skeleton from being clobbered when an aborted one resolves.
      if (!signal.aborted) setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const cleaned = stopValues.map(v => v.trim());
    if (cleaned.some(v => !v)) return;
    await fetchRoute(cleaned);
  }

  // ── Explore-mode handlers ─────────────────────────────────────────────
  // Independent abort handle so the explorer's fetch lifecycle doesn't
  // collide with route fetches when the user toggles modes mid-request.
  const exploreAbortRef = useRef(null);
  useEffect(() => () => exploreAbortRef.current?.abort(), []);

  // Keep the latest origin/maxMinutes/cat selection in a ref so the slider's
  // onPointerUp callback doesn't capture stale values when the user drags
  // immediately after editing the area dropdown.
  const explorePrefsRef = useRef(explorePrefs);
  useEffect(() => { explorePrefsRef.current = explorePrefs; }, [explorePrefs]);

  // The /explore endpoint accepts top-level category keys only. Subcategories
  // affect *which pins draw on the map* but not the request itself; the
  // backend returns every place under a selected parent and the frontend
  // post-filters by subcategory in `activeSubs`.
  //
  // Empty selection → send a sentinel that no category matches. The backend's
  // category sanitizer collapses `[]` to "all categories" (it treats an empty
  // list as null), which would otherwise dump thousands of places onto the
  // map for a user who has selected nothing.
  const requestCategories = useMemo(() => {
    const fromCats = explorePrefs.selectedCategories;
    const fromSubs = explorePrefs.selectedSubs.map(k => k.split("/", 1)[0]);
    const merged = Array.from(new Set([...fromCats, ...fromSubs]));
    return merged.length === 0 ? ["__none__"] : merged;
  }, [explorePrefs.selectedCategories, explorePrefs.selectedSubs]);

  // The set of (category, subcategory) keys that should be visible on the
  // map. Includes parent-only entries (just the category key) when no sub
  // filter is in effect for that category, so `places_in_polygon` results
  // pass straight through.
  const activeSubsSet = useMemo(() => {
    const out = new Set();
    for (const c of explorePrefs.selectedCategories) out.add(c);
    for (const s of explorePrefs.selectedSubs) out.add(s);
    return out;
  }, [explorePrefs.selectedCategories, explorePrefs.selectedSubs]);

  const exploreCategoryStyles = useMemo(
    () => PIN_CATEGORIES.map(c => ({ key: c.key, color: c.color, glyph: c.glyph })),
    [],
  );

  const fetchExploreResult = useCallback(async (overrides = {}) => {
    const prefs = explorePrefsRef.current;
    const origin = overrides.origin ?? prefs.origin;
    const maxMinutes = overrides.maxMinutes ?? prefs.maxMinutes;
    const categories = overrides.categories ?? requestCategories;

    // Current-location origin requires lat/lon; if it's missing here,
    // surface a friendly hint instead of hitting the backend.
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

  // When the user picks "📍 My location" in ExploreForm, we resolve their
  // coordinates here and (on success) immediately re-fetch with the new origin.
  const handleExploreLocateMe = useCallback(async () => {
    setLocating(true);
    try {
      const loc = await resolveCurrentLocation();
      if (loc.error === "denied") {
        setExploreError("Location permission denied — pick a community area instead.");
        return;
      }
      if (loc.error === "outside_coverage") {
        setExploreError("You're outside the Chicago coverage area.");
        return;
      }
      if (loc.error) {
        setExploreError("Couldn't read your location — try a community area.");
        return;
      }
      const next = { kind: "current", communityArea: null, lat: loc.lat, lon: loc.lon };
      setExplorePrefs(p => ({ ...p, origin: next }));
      // Wait for the prefs ref to flush before firing — ref update is sync,
      // but use the explicit override so we don't race.
      explorePrefsRef.current = { ...explorePrefsRef.current, origin: next };
      fetchExploreResult({ origin: next });
    } finally {
      setLocating(false);
    }
  }, [fetchExploreResult]);

  // First entry into explore mode → fire an initial fetch so the user sees
  // an isochrone immediately on switch (no "click Discover to see anything"
  // dead state). Re-fires when the user changes origin via the form.
  useEffect(() => {
    if (mode !== "explore") return;
    if (exploreResult) return;
    if (exploreLoading) return;
    fetchExploreResult();
    // Intentional: only run on mode-flip-into-explore + when result is empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Re-fetch when category selection changes (so the place pins refresh).
  // Origin / maxMinutes changes go through the explicit submit button OR the
  // slider release callback so we don't spam the backend on every drag tick.
  useEffect(() => {
    if (mode !== "explore") return;
    if (!exploreResult) return; // initial-fetch effect above will handle it
    fetchExploreResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestCategories.join("|")]);

  function handleExploreOriginChange(nextOrigin) {
    setExplorePrefs(p => ({ ...p, origin: nextOrigin }));
    if (nextOrigin.kind === "community_area") {
      // Community-area picks have a deterministic centroid → fetch immediately.
      explorePrefsRef.current = { ...explorePrefsRef.current, origin: nextOrigin };
      fetchExploreResult({ origin: nextOrigin });
    }
  }

  function handleExploreMaxMinutesChange(next) {
    setExplorePrefs(p => ({ ...p, maxMinutes: next }));
  }

  // Slider release / "Discover" button.
  function handleExploreSubmit() {
    fetchExploreResult();
  }

  function handleToggleGroup(groupKey) {
    setExplorePrefs(p => {
      const set = new Set(p.expandedGroups);
      if (set.has(groupKey)) set.delete(groupKey);
      else set.add(groupKey);
      return { ...p, expandedGroups: Array.from(set) };
    });
  }

  function handleToggleCategory(catKey) {
    setExplorePrefs(p => {
      const set = new Set(p.selectedCategories);
      if (set.has(catKey)) set.delete(catKey);
      else set.add(catKey);
      // When unchecking the parent, also drop all of its subs.
      let nextSubs = p.selectedSubs;
      if (!set.has(catKey)) {
        nextSubs = nextSubs.filter(s => !s.startsWith(`${catKey}/`));
      }
      return { ...p, selectedCategories: Array.from(set), selectedSubs: nextSubs };
    });
  }

  function handleToggleSub(catKey, subKey) {
    setExplorePrefs(p => {
      const fullKey = `${catKey}/${subKey}`;
      const subSet = new Set(p.selectedSubs);
      if (subSet.has(fullKey)) subSet.delete(fullKey);
      else subSet.add(fullKey);
      // Promote the parent to checked the moment any sub is checked, so the
      // request includes that category at all (the backend filters by parent).
      const catSet = new Set(p.selectedCategories);
      if (subSet.has(fullKey)) catSet.add(catKey);
      return {
        ...p,
        selectedCategories: Array.from(catSet),
        selectedSubs: Array.from(subSet),
      };
    });
  }

  function handleToggleHeatmap(e) {
    const checked = !!(e?.target?.checked);
    setExplorePrefs(p => ({ ...p, showResidentialHeatmap: checked }));
  }

  function handleSelectAllCategories() {
    setExplorePrefs(p => ({
      ...p,
      // All pin-style categories get selected at the parent level. Subs are
      // intentionally cleared — sub-filters are an opt-in narrowing tool, so
      // "Select all" lands the user on every category at full breadth.
      selectedCategories: PIN_CATEGORIES.map(c => c.key),
      selectedSubs: [],
      showResidentialHeatmap: true,
    }));
  }

  function handleClearAllCategories() {
    setExplorePrefs(p => ({
      ...p,
      selectedCategories: [],
      selectedSubs: [],
      showResidentialHeatmap: false,
    }));
  }

  // Mobile only: when a place pin is tapped, drop the sheet to peek so
  // the MapLibre popup over the pin isn't clipped under the sheet body.
  // Doesn't write to userMovedSheetRef — this is a programmatic, ephemeral
  // move that should NOT poison the auto-promote logic for future fetches.
  const handlePlaceTap = useCallback(() => {
    if (!isMobile) return;
    setSheetSnap(0);
  }, [isMobile]);

  // "Walk here" from a place popover → flip back to route mode and fire a
  // route fetch from the explorer's origin to the clicked place.
  const handlePlaceWalkHere = useCallback(({ lat, lon, name, address }) => {
    const originName = explorePrefsRef.current.origin.kind === "community_area"
      ? explorePrefsRef.current.origin.communityArea
      : "My location";
    const destName = name || address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    setMode("route");
    setStops([
      { id: makeStopId(), value: originName },
      { id: makeStopId(), value: destName },
    ]);
    fetchRoute([originName, destName]);
  }, [setMode]);

  // Reachable-neighborhood chip → same pattern: route from the explorer's
  // origin to the clicked neighborhood.
  const handleNeighborhoodChip = useCallback((neighborhoodName) => {
    const originName = explorePrefsRef.current.origin.kind === "community_area"
      ? explorePrefsRef.current.origin.communityArea
      : "My location";
    setMode("route");
    setStops([
      { id: makeStopId(), value: originName },
      { id: makeStopId(), value: neighborhoodName },
    ]);
    fetchRoute([originName, neighborhoodName]);
  }, [setMode]);

  function handleRecentSelect(item) {
    const itemStops = recentEntryStops(item);
    if (!itemStops.length) return;
    setStops(itemStops.map(v => ({ id: makeStopId(), value: v })));
    fetchRoute(itemStops);
  }

  function handleClearRecent() {
    safeRemove(RECENT_KEY);
    setRecentSearches([]);
  }

  // ── Share card ────────────────────────────────────────────────────────────

  function handleOpenShare() {
    setCardMapReady(false);
    setShowShareModal(true);
  }

  function handleCloseShare() {
    setShowShareModal(false);
    setCardMapReady(false);
  }

  const handleCardMapReady = useCallback(() => setCardMapReady(true), []);

  // Deep-link URL for the rendered route — same encoding the routing path
  // uses when it writes window.history (see fetchRoute), so receivers re-hit
  // /route with identical stops + height.
  const shareUrl = useMemo(() => {
    if (typeof window === "undefined" || !viewResult) return "";
    const stopsArr = Array.isArray(viewResult.stops) && viewResult.stops.length >= 2
      ? viewResult.stops
      : stopValues.map(v => v.trim()).filter(Boolean);
    if (stopsArr.length < 2) return window.location.origin + "/";
    const params = new URLSearchParams();
    if (stopsArr.length > 2) {
      params.set("stops", stopsArr.map(encodeURIComponent).join("|"));
    } else {
      params.set("from", stopsArr[0]);
      params.set("to", stopsArr[1]);
    }
    if (heightFt !== null) params.set("hft", String(heightFt));
    if (heightIn !== null) params.set("hin", String(heightIn));
    return `${window.location.origin}/?${params.toString()}`;
  }, [viewResult, stopValues, heightFt, heightIn]);

  // Hostname only — printed onto the share card as a tasteful "plan yours
  // at …" line. The full URL with stops travels via Web Share / clipboard.
  const siteHost = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.host.replace(/^www\./i, "");
  }, []);

  const shareCaption = useMemo(() => {
    if (!viewResult) return "";
    const steps = viewResult.total_steps?.toLocaleString?.() ?? viewResult.total_steps;
    return `From ${origin} to ${destination} — ${steps} steps with Passage.`;
  }, [viewResult, origin, destination]);

  async function handleShareCard() {
    if (!cardRef.current) return;
    let overlay = null;
    try {
      const { toBlob } = await import("html-to-image");

      // iOS Safari can clear the WebGL backbuffer between MapLibre's `idle`
      // and the moment html-to-image reads canvas.toDataURL() during clone,
      // even with preserveDrawingBuffer:true — producing a blank map in the
      // exported PNG. Snapshot the map ourselves and overlay an <img> so the
      // clone picks up a stable raster instead of the live canvas.
      const map = cardMapRef.current;
      if (map) {
        await new Promise(resolve => {
          map.once("render", resolve);
          map.triggerRepaint();
        });
        const mapDataUrl = map.getCanvas().toDataURL("image/png");
        overlay = document.createElement("img");
        overlay.src = mapDataUrl;
        overlay.style.position = "absolute";
        overlay.style.inset = "0";
        overlay.style.width = "100%";
        overlay.style.height = "100%";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "10";
        map.getContainer().appendChild(overlay);
      }

      // Force the editorial 480px design width during capture so the PNG
      // doesn't reflow narrower on phones — the visible card stays unchanged
      // because html-to-image applies the style override only to its DOM
      // clone. No-op when the visible card is already at design width.
      const visibleWidth = cardRef.current.getBoundingClientRect().width;
      const captureOpts = { pixelRatio: 3 };
      if (visibleWidth < 480) {
        captureOpts.style = { width: "480px", maxWidth: "480px" };
      }
      const blob = await toBlob(cardRef.current, captureOpts);
      if (!blob) throw new Error("PNG capture returned no data");

      const slugStops = stopValues.map(v => v.trim()).filter(Boolean);
      const slugSource = slugStops.length >= 2 ? slugStops.join("-to-") : `${origin}-to-${destination}`;
      const slug = slugSource.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const filename = `walk-${slug}.png`;

      // Prefer the native share sheet — it bundles the card image with a
      // clickable link back to Passage, which is the whole point of this
      // flow. Falls through to download on browsers without file-share
      // support (most desktops).
      const file = new File([blob], filename, { type: "image/png" });
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        try {
          await navigator.share({
            files: [file],
            url: shareUrl || undefined,
            title: "Passage",
            text: shareCaption,
          });
          return;
        } catch (err) {
          // User dismissed the share sheet — silently bail.
          if (err?.name === "AbortError") return;
          // Other share failures (NotAllowedError, etc.) fall through to
          // download so the user still walks away with something.
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error("[RouteCard] PNG capture failed:", err);
      showToast("Couldn't render the card. Please try again.");
    } finally {
      overlay?.remove();
    }
  }

  async function handleCopyShareLink() {
    if (!shareUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        // Fallback for browsers without async clipboard (older Safari, some
        // in-app webviews). A throwaway textarea + execCommand is the
        // canonical workaround.
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      showToast("Link copied — share it anywhere.");
    } catch (err) {
      console.error("[RouteCard] Copy link failed:", err);
      showToast("Couldn't copy the link. Try long-pressing the URL.");
    }
  }

  // ── Pick on map ───────────────────────────────────────────────────────────

  function handlePickToggle(stopId) {
    setPickMode(prev => prev === stopId ? null : stopId);
  }

  const resolveStopLabel = useCallback(async (lat, lon) => {
    try {
      const res = await fetchWithTimeout(
        `${BACKEND_URL}/reverse-geocode?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`,
      );
      const data = await res.json();
      if (res.ok && typeof data?.label === "string") {
        return data.label.trim().slice(0, 200) || null;
      }
    } catch { /* network or parse failure — caller falls back to coords */ }
    return null;
  }, []);

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(""), 3500);
  }, []);

  // "Use my current location" — populates the first empty stop, or the origin
  // if every stop already has a value. Coverage gating + permission classification
  // live in lib/geolocation.js. The reverse-geocode step mirrors handleMapPick:
  // success → label; failure → coords truncated to 5 decimals.
  const handleLocateMe = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    try {
      const loc = await resolveCurrentLocation();
      if (loc.error === "denied") {
        showToast("Location permission denied — try typing a stop instead.");
        return;
      }
      if (loc.error === "outside_coverage") {
        showToast("You're outside the Chicago coverage area.");
        return;
      }
      if (loc.error) {
        showToast("Couldn't read your location — try typing a stop instead.");
        return;
      }
      const { lat, lon } = loc;
      const target = stops.find(s => !s.value.trim()) ?? stops[0];
      if (!target) return;
      const label = await resolveStopLabel(lat, lon);
      if (label) {
        setStopValue(target.id, label);
      } else {
        setStopValue(target.id, `${lat.toFixed(5)}, ${lon.toFixed(5)}`);
        showToast("That spot has no name we know — using coordinates.");
      }
    } finally {
      setLocating(false);
    }
  }, [locating, stops, resolveStopLabel, showToast]);

  const handleMapPick = useCallback((lat, lon, label) => {
    const targetId = pickMode; // capture before clearing
    setPickMode(null);
    if (!targetId) return;

    if (label) {
      setStopValue(targetId, label);
    } else {
      setStopValue(targetId, `${lat.toFixed(5)}, ${lon.toFixed(5)}`);
      setToastMsg("That spot has no name we know — using coordinates.");
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToastMsg(""), 3500);
    }
  }, [pickMode]);

  // ── Mode toggle (Route ⇄ Explore) ────────────────────────────────────
  // Two-button segmented control that lives at the top of the side panel
  // (desktop) and at the top of the mobile sheet body (mobile). Same JSX
  // in both surfaces so a flip in one updates the other immediately.
  const modeToggle = (
    <div className="mode-toggle" role="tablist" aria-label="Walk planning mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "route"}
        className={`mode-toggle-btn${mode === "route" ? " mode-toggle-btn--active" : ""}`}
        onClick={() => setMode("route")}
      >
        <WPIcon name="stride" size={14} />
        <span>Route</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "explore"}
        className={`mode-toggle-btn${mode === "explore" ? " mode-toggle-btn--active" : ""}`}
        onClick={() => setMode("explore")}
      >
        <WPIcon name="crosshair" size={14} />
        <span>Explore</span>
      </button>
    </div>
  );

  // Explore-mode content: the form (origin selector + slider + chips) plus
  // the category panel. Slotted into the same desktop / mobile shells as
  // the route form so layout differences come from the wrapping CSS only.
  const exploreContents = (
    <>
      {modeToggle}
      <ExploreForm
        origin={explorePrefs.origin}
        onOriginChange={handleExploreOriginChange}
        maxMinutes={explorePrefs.maxMinutes}
        onMaxMinutesChange={handleExploreMaxMinutesChange}
        onSubmit={handleExploreSubmit}
        loading={exploreLoading}
        reachableNeighborhoods={exploreResult?.reachable_neighborhoods}
        onChipClick={handleNeighborhoodChip}
        onLocateMe={handleExploreLocateMe}
        locating={locating}
        geoError={exploreError}
      />
      {exploreError && (
        <div className="explore-error" role="alert">
          {exploreError}
        </div>
      )}
      {exploreResult && (
        <div className="explore-result-summary">
          <div className="explore-result-stat">
            <span className="explore-result-stat-num">
              {exploreResult.stats?.area_sq_mi ?? "—"}
            </span>
            <span className="explore-result-stat-unit">sq mi</span>
          </div>
          <div className="explore-result-stat">
            <span className="explore-result-stat-num">
              {exploreResult.places?.length ?? 0}
            </span>
            <span className="explore-result-stat-unit">places shown</span>
          </div>
        </div>
      )}
      <ExploreCategoryPanel
        selectedCategories={explorePrefs.selectedCategories}
        selectedSubs={explorePrefs.selectedSubs}
        expandedGroups={explorePrefs.expandedGroups}
        showResidentialHeatmap={explorePrefs.showResidentialHeatmap}
        onToggleGroup={handleToggleGroup}
        onToggleCategory={handleToggleCategory}
        onToggleSub={handleToggleSub}
        onToggleHeatmap={handleToggleHeatmap}
        onSelectAll={handleSelectAllCategories}
        onClearAll={handleClearAllCategories}
      />
    </>
  );

  // Form, results, and directions — composed once and slotted into either
  // the desktop two-column layout or the mobile bottom sheet so the JSX
  // (and React state-tree identity) stays the same in both surfaces.
  const routeContents = (
    <>
      {modeToggle}
      <form className="form" onSubmit={handleSubmit}>
        <div className="stops-group">
          {stops.map((stop, i) => {
            const isFirst = i === 0;
            const isLast  = i === stops.length - 1;
            const label   = isFirst
              ? "Origin"
              : isLast
                ? "Destination"
                : `Stop ${i}`;
            const placeholder = isFirst
              ? "e.g. Wrigleyville, 600 N Clark St"
              : isLast
                ? "e.g. Logan Square, Navy Pier"
                : "Add a stop along the way";
            const canRemove = stops.length > 2;
            return (
              <div className="stop-row" key={stop.id}>
                <span className="stop-row-label">{label}</span>
                <button
                  type="button"
                  className={`pick-map-btn${pickMode === stop.id ? " pick-map-btn--active" : ""}`}
                  onClick={() => handlePickToggle(stop.id)}
                  title={pickMode === stop.id ? "Cancel pick" : "Set point on map"}
                  aria-label={pickMode === stop.id ? "Cancel pick mode" : `Set ${label} by clicking map`}
                >
                  <WPIcon name="crosshair" size={14} />
                </button>
                <input
                  type="search"
                  placeholder={placeholder}
                  value={stop.value}
                  onChange={e => setStopValue(stop.id, e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="words"
                  enterKeyHint={isLast ? "go" : "next"}
                  aria-label={label}
                />
                {canRemove && (
                  <div className="stop-row-actions">
                    <button
                      type="button"
                      className="stop-move-btn"
                      onClick={() => moveStop(stop.id, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${label} up`}
                      title="Move up"
                    >
                      <WFIcon name="chevron-up" size={14} />
                    </button>
                    <button
                      type="button"
                      className="stop-move-btn"
                      onClick={() => moveStop(stop.id, 1)}
                      disabled={isLast}
                      aria-label={`Move ${label} down`}
                      title="Move down"
                    >
                      <WFIcon name="chevron-down" size={14} />
                    </button>
                    <button
                      type="button"
                      className="stop-remove-btn"
                      onClick={() => removeStop(stop.id)}
                      aria-label={`Remove ${label}`}
                      title="Remove stop"
                    >
                      <WFIcon name="x" size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <div className="stops-controls">
            <button
              type="button"
              className="add-stop-btn"
              onClick={addStop}
              disabled={stops.length >= MAX_STOPS}
              aria-label="Add another stop"
            >
              {stops.length >= MAX_STOPS ? (
                `Maximum ${MAX_STOPS} stops`
              ) : (
                <span className="add-stop-btn-inner">
                  <WFIcon name="plus" size={14} />
                  Add stop
                </span>
              )}
            </button>
            <button
              type="button"
              className="swap-btn"
              onClick={handleSwap}
              aria-label="Reverse stops"
              title="Reverse the order of all stops"
              disabled={stops.some(s => !s.value.trim())}
            >
              <span className="swap-btn-inner">
                <WPIcon name="swap" size={14} />
                Reverse
              </span>
            </button>
          </div>
        </div>

        <button
          type="button"
          className="personalize-trigger"
          onClick={() => setPersonalizeOpen(true)}
        >
          <span className="personalize-trigger-eyebrow">Personalize</span>
          <span className="personalize-trigger-summary">
            {(() => {
              const parts = [];
              if (heightFt != null && heightIn != null) parts.push(`${heightFt}′ ${heightIn}″`);
              if (weightKg != null) parts.push(`${Math.round(weightKg * 2.20462)} lb`);
              if (dailyGoal != null) parts.push(`${dailyGoal.toLocaleString()} step measure`);
              return parts.length > 0
                ? parts.join(", ") + " ▸"
                : "Add your particulars for a more honest count ▸";
            })()}
          </span>
        </button>

        <PaceSelector
          pace={walkPace}
          onChange={setWalkPace}
        />

        <fieldset className="access-prefs">
          <legend>Considerations</legend>
          <WFCheck
            checked={avoidStairs}
            onChange={e => setAvoidStairs(e.target.checked)}
            label="Avoid stairs and steep ascents"
          />
          <WFCheck
            checked={preferPedestrian}
            onChange={e => setPreferPedestrian(e.target.checked)}
            label="Prefer pedestrian ways and footpaths"
          />
        </fieldset>

        <button
          type="submit"
          className="btn-route"
          disabled={loading}
        >
          <WPIcon name="stride" size={16} />
          {loading ? "Plotting your route…" : "Commence the journey"}
        </button>
      </form>

      <RecentSearches
        searches={recentSearches}
        onSelect={handleRecentSelect}
        onClear={handleClearRecent}
      />

      <WeeklySummaryPanel
        log={stepLog}
        dailyGoal={dailyGoal}
        onClear={handleClearStepLog}
      />

      {error && (
        <ErrorDispatch
          error={error}
          onRetry={() => {
            const cleaned = stopValues.map(v => v.trim());
            if (cleaned.some(v => !v)) return;
            fetchRoute(cleaned);
          }}
        />
      )}

      {loading && <LoadingSkeleton />}

      {viewResult && !loading && (
        <RouteErrorBoundary>
          {!isMultiStop && (
            <RouteFlavorTabs
              routes={result.routes}
              activeFlavor={activeFlavor}
              onChange={setActiveFlavor}
            />
          )}
          {isMultiStop && (
            <div className="multi-stop-note" role="note">
              Multi-stop walks use the fastest path. Alternatives (fewest turns, greenest) are offered for two-stop walks.
            </div>
          )}

          <StepHero result={viewResult} dailyGoal={dailyGoal} onShare={handleOpenShare} />

          <CompareDispatch
            miles={viewResult.total_miles}
            walkMinutes={viewResult.total_minutes}
            calories={viewResult.calories_approx}
          />

          <button
            type="button"
            className={`log-walk-btn${walkLogged ? " log-walk-btn--logged" : ""}`}
            onClick={handleLogWalk}
            disabled={walkLogged}
            aria-label={walkLogged ? "Walk logged" : "Log this walk"}
          >
            {walkLogged
              ? <><WFIcon name="check" size={14} /> Logged this walk</>
              : <><WFIcon name="plus" size={14} /> Log this walk</>}
          </button>

          <div className="motivation">
            {motivationMessage(viewResult.total_steps)}
          </div>

          <DirectionLedger
            directions={viewResult.directions}
            result={viewResult}
            activeTurnIndex={activeTurnIndex}
            onStepClick={setActiveTurnIndex}
            legs={isMultiStop ? (result.legs ?? null) : null}
            formatDirectionsText={formatDirectionsText}
          />
        </RouteErrorBoundary>
      )}
    </>
  );

  const sidebarContents = mode === "explore" ? exploreContents : routeContents;

  const mapNode = (
    <Suspense fallback={<div className="map-lazy-fallback" aria-hidden="true" />}>
      <MapView
        result={viewResult}
        turnCoords={turnCoords}
        activeTurnIndex={activeTurnIndex}
        pickMode={pickMode}
        onPickPoint={handleMapPick}
        resolveLabel={resolveStopLabel}
        onLocateMe={handleLocateMe}
        locating={locating}
        mapPadding={isMobile ? mapPadding : null}
        mode={mode}
        exploreResult={mode === "explore" ? exploreResult : null}
        categoryStyles={exploreCategoryStyles}
        activeSubs={activeSubsSet}
        showResidential={explorePrefs.showResidentialHeatmap}
        onPlaceWalkHere={handlePlaceWalkHere}
        onPlaceTap={handlePlaceTap}
      />
    </Suspense>
  );

  return (
    <div className={`app paper-grain${isMobile ? " app--mobile" : ""}${isTablet ? " app--tablet" : ""}`}>
      {isMobile ? (
        <MobileLayout
          masthead={<Masthead compact onSettings={() => setPersonalizeOpen(true)} />}
          map={mapNode}
          snap={sheetSnap}
          onSnapChange={handleSheetSnapChange}
          onObscuredChange={handleObscuredChange}
        >
          <main className="main main--mobile">
            {sidebarContents}
          </main>
        </MobileLayout>
      ) : (
        <>
          <Masthead />
          <div className="layout">
            <div className="panel-cards">
              <main className="main">
                {sidebarContents}
              </main>
            </div>
            <div className="panel-map">
              {mapNode}
            </div>
          </div>
          <Footer />
        </>
      )}

      <PersonalizeModal
        open={personalizeOpen}
        onClose={() => setPersonalizeOpen(false)}
        heightFt={heightFt}
        heightIn={heightIn}
        weightKg={weightKg}
        dailyGoal={dailyGoal}
        onChangeHeight={handleHeightChange}
        onChangeWeight={handleWeightChange}
        onChangeGoal={handleGoalChange}
      />

      {/* ── Share modal ── */}
      {showShareModal && viewResult && (
        <div
          className="share-modal-overlay"
          onClick={handleCloseShare}
          role="dialog"
          aria-modal="true"
          aria-label="Share route card"
        >
          <div className="share-modal" onClick={e => e.stopPropagation()}>
            <div className="share-modal-header">
              <span className="share-modal-title">Route Card</span>
              <button
                type="button"
                className="share-modal-close"
                onClick={handleCloseShare}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="share-modal-card-wrap">
              <Suspense fallback={<div className="share-card-lazy-fallback" aria-hidden="true" />}>
                <ShareDispatch
                  ref={cardRef}
                  result={viewResult}
                  originLabel={origin}
                  destLabel={destination}
                  onMapReady={handleCardMapReady}
                  mapInstanceRef={cardMapRef}
                  siteHost={siteHost}
                />
              </Suspense>
            </div>
            <div className="share-modal-actions">
              <button
                type="button"
                className="share-download-btn"
                disabled={!cardMapReady}
                onClick={handleShareCard}
              >
                {!cardMapReady
                  ? "Rendering map…"
                  : canWebShare ? "⬆ Share" : "⬇ Download PNG"}
              </button>
              <button
                type="button"
                className="share-link-btn"
                disabled={!shareUrl}
                onClick={handleCopyShareLink}
              >
                ⧉ Copy link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toastMsg && (
        <div className="toast" role="status" aria-live="polite">
          {toastMsg}
        </div>
      )}

      {/* ── SW update banner ── */}
      {swUpdateReady && (
        <div className="sw-update-banner" role="status" aria-live="polite">
          <span>A new edition is ready.</span>
          <button
            type="button"
            className="sw-update-btn"
            onClick={handleApplySwUpdate}
          >
            Refresh
          </button>
          <button
            type="button"
            className="sw-update-dismiss"
            onClick={() => setSwUpdateReady(false)}
            aria-label="Dismiss update notice"
          >
            ×
          </button>
        </div>
      )}

    </div>
  );
}
