import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import "./App.css";

// MapView and ShareDispatch both pull in maplibre-gl (~290 KB gzip). Lazy-load
// both so the initial bundle stays form-only — see FEATURE_HISTORY entry
// "Code-splitting MapView for faster cold-load".
const MapView = lazy(() => import("./MapView.jsx"));
const ShareDispatch = lazy(() =>
  import("./components/ShareDispatch.jsx").then(m => ({ default: m.ShareDispatch }))
);

import {
  safeRemove,
  loadSessionJSON, saveSessionJSON, safeSessionRemove,
} from "./lib/storage.js";
import {
  loadMobilityOverrideDismissed, saveMobilityOverrideDismissed,
} from "./lib/personaPrefs.js";
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
import { StepHero } from "./components/StepHero.jsx";
import { RecentSearches } from "./components/RecentSearches.jsx";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary.jsx";
import { ExploreErrorBoundary } from "./components/ExploreErrorBoundary.jsx";
import { MapErrorBoundary } from "./components/MapErrorBoundary.jsx";
import { useMediaQuery } from "./lib/useMediaQuery.js";
import { useViewportStable } from "./lib/useViewportStable.js";
import { loadSheetSnap } from "./lib/sheetSnap.js";
import { resolveCurrentLocation } from "./lib/geolocation.js";
import { WPIcon } from "./wayfarer/walkpath-icons.jsx";
import { WFIcon } from "./wayfarer/icons.jsx";
import { useTurnCoords } from "./hooks/useTurnCoords.js";
import { useShareCard } from "./hooks/useShareCard.js";
import { BACKEND_URL } from "./lib/backendUrl.js";
import { fetchWithTimeout } from "./lib/fetchWithTimeout.js";
import { MAX_STOPS, readUrlParams } from "./lib/urlParams.js";
import { motivationMessage, formatDirectionsText } from "./lib/routeFormat.js";
import { RECENT_KEY, recentEntryStops } from "./lib/recentSearches.js";
import { loadStepLog, logWalk, clearStepLog, pruneStoredStepLog } from "./lib/stepLog.js";
import { ExploreForm } from "./components/ExploreForm.jsx";
import { ExploreCategoryPanel } from "./components/ExploreCategoryPanel.jsx";
import { AddressAutocomplete } from "./components/AddressAutocomplete.jsx";
import { fetchAutocomplete } from "./lib/autocompleteApi.js";
import { formatLatLonLabel } from "./lib/coordsFormat.js";
import { MQ_MOBILE, MQ_TABLET } from "./lib/useMediaQuery.js";
import {
  loadMode, saveMode,
  loadExplorePrefs, saveExplorePrefs,
  EXPLORE_DEFAULTS,
  HEATMAP_LAYERS,
} from "./lib/explorePrefs.js";
import { PIN_CATEGORIES } from "./lib/exploreCategories.js";

// PIN_CATEGORIES is a frozen module-level export. Project its pin-paint
// fields once at import time so App doesn't pay a per-instance useMemo
// cache cell for data fully known at module load.
const EXPLORE_CATEGORY_STYLES = PIN_CATEGORIES.map(c => ({
  key: c.key, color: c.color, glyph: c.glyph,
}));

import { usePersonalization } from "./hooks/usePersonalization.js";
import { useRouteFetch } from "./hooks/useRouteFetch.js";
import { useExploreFetch } from "./hooks/useExploreFetch.js";
import { useFollowLocation } from "./hooks/useFollowLocation.js";

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

// Toast auto-dismiss delay. Used by both the explicit `showToast` helper and
// the inline pick-on-map fallback toast — kept in one place so they stay in
// sync.
const TOAST_DURATION_MS = 3500;

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
  // Parse URL params once on mount; downstream initializers and the auto-fetch
  // effect read from this ref instead of re-parsing.
  const initialUrlParamsRef = useRef(null);
  if (initialUrlParamsRef.current === null) initialUrlParamsRef.current = readUrlParams();
  const initialUrlParams = initialUrlParamsRef.current;

  const [stops, setStops] = useState(() => {
    // Priority: URL params (shareable links) > sessionStorage draft > empty.
    // The sessionStorage path catches a PWA SW reload mid-edit.
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

  // Memoized so downstream consumers (useShareCard's shareUrl + handleShareCard
  // memos) get a referentially stable array across re-renders that don't
  // actually change the stop list. Without this, unrelated state churn (modal
  // open, loading flips) would invalidate the share-card memos every render.
  const stopValues = useMemo(() => stops.map(s => s.value), [stops]);
  const origin      = stops[0]?.value ?? "";
  const destination = stops[stops.length - 1]?.value ?? "";
  const isMultiStop = stops.length > 2;

  // OPT-037: handlers use functional state updates so their closures don't
  // capture mutable values — empty deps keep the references stable across
  // every render so the memoized sidebar contents below (OPT-036) can hit
  // their useMemo cache when nothing else changed.
  const setStopValue = useCallback((id, value) => {
    setStops(prev => prev.map(s => s.id === id ? { ...s, value } : s));
  }, []);
  const addStop = useCallback(() => {
    setStops(prev => prev.length >= MAX_STOPS
      ? prev
      : [...prev.slice(0, -1), { id: makeStopId(), value: "" }, prev[prev.length - 1]]
    );
  }, []);
  const removeStop = useCallback((id) => {
    setStops(prev => prev.length <= 2 ? prev : prev.filter(s => s.id !== id));
  }, []);
  const moveStop = useCallback((id, delta) => {
    setStops(prev => {
      const idx = prev.findIndex(s => s.id === id);
      const target = idx + delta;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  // ── Personalization ────────────────────────────────────────────────────
  const {
    heightFt, heightIn, weightKg, dailyGoal, walkPace,
    avoidStairs, preferPedestrian, mobilityProfile,
    setWalkPace, setAvoidStairs, setPreferPedestrian, setMobilityProfile,
    handleHeightChange, handleWeightChange, handleGoalChange,
  } = usePersonalization(initialUrlParams);
  const isWheeled = mobilityProfile === "wheeled";

  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  const [mobilityOverrideDismissed, setMobilityOverrideDismissed] = useState(loadMobilityOverrideDismissed);
  const handleDismissMobilityOverride = useCallback(() => {
    saveMobilityOverrideDismissed();
    setMobilityOverrideDismissed(true);
  }, []);
  // Render the notice only when wheeled has forced stairs avoidance on top of
  // a saved Walking preference that disagreed — silent otherwise.
  const showMobilityOverrideNotice =
    isWheeled && !avoidStairs && !mobilityOverrideDismissed;

  // Switching to Wheeled defaults prefer_pedestrian on (user can still toggle
  // it off afterwards). avoid_stairs is forced on in useRouteFetch — the
  // persisted accessPrefs value is intentionally left untouched so a flip
  // back to Walking restores the user's saved choice.
  const handleMobilityProfileChange = useCallback((next) => {
    setMobilityProfile(next);
    if (next === "wheeled" && !preferPedestrian) setPreferPedestrian(true);
  }, [setMobilityProfile, setPreferPedestrian, preferPedestrian]);

  // Persist stop drafts to sessionStorage so a SW-triggered reload (or a
  // normal refresh) restores what the user was typing. The save is debounced
  // (~250 ms) — without it, JSON.stringify + storage write would fire on every
  // keystroke. The empty-clear branch stays synchronous so removing all stops
  // wipes the storage entry immediately rather than leaving a stale draft
  // around for the debounce window.
  const stopDraftTimerRef = useRef(null);
  useEffect(() => {
    const values = stops.map(s => s.value);
    if (values.every(v => !v.trim())) {
      if (stopDraftTimerRef.current) {
        clearTimeout(stopDraftTimerRef.current);
        stopDraftTimerRef.current = null;
      }
      safeSessionRemove(STOPS_KEY);
      return;
    }
    if (stopDraftTimerRef.current) clearTimeout(stopDraftTimerRef.current);
    stopDraftTimerRef.current = setTimeout(() => {
      stopDraftTimerRef.current = null;
      saveStoredStops(values);
    }, 250);
    return () => {
      if (stopDraftTimerRef.current) {
        clearTimeout(stopDraftTimerRef.current);
        stopDraftTimerRef.current = null;
      }
    };
  }, [stops]);

  // ── Mode and Explore prefs ─────────────────────────────────────────────
  // A shared route URL (?stops=… or ?from=…&to=…) forces route mode at boot
  // so the link recipient sees the route the sender intended.
  const _hasRouteParams = !!(initialUrlParams.stops?.length
    || (initialUrlParams.from && initialUrlParams.to));
  const [mode, setModeState] = useState(() =>
    _hasRouteParams ? "route" : loadMode(),
  );
  const [explorePrefs, setExplorePrefs] = useState(loadExplorePrefs);
  const setMode = useCallback((next) => {
    setModeState(next);
    saveMode(next);
    // Pick-on-map is route-only — the toggle button only renders inside
    // buildRouteContents, so leaving Route mode with pickMode set would
    // strand the user with a click-to-drop-pin handler and a Confirm card
    // floating over the Explorer's polygon. Clear it on every transition.
    if (next !== "route") setPickMode(null);
  }, []);
  // OPT-055: debounce the explorePrefs save. Each category / sub /
  // heatmap toggle rewrites the same localStorage key synchronously;
  // rapid toggling (the explore panel invites it) was firing 5-10
  // writes per second. A 300 ms trailing-edge debounce collapses those
  // into one write. The `beforeunload` flush guarantees prefs persist
  // before navigation even if the timer hasn't fired — and uses a ref
  // for the latest prefs so the listener doesn't capture stale state.
  const explorePrefsLatestRef = useRef(explorePrefs);
  useEffect(() => { explorePrefsLatestRef.current = explorePrefs; }, [explorePrefs]);
  useEffect(() => {
    const id = setTimeout(() => saveExplorePrefs(explorePrefs), 300);
    return () => clearTimeout(id);
  }, [explorePrefs]);
  useEffect(() => {
    const flush = () => saveExplorePrefs(explorePrefsLatestRef.current);
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  // ── Route fetch ────────────────────────────────────────────────────────
  const {
    result, loading, error,
    recentSearches, setRecentSearches,
    fetchRoute, fetchRouteRef,
  } = useRouteFetch({
    heightFt, heightIn, weightKg, dailyGoal, walkPace, avoidStairs, preferPedestrian,
    mobilityProfile,
    initialUrlParams,
  });

  // ── Explore fetch ──────────────────────────────────────────────────────
  const {
    exploreResult, exploreLoading, exploreError, setExploreError,
    fetchExploreResult, explorePrefsRef,
  } = useExploreFetch({ mode, explorePrefs });

  // ── Remaining local state ──────────────────────────────────────────────
  const [stepLog, setStepLog]               = useState(loadStepLog);
  // Compact the persisted step log once on mount — drops entries beyond
  // the 7-day TTL and writes the trimmed list back. Kept out of
  // `loadStepLog` so the lazy state initializer stays read-only (it
  // double-fires in StrictMode dev).
  useEffect(() => {
    const pruned = pruneStoredStepLog();
    setStepLog(prev => prev.length === pruned.length ? prev : pruned);
  }, []);
  const [walkLogged, setWalkLogged]         = useState(false);
  const [activeTurnIndex, setActiveTurnIndex] = useState(null);
  const [pickMode, setPickMode]             = useState(null); // stop id | null
  const [locating, setLocating]             = useState(false);
  // Follow my location — continuous watchPosition + auto-recenter. The
  // watchPosition subscription only runs while `following === true` (the
  // user toggled the follow button), so `enabled` just controls whether a
  // flip in flight forces a teardown. F-09: gate on `mode === "explore"`
  // so a follow session active in Explore mode releases its subscription
  // on a flip to Route — follow is conceptually an Explore-mode feature
  // (the user wants to see where they are within their walkshed), and
  // Route mode has its own route-specific recenter affordances.
  const followLocation = useFollowLocation({ enabled: mode === "explore" });
  const [toastMsg, setToastMsg]             = useState("");
  const [activeFlavor, setActiveFlavor]     = useState("fastest");
  // SW update prompt. With registerType: "prompt" in vite.config.js, a new
  // service worker waits for our OK before activating.
  const [swUpdateReady, setSwUpdateReady]   = useState(false);
  const swUpdateFnRef = useRef(null);
  const toastTimerRef = useRef(null);

  // Toast helper defined early so any handler in the body of App (including
  // ones declared above the later `useShareCard` block) can call it.
  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(""), TOAST_DURATION_MS);
  }, []);

  // Mobile bottom-sheet state. Initial snap is the user's persisted preference
  // (loadSheetSnap), falling back to peek (0). When a new route arrives we
  // auto-promote ONLY from peek — if the user has previously chosen half or
  // full, that preference wins over auto-promote so they don't fight the UI.
  // Mobile (sheet) caps at 480 px. The 481–1023 px tablet range uses the
  // desktop two-column layout with a narrower sidebar (see `app--tablet`
  // in App.css). Same `mainContents` / `mapNode` JSX in both desktop branches
  // preserves React component identity — no MapLibre re-init when a tablet
  // crosses the 1024 px threshold on rotation.
  const isMobile = useMediaQuery(MQ_MOBILE);
  const isTablet = useMediaQuery(MQ_TABLET);
  // Hold the position:fixed mobile shell steady against the iOS keyboard —
  // see useViewportStable. Gated to the mobile branch (the only one that
  // renders `.mobile-shell`).
  useViewportStable(isMobile);
  const [sheetSnap, setSheetSnap] = useState(() => loadSheetSnap() ?? 0);
  const [mapPadding, setMapPadding] = useState(null);
  const lastResultRef = useRef(null);
  // Once the user manually moves the sheet, stop auto-promoting on result
  // arrival — they've expressed a preference for this session.
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

  // Initial mobile mount or mode flip → if the sheet is at peek, promote it
  // to half so the form's inputs are actually visible. At peek (140 px) the
  // route/explore forms sit entirely offscreen, so a fresh mobile load in
  // either mode needs this nudge before the user can interact.
  //
  // F-35: reset `userMovedSheetRef.current` on every mode flip so the new
  // mode's first result auto-promotes cleanly. Without this, a single drag
  // in Route mode permanently disabled auto-promote for the rest of the
  // session — including across mode toggles into Explore, where the user
  // had never expressed a sheet-position preference at all.
  useEffect(() => {
    userMovedSheetRef.current = false;
    if (!isMobile) return;
    setSheetSnap(prev => prev === 0 ? 1 : prev);
  }, [mode, isMobile]);

  // F-17: move keyboard focus to the active mode's first form input on a
  // mode flip. Without this, a sighted-mouse-free user has to tab from the
  // tablist back through the masthead into the form every time they switch
  // between Route and Explore — exactly the friction the focus management
  // is meant to eliminate. `didMountModeFocusRef` skips the very first
  // commit so a cold page load doesn't yank focus away from whatever the
  // browser was about to focus naturally (often the address bar or the
  // last-restored focus).
  const didMountModeFocusRef = useRef(false);
  useEffect(() => {
    if (!didMountModeFocusRef.current) {
      didMountModeFocusRef.current = true;
      return;
    }
    // useEffect runs after React's commit phase, so the new mode's form is
    // already in the DOM. No RAF needed — that would also conflict with the
    // route-animation test's "no RAF under prefers-reduced-motion" assertion.
    const root = document.querySelector(".main") ?? document.body;
    const target = root.querySelector(
      'input:not([type="hidden"]):not([disabled]), [role="combobox"], [contenteditable]:not([contenteditable="false"])',
    );
    if (target && typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }
  }, [mode]);

  // Mobile pick-on-map: drop the sheet to peek so the user can see the map,
  // remember the snap they were at, and restore it once the pick resolves.
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

  // TD-065 / F-19: the sheet's pointermove drag streams `onObscuredChange`
  // callbacks at native pointer-event rate (60+ Hz on most hardware). Each
  // call previously created a new `mapPadding` object and forced a setState,
  // which propagated through `MapView`'s `fitBounds` invocations and forced
  // MapLibre's transform engine to recompute padding offsets per frame.
  // Coalesce via a single rAF token — multiple pointermove samples within
  // one paint frame collapse into one `setMapPadding` call. The leading
  // value (first sample of the frame) wins so the trailing position is
  // already settled by the time the next frame paints.
  const padRafTokenRef = useRef(null);
  const pendingPadBottomRef = useRef(null);
  const handleObscuredChange = useCallback((bottomPx) => {
    pendingPadBottomRef.current = bottomPx;
    if (padRafTokenRef.current !== null) return; // already scheduled this frame
    padRafTokenRef.current = requestAnimationFrame(() => {
      padRafTokenRef.current = null;
      const bottom = pendingPadBottomRef.current;
      if (bottom == null) return;
      setMapPadding({
        top: 80,
        bottom: bottom + 16,
        left: 16,
        right: 16,
      });
    });
  }, []);
  useEffect(() => () => {
    if (padRafTokenRef.current !== null) {
      cancelAnimationFrame(padRafTokenRef.current);
      padRafTokenRef.current = null;
    }
  }, []);

  // Overlay the active flavor's per-route fields onto top-level metadata
  // (origin/dest coords, step length, etc.) so existing renderers work
  // unchanged regardless of flavor.
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

  const handleLogWalk = useCallback(() => {
    if (!viewResult || walkLogged) return;
    // Pass `stepLog` so logWalk skips the localStorage re-read + parse —
    // we already have the live list in state.
    const entry = logWalk({
      steps: viewResult.total_steps,
      miles: viewResult.total_miles,
      minutes: viewResult.total_minutes,
      origin,
      destination: isMultiStop
        ? stopValues.slice(1).join(" → ")
        : destination,
    }, stepLog);
    if (entry) setStepLog(prev => [entry, ...prev]);
    setWalkLogged(true);
  }, [viewResult, walkLogged, origin, destination, isMultiStop, stopValues, stepLog]);

  const handleClearStepLog = useCallback(() => {
    clearStepLog();
    setStepLog([]);
  }, []);

  // Register the PWA service worker with a needRefresh callback.
  // TD-066 / F-22: log a short breadcrumb at each lifecycle waypoint so a
  // user reporting "the update banner didn't show" (or "it showed but
  // nothing happened on accept") can paste a console snippet without
  // bringing up the SW DevTools panel. Console-only — no telemetry payload
  // — but enough to diagnose silent failures.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line no-console
    console.info("[sw] registering");
    import(/* @vite-ignore */ "virtual:pwa-register")
      .then(({ registerSW }) => {
        if (cancelled || typeof registerSW !== "function") {
          // eslint-disable-next-line no-console
          console.info("[sw] registerSW unavailable (non-PWA build or cancelled)");
          return;
        }
        const updateSW = registerSW({
          onNeedRefresh() {
            // eslint-disable-next-line no-console
            console.info("[sw] needRefresh — new SW waiting");
            if (!cancelled) setSwUpdateReady(true);
          },
          onOfflineReady() {
            // eslint-disable-next-line no-console
            console.info("[sw] offlineReady — first install complete");
          },
          onRegisteredSW(swUrl) {
            // eslint-disable-next-line no-console
            console.info("[sw] registered at", swUrl);
          },
          onRegisterError(err) {
            // eslint-disable-next-line no-console
            console.warn("[sw] register error", err);
          },
        });
        swUpdateFnRef.current = updateSW;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.info("[sw] register import failed (likely test/dev build)", err?.message);
      });
    return () => { cancelled = true; };
  }, []);

  const handleApplySwUpdate = useCallback(() => {
    const fn = swUpdateFnRef.current;
    // eslint-disable-next-line no-console
    console.info("[sw] applying update", typeof fn === "function" ? "via skipWaiting" : "via reload (no updateSW fn)");
    if (typeof fn === "function") fn(true); // skipWaiting + reload
    else window.location.reload();
  }, []);

  const handleSwap = useCallback(() => {
    // Reverse in place — keep ids stable so AddressAutocomplete instances
    // don't unmount and drop focus / suggestion state mid-edit. Functional
    // update so deps stay empty; useState bails out on same-ref return.
    setStops(prev => prev.some(s => !s.value.trim()) ? prev : prev.slice().reverse());
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const cleaned = stopValues.map(v => v.trim());
    if (cleaned.some(v => !v)) return;
    await fetchRoute(cleaned);
  }, [stopValues, fetchRoute]);

  // ── Explore-mode handlers ──────────────────────────────────────────────

  // When the user picks "📍 My location" in ExploreForm, resolve coordinates
  // and immediately re-fetch with the new origin.
  const handleExploreLocateMe = useCallback(async () => {
    setLocating(true);
    try {
      const loc = await resolveCurrentLocation();
      if (loc.error) {
        // Flip back to community-area mode so the form is immediately usable;
        // preserve the prior pick if any, otherwise default. Don't auto-fetch —
        // let the user confirm or pick a different area.
        const prevArea = explorePrefsRef.current.origin?.communityArea;
        const fallback = {
          kind: "community_area",
          communityArea: prevArea || EXPLORE_DEFAULTS.origin.communityArea,
        };
        setExplorePrefs(p => ({ ...p, origin: fallback }));
        explorePrefsRef.current = { ...explorePrefsRef.current, origin: fallback };
        const msg = loc.error === "denied"
          ? "Location permission denied — pick a community area instead."
          : loc.error === "outside_coverage"
            ? "You're outside the Chicago coverage area — pick a community area."
            : "Couldn't read your location — pick a community area.";
        setExploreError(msg);
        return;
      }
      const next = { kind: "current", communityArea: null, lat: loc.lat, lon: loc.lon };
      setExplorePrefs(p => ({ ...p, origin: next }));
      // Flush the ref manually so fetchExploreResult doesn't race the state update.
      explorePrefsRef.current = { ...explorePrefsRef.current, origin: next };
      fetchExploreResult({ origin: next });
    } finally {
      setLocating(false);
    }
  }, [fetchExploreResult, setExploreError, explorePrefsRef]);

  const handleExploreOriginChange = useCallback((nextOrigin) => {
    setExplorePrefs(p => ({ ...p, origin: nextOrigin }));
    if (nextOrigin.kind === "community_area") {
      // Community-area picks have a deterministic centroid → fetch immediately.
      explorePrefsRef.current = { ...explorePrefsRef.current, origin: nextOrigin };
      fetchExploreResult({ origin: nextOrigin });
    }
  }, [setExplorePrefs, explorePrefsRef, fetchExploreResult]);

  const handleExploreMaxMinutesChange = useCallback((next) => {
    setExplorePrefs(p => ({ ...p, maxMinutes: next }));
    explorePrefsRef.current = { ...explorePrefsRef.current, maxMinutes: next };
  }, [setExplorePrefs, explorePrefsRef]);

  // Slider release / "Discover" button.
  const handleExploreSubmit = useCallback(() => {
    fetchExploreResult();
  }, [fetchExploreResult]);

  const handleToggleGroup = useCallback((groupKey) => {
    setExplorePrefs(p => {
      const set = new Set(p.expandedGroups);
      if (set.has(groupKey)) set.delete(groupKey);
      else set.add(groupKey);
      return { ...p, expandedGroups: Array.from(set) };
    });
  }, [setExplorePrefs]);

  const handleToggleCategory = useCallback((catKey) => {
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
  }, [setExplorePrefs]);

  const handleToggleSub = useCallback((catKey, subKey) => {
    setExplorePrefs(p => {
      const fullKey = `${catKey}/${subKey}`;
      const subSet = new Set(p.selectedSubs);
      if (subSet.has(fullKey)) subSet.delete(fullKey);
      else subSet.add(fullKey);
      return { ...p, selectedSubs: Array.from(subSet) };
    });
  }, [setExplorePrefs]);

  const handleToggleHeatmap = useCallback((key, e) => {
    const checked = !!(e?.target?.checked);
    const layer = HEATMAP_LAYERS.find(l => l.key === key);
    if (!layer) return;
    setExplorePrefs(p => ({ ...p, [layer.prefKey]: checked }));
  }, [setExplorePrefs]);

  const handleSelectAllCategories = useCallback(() => {
    setExplorePrefs(p => {
      const next = {
        ...p,
        selectedCategories: PIN_CATEGORIES.map(c => c.key),
        selectedSubs: [],
      };
      for (const { prefKey } of HEATMAP_LAYERS) next[prefKey] = true;
      return next;
    });
  }, [setExplorePrefs]);

  const handleClearAllCategories = useCallback(() => {
    setExplorePrefs(p => {
      const next = {
        ...p,
        selectedCategories: [],
        selectedSubs: [],
      };
      for (const { prefKey } of HEATMAP_LAYERS) next[prefKey] = false;
      return next;
    });
  }, [setExplorePrefs]);

  // Mobile only: when a place pin is tapped, drop the sheet to peek so the
  // MapLibre popup over the pin isn't clipped under the sheet body.
  const handlePlaceTap = useCallback(() => {
    if (!isMobile) return;
    setSheetSnap(0);
  }, [isMobile]);

  // "Walk here" from a place popover → flip back to route mode and fire a
  // route fetch from the explorer's origin to the clicked place.
  const handlePlaceGoHere = useCallback(({ lat, lon, name, address }) => {
    const o = explorePrefsRef.current.origin;
    const originName = o.kind === "community_area"
      ? o.communityArea
      : (o.lat != null && o.lon != null ? formatLatLonLabel(o.lat, o.lon) : null);
    if (!originName) {
      showToast("Still reading your location — try again in a moment.");
      return;
    }
    const destName = name || address || formatLatLonLabel(lat, lon);
    setMode("route");
    setStops([
      { id: makeStopId(), value: originName },
      { id: makeStopId(), value: destName },
    ]);
    fetchRouteRef.current([originName, destName]);
  }, [setMode, explorePrefsRef, fetchRouteRef, showToast]);

  // Reachable-neighborhood chip → route from the explorer's origin to the
  // clicked neighborhood.
  const handleNeighborhoodChip = useCallback((neighborhoodName) => {
    const o = explorePrefsRef.current.origin;
    const originName = o.kind === "community_area"
      ? o.communityArea
      : (o.lat != null && o.lon != null ? formatLatLonLabel(o.lat, o.lon) : null);
    if (!originName) {
      showToast("Still reading your location — try again in a moment.");
      return;
    }
    setMode("route");
    setStops([
      { id: makeStopId(), value: originName },
      { id: makeStopId(), value: neighborhoodName },
    ]);
    fetchRouteRef.current([originName, neighborhoodName]);
  }, [setMode, explorePrefsRef, fetchRouteRef, showToast]);

  const handleRecentSelect = useCallback((item) => {
    const itemStops = recentEntryStops(item);
    if (!itemStops.length) return;
    setStops(itemStops.map(v => ({ id: makeStopId(), value: v })));
    fetchRoute(itemStops);
  }, [fetchRoute]);

  const handleClearRecent = useCallback(() => {
    safeRemove(RECENT_KEY);
    setRecentSearches([]);
  }, []);

  // ── Pick on map ────────────────────────────────────────────────────────

  const handlePickToggle = useCallback((stopId) => {
    setPickMode(prev => prev === stopId ? null : stopId);
  }, []);

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

  // Follow mode disengages when the user switches modes or clears the active
  // context (no route AND no explore polygon) — avoids orphan watchers.
  const followStop = followLocation.stop;
  useEffect(() => { followStop(); }, [mode, followStop]);
  useEffect(() => {
    if (!viewResult && !exploreResult) followStop();
  }, [viewResult, exploreResult, followStop]);

  // Surface watchPosition errors using the same toast vocabulary as the
  // one-shot locate flow.
  const followError = followLocation.error;
  useEffect(() => {
    if (!followError) return;
    if (followError === "denied")           showToast("Location permission denied — try typing a stop instead.");
    else if (followError === "outside_coverage") showToast("You're outside the Chicago coverage area.");
    else                                    showToast("Couldn't read your location — try typing a stop instead.");
  }, [followError, showToast]);

  // ── Share card ─────────────────────────────────────────────────────────
  const {
    showShareModal,
    cardMapReady,
    canWebShare,
    cardRef,
    cardMapRef,
    shareUrl,
    siteHost,
    handleOpenShare,
    handleCloseShare,
    handleCardMapReady,
    handleShareCard,
    handleCopyShareLink,
  } = useShareCard({
    viewResult,
    stopValues,
    heightFt,
    heightIn,
    origin,
    destination,
    showToast,
  });

  // "Use my current location" — populates the first empty stop, or the origin
  // if every stop already has a value.
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
        setStopValue(target.id, formatLatLonLabel(lat, lon));
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
      setStopValue(targetId, formatLatLonLabel(lat, lon));
      setToastMsg("That spot has no name we know — using coordinates.");
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToastMsg(""), TOAST_DURATION_MS);
    }
  }, [pickMode]);

  // ── Derived map data ───────────────────────────────────────────────────

  // The set of keys visible on the map — selected top-level category keys
  // ("libraries") plus selected "category/subcategory" composite keys
  // ("medical/pharmacy"). MapExploreLayer's place filter accepts either form.
  // When a category has any subcategory selected, the bare parent key is
  // omitted: the user has narrowed that category, so only the composite keys
  // should pass and unselected subs (and untagged places) drop out.
  //
  // This memo is the single source of truth for "what's visible on the map
  // right now" (F-02). The persisted `explorePrefs.selectedCategories` +
  // `selectedSubs` are the user's saved selection; the rendered subset is
  // derived here so the parent-vs-child resolution lives in exactly one
  // place. Renamed from `activeSubsSet` to make that intent legible.
  const visibleCategories = useMemo(() => {
    const narrowed = new Set(
      explorePrefs.selectedSubs.map(s => s.slice(0, s.indexOf("/"))),
    );
    const out = new Set();
    for (const c of explorePrefs.selectedCategories) {
      if (!narrowed.has(c)) out.add(c);
    }
    for (const s of explorePrefs.selectedSubs) out.add(s);
    return out;
  }, [explorePrefs.selectedCategories, explorePrefs.selectedSubs]);

  // Inline arrows used inside the memoized sidebar contents below. Hoisted
  // so the useMemo deps are simple stable references (OPT-037).
  const handleRetryRoute = useCallback(() => {
    const cleaned = stopValues.map(v => v.trim());
    if (cleaned.some(v => !v)) return;
    fetchRoute(cleaned);
  }, [stopValues, fetchRoute]);

  const formatDirectionsForView = useCallback(
    (d, r) => formatDirectionsText(d, r, mobilityProfile),
    [mobilityProfile],
  );

  // ── Mode toggle (Route ⇄ Explore) ─────────────────────────────────────
  // OPT-037: memoized so the JSX subtree is reused across renders that
  // don't actually change `mode`. The setMode reference is stable (useState
  // setter), so the onClick arrows here don't need their own useCallback.
  const handleSelectRoute   = useCallback(() => setMode("route"),   []);
  const handleSelectExplore = useCallback(() => setMode("explore"), []);
  const modeToggle = useMemo(() => (
    <div className="mode-toggle" role="tablist" aria-label="Route planning mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "route"}
        className={`mode-toggle-btn${mode === "route" ? " mode-toggle-btn--active" : ""}`}
        onClick={handleSelectRoute}
      >
        <WPIcon name="stride" size={14} />
        <span>Route</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "explore"}
        className={`mode-toggle-btn${mode === "explore" ? " mode-toggle-btn--active" : ""}`}
        onClick={handleSelectExplore}
      >
        <WPIcon name="crosshair" size={14} />
        <span>Explore</span>
      </button>
    </div>
  ), [mode, handleSelectRoute, handleSelectExplore]);

  // Explore-mode content: the form (origin selector + slider + chips) plus
  // the category panel. Memoized (OPT-036) so re-renders that don't change
  // any of the listed deps — theme toggles, toast timers, sheet drags,
  // followLocation pos updates, etc. — hit the useMemo cache and skip the
  // JSX rebuild + React reconciliation pass against the prior tree.
  const exploreContents = useMemo(() => (
    <>
      {modeToggle}
      <ExploreErrorBoundary>
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
        (exploreResult.stats?.area_sq_mi ?? 0) < 0.05 ? (
          // Origin snapped to the graph but reaches almost nothing — typically
          // a parking lot, highway median, or an isolated cul-de-sac.
          <div className="explore-no-area" role="note">
            <strong>No reachable area from here.</strong>
            <span>
              That spot doesn&apos;t connect to enough of the pedestrian network to
              survey. Try a community area, or pick a different point.
            </span>
          </div>
        ) : (
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
        )
      )}
      <ExploreCategoryPanel
        selectedCategories={explorePrefs.selectedCategories}
        selectedSubs={explorePrefs.selectedSubs}
        expandedGroups={explorePrefs.expandedGroups}
        heatmapStates={{
          residential: explorePrefs.showResidentialHeatmap,
          parks_heatmap: explorePrefs.showParksHeatmap,
          tree_canopy: explorePrefs.showTreeCanopyHeatmap,
          green_space: explorePrefs.showGreenSpaceHeatmap,
        }}
        onToggleGroup={handleToggleGroup}
        onToggleCategory={handleToggleCategory}
        onToggleSub={handleToggleSub}
        onToggleHeatmap={handleToggleHeatmap}
        onSelectAll={handleSelectAllCategories}
        onClearAll={handleClearAllCategories}
      />
      </ExploreErrorBoundary>
    </>
  ), [
    modeToggle,
    explorePrefs,
    exploreLoading, exploreResult, exploreError, locating,
    handleExploreOriginChange, handleExploreMaxMinutesChange, handleExploreSubmit,
    handleNeighborhoodChip, handleExploreLocateMe,
    handleToggleGroup, handleToggleCategory, handleToggleSub, handleToggleHeatmap,
    handleSelectAllCategories, handleClearAllCategories,
  ]);

  // Form, results, and directions — composed once and slotted into either
  // the desktop two-column layout or the mobile bottom sheet. Memoized for
  // the same reason as exploreContents above (OPT-036).
  const routeContents = useMemo(() => (
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
                <AddressAutocomplete
                  className="stop-autocomplete"
                  value={stop.value}
                  onChange={value => setStopValue(stop.id, value)}
                  onSelect={sugg => setStopValue(stop.id, sugg.label)}
                  getSuggestions={fetchAutocomplete}
                  placeholder={placeholder}
                  ariaLabel={label}
                  enterKeyHint={isLast ? "go" : "next"}
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
        metricMode={isWheeled ? "distance" : "steps"}
        stepLengthInches={viewResult?.step_length_inches}
      />

      {error && (
        <ErrorDispatch
          error={error}
          onRetry={handleRetryRoute}
        />
      )}

      {loading && <LoadingSkeleton />}

      {showMobilityOverrideNotice && viewResult && !loading && (
        <div className="mobility-override-notice" role="note">
          <span>
            Your Mobility profile is set to <em>Wheeled</em>, so stairs are avoided regardless of your saved preferences.
          </span>
          <button
            type="button"
            className="mobility-override-dismiss"
            onClick={handleDismissMobilityOverride}
            aria-label="Dismiss mobility override notice"
          >
            ×
          </button>
        </div>
      )}

      {viewResult && !loading && (
        <RouteErrorBoundary>
          <DirectionLedger
            directions={viewResult.directions}
            result={viewResult}
            activeTurnIndex={activeTurnIndex}
            onStepClick={setActiveTurnIndex}
            legs={isMultiStop ? (result.legs ?? null) : null}
            formatDirectionsText={formatDirectionsForView}
          />

          {!isMultiStop && (
            <RouteFlavorTabs
              routes={result.routes}
              activeFlavor={activeFlavor}
              onChange={setActiveFlavor}
              mobilityProfile={mobilityProfile}
            />
          )}
          {isMultiStop && (
            <div className="multi-stop-note" role="note">
              Multi-stop routes use the fastest path. Alternatives (fewest turns, greenest) are offered for two-stop routes.
            </div>
          )}

          <StepHero
            result={viewResult}
            dailyGoal={dailyGoal}
            onShare={handleOpenShare}
            metricMode={isWheeled ? "distance" : "steps"}
          />

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
            aria-label={walkLogged ? "Trip logged" : "Log this trip"}
          >
            {walkLogged
              ? <><WFIcon name="check" size={14} /> Logged this trip</>
              : <><WFIcon name="plus" size={14} /> Log this trip</>}
          </button>

          <div className="motivation">
            {motivationMessage(viewResult.total_steps, mobilityProfile)}
          </div>
        </RouteErrorBoundary>
      )}
    </>
  ), [
    modeToggle,
    stops, pickMode, loading, isMultiStop, error,
    recentSearches, stepLog, dailyGoal, isWheeled,
    viewResult, activeTurnIndex, result, mobilityProfile, activeFlavor, walkLogged,
    showMobilityOverrideNotice,
    handleSubmit, handlePickToggle, setStopValue, moveStop, removeStop, addStop, handleSwap,
    handleRetryRoute, formatDirectionsForView,
    handleRecentSelect, handleClearRecent, handleClearStepLog,
    handleDismissMobilityOverride, handleOpenShare, handleLogWalk,
  ]);

  const sidebarContents = mode === "explore" ? exploreContents : routeContents;

  const mapErrorMessage = mode === "explore"
    ? "Something went wrong drawing the explorer — try a different origin or time budget."
    : "Something went wrong displaying your route — try a new search.";
  const mapNode = (
    <Suspense fallback={<div className="map-lazy-fallback" aria-hidden="true" />}>
      <MapErrorBoundary errorMessage={mapErrorMessage}>
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
          categoryStyles={EXPLORE_CATEGORY_STYLES}
          activeSubs={visibleCategories}
          showResidential={explorePrefs.showResidentialHeatmap}
          showParks={explorePrefs.showParksHeatmap}
          showTreeCanopy={explorePrefs.showTreeCanopyHeatmap}
          showGreenSpace={explorePrefs.showGreenSpaceHeatmap}
          onPlaceGoHere={handlePlaceGoHere}
          onPlaceTap={handlePlaceTap}
          userPosition={followLocation.position}
          following={followLocation.following}
          onToggleFollow={followLocation.toggle}
        />
      </MapErrorBoundary>
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
          <Masthead onSettings={() => setPersonalizeOpen(true)} />
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
        mobilityProfile={mobilityProfile}
        avoidStairs={avoidStairs}
        preferPedestrian={preferPedestrian}
        pace={walkPace}
        onChangeHeight={handleHeightChange}
        onChangeWeight={handleWeightChange}
        onChangeGoal={handleGoalChange}
        onChangeMobilityProfile={handleMobilityProfileChange}
        onChangeAvoidStairs={setAvoidStairs}
        onChangePreferPedestrian={setPreferPedestrian}
        onChangePace={setWalkPace}
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
                  mobilityProfile={mobilityProfile}
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

      {/* ── Toast ──
          F-18: the live region is kept in the DOM unconditionally (even when
          empty) so assistive tech can attach to it and announce future
          updates. The previous conditional render destroyed + recreated the
          live region between announcements, which Safari/VoiceOver in
          particular won't reliably re-bind to. Adding `aria-atomic="true"`
          tells AT to read the whole message rather than only the diff
          when the text changes from one toast to the next. */}
      <div
        className={`toast${toastMsg ? "" : " toast--empty"}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {toastMsg}
      </div>

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
