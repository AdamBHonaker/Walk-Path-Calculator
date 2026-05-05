import { useState, useRef, useEffect, useCallback, useMemo, memo, Component } from "react";
import "./App.css";
import MapView from "./MapView.jsx";
import { ShareDispatch } from "./components/ShareDispatch.jsx";
import { haversineMeters } from "./mapHelpers.js";
import { calorieEquivalent } from "./calorieEquiv.js";
import { safeGet, safeSet, safeRemove, loadJSON, saveJSON } from "./lib/storage.js";
import { Masthead } from "./components/Masthead.jsx";
import { Footer } from "./components/Footer.jsx";
import { PersonalizeModal } from "./components/PersonalizeModal.jsx";
import { DirectionLedger } from "./components/DirectionLedger.jsx";
import { RouteFlavorTabs } from "./components/RouteFlavorTabs.jsx";
import { CompareDispatch } from "./components/CompareDispatch.jsx";
import { LoadingSkeleton } from "./components/LoadingSkeleton.jsx";
import { ErrorDispatch } from "./components/ErrorDispatch.jsx";
import { WeeklySummaryPanel } from "./components/WeeklySummaryPanel.jsx";
import { TweaksPanel } from "./components/TweaksPanel.jsx";
import { WPIcon } from "./wayfarer/walkpath-icons.jsx";
import { WFIcon } from "./wayfarer/icons.jsx";
import { WFCheck, WFRadio } from "./wayfarer/forms.jsx";
import { formatSteps } from "./lib/directionFormat.js";
import {
  PACE_LABELS,
  safePaceLabel,
  motivationMessage,
  formatDirectionsText,
} from "./lib/routeFormat.js";

export { formatBlocks } from "./lib/directionFormat.js";
import {
  RECENT_KEY,
  RECENT_MAX,
  loadRecentSearches,
  saveRecentSearch,
  clearRecentSearches,
  recentEntryStops,
  formatRecentChip,
} from "./lib/recentSearches.js";
import {
  STEP_LOG_TTL_DAYS,
  loadStepLog,
  logWalk,
  clearStepLog,
} from "./lib/stepLog.js";

// Re-exported for App.test.jsx — extractions to lib/ stay transparent
// to the existing test imports.
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
};

function normalizeBackendUrl(rawUrl) {
  if (!rawUrl) return null;
  if (rawUrl.match(/^https:\/\//i)) return rawUrl;
  if (rawUrl.match(/^http:\/\//i)) {
    if (import.meta.env.PROD) {
      throw new Error("VITE_BACKEND_URL must use https:// in production builds.");
    }
    return rawUrl;
  }
  return `https://${rawUrl}`;
}

function resolveBackendUrl() {
  const normalized = normalizeBackendUrl(import.meta.env.VITE_BACKEND_URL);
  if (normalized) return normalized;
  if (import.meta.env.PROD) {
    throw new Error("VITE_BACKEND_URL is required in production builds.");
  }
  return "http://localhost:8000";
}

const BACKEND_URL = resolveBackendUrl();
const FETCH_TIMEOUT_MS = 10_000;

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

function fetchWithTimeout(input, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const externalSignal = init.signal;
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  if (externalSignal) {
    if (externalSignal.aborted) timeoutCtrl.abort();
    else externalSignal.addEventListener("abort", () => timeoutCtrl.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: timeoutCtrl.signal })
    .finally(() => clearTimeout(timer));
}

export const MAX_STOPS = 8;

export function parseStopsParam(raw) {
  if (!raw) return null;
  const parts = raw.split("|").map(s => s.trim().slice(0, 200));
  const filled = parts.filter(Boolean);
  if (filled.length < 2) return null;
  return filled.slice(0, MAX_STOPS);
}

function readUrlParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    const hft = p.has("hft") ? parseInt(p.get("hft"), 10) : null;
    const hin = p.has("hin") ? parseInt(p.get("hin"), 10) : null;
    const cap = (s) => (s || "").slice(0, 200);
    const stopsRaw = p.get("stops");
    const stops = parseStopsParam(stopsRaw);
    return {
      from: cap(p.get("from")),
      to:   cap(p.get("to")),
      stops,
      hft:  hft != null && !isNaN(hft) && hft >= 4 && hft <= 7 ? hft : null,
      hin:  hin != null && !isNaN(hin) && hin >= 0 && hin <= 11 ? hin : null,
    };
  } catch {
    return { from: "", to: "", stops: null, hft: null, hin: null };
  }
}

let _stopIdCounter = 0;
function makeStopId() {
  _stopIdCounter += 1;
  return `stop-${_stopIdCounter}-${Math.random().toString(36).slice(2, 8)}`;
}


// ── Step goal section ─────────────────────────────────────────────────────


export function loadDailyGoal() {
  const raw = safeGet("walkpath:dailyGoal");
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return n >= 1_000 && n <= 100_000 ? n : null;
}


function useTurnCoords(path, directions) {
  return useMemo(() => {
    if (!path?.length || !directions?.length) return [];

    // thresholds[i] = cumulative meters from the start to the turn at direction segment i
    const thresholds = [];
    let cum = 0;
    for (const dir of directions) {
      thresholds.push(cum);
      cum += dir.distance_meters ?? 0;
    }

    const turnCoords = [];
    let pathCum = 0;
    let tIdx = 0;

    for (let pi = 0; pi < path.length - 1 && tIdx < thresholds.length; pi++) {
      const segLen = haversineMeters(path[pi], path[pi + 1]);

      // Absorb all thresholds that fall within this segment (±10 m tolerance)
      while (tIdx < thresholds.length && thresholds[tIdx] <= pathCum + segLen + 10) {
        if (segLen > 0) {
          const t = Math.max(0, Math.min(1, (thresholds[tIdx] - pathCum) / segLen));
          turnCoords[tIdx] = [
            path[pi][0] + t * (path[pi + 1][0] - path[pi][0]),
            path[pi][1] + t * (path[pi + 1][1] - path[pi][1]),
          ];
        } else {
          turnCoords[tIdx] = [...path[pi]];
        }
        tIdx++;
      }
      pathCum += segLen;
    }

    // Anchor any rounding-leftover turns to the last polyline point
    const last = path[path.length - 1];
    for (let i = 0; i < thresholds.length; i++) {
      if (!turnCoords[i]) turnCoords[i] = last;
    }

    return turnCoords;
  }, [path, directions]);
}

// ── Weight helpers (exported for tests) ──────────────────────────────────

export function lbToKg(lb) {
  return lb / 2.20462;
}


// (HeightInput / WeightInput / StepGoalInput were inline accordions; their
//  controls now live in components/PersonalizeModal.jsx.)

// ── Pace section ──────────────────────────────────────────────────────────

const PACE_OPTIONS = [
  { value: "leisurely", label: "Strolling", detail: "2 mph" },
  { value: "normal",    label: "Steady",    detail: "3 mph" },
  { value: "brisk",     label: "Earnest",   detail: "4 mph" },
];

export function loadStoredPace() {
  const v = safeGet("walkpath:walkPace");
  if (v === "leisurely" || v === "normal" || v === "brisk") return v;
  return "normal";
}

const PaceSelector = memo(function PaceSelector({ pace, onChange }) {
  return (
    <div className="pace-selector">
      <div className="pace-selector-label">
        <WPIcon name="pace" size={12} />
        <span>Manner of walking</span>
      </div>
      <div className="pace-options" role="radiogroup" aria-label="Manner of walking">
        {PACE_OPTIONS.map(({ value, label, detail }) => (
          <WFRadio
            key={value}
            checked={pace === value}
            onChange={() => onChange(value)}
            name="pace"
            label={
              <>
                <span style={{ fontStyle: "italic", fontWeight: 600 }}>{label}</span>
                <span style={{
                  fontFamily: "var(--wf-mono)",
                  fontSize: 11,
                  color: "var(--mute)",
                  marginLeft: 6,
                }}>· {detail}</span>
              </>
            }
          />
        ))}
      </div>
    </div>
  );
});

// ── Direction list ────────────────────────────────────────────────────────

// (Inline DirectionList moved to components/DirectionLedger.jsx.)

// (Inline RouteFlavorTabs moved to components/RouteFlavorTabs.jsx.)

// ── Step hero card ────────────────────────────────────────────────────────

function StepHero({ result, dailyGoal, onShare }) {
  const {
    total_steps, total_miles, total_minutes, calories_approx,
    daily_goal_pct, step_length_inches, personalized,
    personalized_calories,
    elevation_gain_ft,
  } = result;

  const pct = Number.isFinite(daily_goal_pct) ? daily_goal_pct : 0;
  const barWidth = Math.min(pct, 100);
  const effectiveGoal = (dailyGoal ?? 10_000).toLocaleString();
  const calorieEquiv = calorieEquivalent(calories_approx);

  return (
    <div className="step-hero">
      <div className="step-hero-count">{formatSteps(total_steps)}</div>
      <div className="step-hero-label">steps</div>

      <div className="step-hero-stats">
        <span className="stat-chip">
          <span className="stat-chip-icon"><WPIcon name="ruler" size={12} /></span>
          {total_miles} mi
        </span>
        <span className="stat-chip">
          <span className="stat-chip-icon"><WPIcon name="hourglass" size={12} /></span>
          {total_minutes} min
        </span>
        <span className="stat-chip">
          <span className="stat-chip-icon"><WPIcon name="calorie-sigil" size={12} /></span>
          ~{calories_approx} cal
          {personalized_calories && (
            <span className="stat-chip-badge">personalized</span>
          )}
        </span>
        {elevation_gain_ft > 10 && (
          <span className="stat-chip">
            <span className="stat-chip-icon"><WPIcon name="elevation" size={12} /></span>
            {Math.round(elevation_gain_ft)} ft
          </span>
        )}
        {safePaceLabel(result.pace) && (
          <span className="stat-chip">
            <span className="stat-chip-icon"><WPIcon name="stride" size={12} /></span>
            {safePaceLabel(result.pace)}
          </span>
        )}
      </div>

      {calorieEquiv && (
        <p className="calorie-equiv">{calorieEquiv}</p>
      )}

      <div className="goal-bar-wrap">
        <div className="goal-bar-label">Daily measure · {effectiveGoal.toLocaleString()} steps</div>
        <div className="goal-bar-track">
          <div className="goal-bar-fill" style={{ width: `${barWidth}%` }} />
        </div>
        <div className="goal-bar-caption">{pct}% of daily measure</div>
      </div>

      <p className="step-note">
        {personalized
          ? `Measured to your ${step_length_inches}″ stride.`
          : `Using an average ${step_length_inches}″ stride. Add your particulars for a more honest count.`}
      </p>

      {onShare && (
        <button type="button" className="share-card-btn" onClick={onShare}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <WPIcon name="printer" size={14} />
            Print dispatch
          </span>
        </button>
      )}
    </div>
  );
}

// ── Compare-vs-alternatives panel ─────────────────────────────────────────

// (Inline ComparePanel moved to components/CompareDispatch.jsx.)

// (Inline LoadingSkeleton moved to components/LoadingSkeleton.jsx.)

// ── Error boundary ────────────────────────────────────────────────────────

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorDispatch
          error="Something went wrong displaying your route — try a new search."
        />
      );
    }
    return this.props.children;
  }
}

// ── Recent Searches ───────────────────────────────────────────────────────
// Implementation lives in ./lib/recentSearches.js (RECENT_KEY, loadRecentSearches,
// saveRecentSearch, clearRecentSearches, recentEntryStops, formatRecentChip,
// RECENT_MAX). The lib symbols are imported at the top of this file and
// re-exported there for App.test.jsx.

function RecentSearches({ searches, onSelect, onClear }) {
  if (!searches.length) return null;

  return (
    <div className="recent-searches">
      <div className="recent-searches-header">
        <span className="recent-searches-label">Lately Walked</span>
        <button type="button" className="recent-clear-btn" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="recent-chips">
        {searches.map(item => {
          const stops = recentEntryStops(item);
          return (
            <button
              key={item.timestamp}
              type="button"
              className="recent-chip"
              onClick={() => onSelect(item)}
            >
              <span className="recent-chip-route">{formatRecentChip(stops)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────

function loadAccessPrefs() {
  const parsed = loadJSON("walkpath:accessPrefs", {});
  return {
    avoidStairs: !!parsed?.avoidStairs,
    preferPedestrian: !!parsed?.preferPedestrian,
  };
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
    if (initialUrlParams.stops?.length) {
      return initialUrlParams.stops.map(v => ({ id: makeStopId(), value: v }));
    }
    return [
      { id: makeStopId(), value: initialUrlParams.from || "" },
      { id: makeStopId(), value: initialUrlParams.to   || "" },
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

  const [heightFt, setHeightFt]       = useState(() => initialUrlParams.hft);
  const [heightIn, setHeightIn]       = useState(() =>
    initialUrlParams.hft != null ? initialUrlParams.hin : null,
  );
  const [weightKg, setWeightKg]       = useState(null);
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

  const [result, setResult]           = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches);
  const [stepLog, setStepLog]               = useState(loadStepLog);
  const [walkLogged, setWalkLogged]         = useState(false);
  const [activeTurnIndex, setActiveTurnIndex] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [cardMapReady, setCardMapReady]     = useState(false);
  const [pickMode, setPickMode]             = useState(null); // stop id | null
  const [toastMsg, setToastMsg]             = useState("");
  const [activeFlavor, setActiveFlavor]     = useState("fastest");

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
  const toastTimerRef = useRef(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

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
        urlP.set("stops", cleanStops.join("|"));
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

  async function handleDownloadCard() {
    if (!cardRef.current) return;
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 3 });
      const a = document.createElement("a");
      a.href = dataUrl;
      const slugStops = stopValues.map(v => v.trim()).filter(Boolean);
      const slugSource = slugStops.length >= 2 ? slugStops.join("-to-") : `${origin}-to-${destination}`;
      const slug = slugSource.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      a.download = `walk-${slug}.png`;
      a.click();
    } catch (err) {
      console.error("[RouteCard] PNG capture failed:", err);
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

  return (
    <div className="app paper-grain">
      <Masthead />
      <div className="layout">

        {/* ── Left panel ── */}
        <div className="panel-cards">
          <main className="main">
            <form className="form" onSubmit={handleSubmit}>
              <div className="stops-group">
                {stops.map((stop, i) => {
                  const isFirst = i === 0;
                  const isLast  = i === stops.length - 1;
                  const label   = isFirst
                    ? "From"
                    : isLast
                      ? "To"
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
                      <div className="input-with-pick">
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
                        <button
                          type="button"
                          className={`pick-map-btn${pickMode === stop.id ? " pick-map-btn--active" : ""}`}
                          onClick={() => handlePickToggle(stop.id)}
                          title={pickMode === stop.id ? "Cancel pick" : "Set point on map"}
                          aria-label={pickMode === stop.id ? "Cancel pick mode" : `Set ${label} by clicking map`}
                        >
                          <WPIcon name="crosshair" size={14} />
                        </button>
                      </div>
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
                        {canRemove && (
                          <button
                            type="button"
                            className="stop-remove-btn"
                            onClick={() => removeStop(stop.id)}
                            aria-label={`Remove ${label}`}
                            title="Remove stop"
                          >
                            <WFIcon name="x" size={14} />
                          </button>
                        )}
                      </div>
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
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
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
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
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
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 4,
                  width: "100%",
                  padding: "10px 12px",
                  background: "transparent",
                  border: "1px solid var(--mute-fog)",
                  textAlign: "left",
                  cursor: "pointer",
                  margin: "8px 0",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--wf-sans)",
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: 2,
                    textTransform: "uppercase",
                    color: "var(--mute)",
                  }}
                >
                  Personalize
                </span>
                <span
                  style={{
                    fontFamily: "var(--wf-serif)",
                    fontStyle: "italic",
                    fontSize: 14,
                    color: "var(--ink)",
                  }}
                >
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
                style={{
                  width: "100%",
                  padding: "13px 16px",
                  fontSize: 15,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  fontFamily: "var(--wf-serif)",
                  fontStyle: "italic",
                  background: "var(--ink)",
                  color: "var(--paper)",
                  border: "1px solid var(--ink)",
                  cursor: loading ? "wait" : "pointer",
                }}
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
              <ErrorBoundary>
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
              </ErrorBoundary>
            )}
          </main>
        </div>

        {/* ── Map panel ── */}
        <div className="panel-map">
          <MapView
            result={viewResult}
            turnCoords={turnCoords}
            activeTurnIndex={activeTurnIndex}
            pickMode={pickMode}
            onPickPoint={handleMapPick}
            resolveLabel={resolveStopLabel}
          />
        </div>

      </div>

      <Footer />

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
              <ShareDispatch
                ref={cardRef}
                result={viewResult}
                originLabel={origin}
                destLabel={destination}
                onMapReady={handleCardMapReady}
              />
            </div>
            <div className="share-modal-actions">
              <button
                type="button"
                className="share-download-btn"
                disabled={!cardMapReady}
                onClick={handleDownloadCard}
              >
                {cardMapReady ? "⬇ Download PNG" : "Rendering map…"}
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

      <TweaksPanel />
    </div>
  );
}
