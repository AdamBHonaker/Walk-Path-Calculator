import { useState, useRef, useEffect, useCallback, useMemo, memo, Component, Fragment } from "react";
import "./App.css";
import MapView from "./MapView.jsx";
import RouteCard from "./RouteCard.jsx";
import { summarize } from "./compareEstimates.js";
import { haversineMeters } from "./mapHelpers.js";

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

const FT_OPTIONS = [4, 5, 6, 7];
const IN_OPTIONS = Array.from({ length: 12 }, (_, i) => i);

// ── Helpers ───────────────────────────────────────────────────────────────

const CALORIE_FOODS = [
  { name: "cookie",         cal: 55,  plural: "cookies"         },
  { name: "banana",         cal: 90,  plural: "bananas"         },
  { name: "latte",          cal: 120, plural: "lattes"          },
  { name: "bag of chips",   cal: 130, plural: "bags of chips"   },
  { name: "can of soda",    cal: 150, plural: "cans of soda"    },
  { name: "granola bar",    cal: 190, plural: "granola bars"    },
  { name: "chocolate bar",  cal: 220, plural: "chocolate bars"  },
  { name: "small fries",    cal: 230, plural: "small fries"     },
  { name: "donut",          cal: 250, plural: "donuts"          },
  { name: "slice of pizza", cal: 300, plural: "slices of pizza" },
  { name: "cupcake",        cal: 350, plural: "cupcakes"        },
  { name: "cheeseburger",   cal: 550, plural: "cheeseburgers"   },
];

const NICE_FRACS = [
  { val: 0.25, label: "¼ of a"  },
  { val: 0.33, label: "⅓ of a"  },
  { val: 0.5,  label: "half a"  },
  { val: 0.67, label: "⅔ of a"  },
  { val: 0.75, label: "¾ of a"  },
  { val: 1,    label: "1"       },
  { val: 1.5,  label: "1½"      },
  { val: 2,    label: "2"       },
  { val: 3,    label: "3"       },
  { val: 4,    label: "4"       },
];

export function calorieEquivalent(calories) {
  if (!calories || calories <= 0) return null;

  let bestFood = null;
  let bestFrac = null;
  let bestErr = Infinity;

  for (const food of CALORIE_FOODS) {
    const ratio = calories / food.cal;
    for (const frac of NICE_FRACS) {
      const err = Math.abs(ratio - frac.val);
      if (err < bestErr) {
        bestErr = err;
        bestFood = food;
        bestFrac = frac;
      }
    }
  }

  if (!bestFood) return null;
  const itemLabel = bestFrac.val >= 2 ? bestFood.plural : bestFood.name;
  return `≈ ${bestFrac.label} ${itemLabel}`;
}

function formatSteps(n) {
  return n != null ? n.toLocaleString() : "–";
}

export function formatBlocks(blocks, blockType) {
  const t = blockType === "long" ? "long block" : "short block";
  return `${blocks} ${blocks === 1 ? t : t + "s"}`;
}

export function motivationMessage(steps) {
  if (steps < 1500) return "A great short walk. Every step counts toward your health!";
  if (steps < 4000) return "A solid neighborhood walk — this is exactly what daily health looks like.";
  if (steps < 7000) return "You're racking up serious steps. This beats a car ride every time.";
  if (steps < 10000) return "Almost a full day's goal in one trip — this walk is genuinely good for you.";
  return "Over 10,000 steps in a single walk! That's extraordinary. Your body will thank you.";
}

// ── Step goal section ─────────────────────────────────────────────────────

const GOAL_PRESETS = [5_000, 7_500, 10_000, 15_000, 20_000];

export function loadDailyGoal() {
  try {
    const raw = localStorage.getItem("walkpath:dailyGoal");
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return n >= 1_000 && n <= 100_000 ? n : null;
  } catch {
    return null;
  }
}

const StepGoalInput = memo(function StepGoalInput({ dailyGoal, onChange }) {
  const [open, setOpen] = useState(false);

  function handlePreset(val) {
    onChange(val);
  }

  function handleNumberInput(e) {
    const n = parseInt(e.target.value, 10);
    if (n >= 1_000 && n <= 100_000) onChange(n);
  }

  function handleClear() {
    onChange(null);
  }

  return (
    <div className="height-section">
      <button
        type="button"
        className="height-toggle"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span>
          {dailyGoal != null
            ? `Daily goal: ${dailyGoal.toLocaleString()} steps`
            : "Set your daily step goal (optional)"}
        </span>
        <span className="height-toggle-chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <>
          <div className="goal-body">
            <div className="goal-presets">
              {GOAL_PRESETS.map(p => (
                <button
                  key={p}
                  type="button"
                  className={`goal-preset-btn${dailyGoal === p ? " goal-preset-btn--active" : ""}`}
                  onClick={() => handlePreset(p)}
                >
                  {p.toLocaleString()}
                </button>
              ))}
            </div>
            <div className="goal-custom">
              <input
                type="number"
                className="goal-number-input"
                placeholder="Custom (1,000–100,000)"
                value={dailyGoal != null ? String(dailyGoal) : ""}
                min={1_000}
                max={100_000}
                step={500}
                onChange={handleNumberInput}
                aria-label="Custom daily step goal"
              />
              {dailyGoal != null && (
                <button type="button" className="goal-clear-btn" onClick={handleClear}>
                  Reset
                </button>
              )}
            </div>
          </div>
          <p className="height-hint">
            Controls the % progress bar shown after each route.
          </p>
        </>
      )}
    </div>
  );
});

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

function kgToLb(kg) {
  return kg * 2.20462;
}

// ── Weight section ────────────────────────────────────────────────────────

const WeightInput = memo(function WeightInput({ weightKg, onWeightChange }) {
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState(() => {
    try {
      return localStorage.getItem("walkpath:weightUnit") || "lb";
    } catch {
      return "lb";
    }
  });
  const [inputVal, setInputVal] = useState("");

  function handleUnitToggle() {
    const newUnit = unit === "lb" ? "kg" : "lb";
    const num = parseFloat(inputVal);
    if (!Number.isNaN(num) && num > 0) {
      const converted =
        unit === "lb" ? Math.round(lbToKg(num)) : Math.round(kgToLb(num));
      setInputVal(String(converted));
    }
    setUnit(newUnit);
    try {
      localStorage.setItem("walkpath:weightUnit", newUnit);
    } catch { /* ignore quota / privacy mode */ }
  }

  function handleChange(e) {
    const val = e.target.value;
    setInputVal(val);
    const num = parseFloat(val);
    if (!Number.isNaN(num) && num > 0) {
      onWeightChange(unit === "lb" ? lbToKg(num) : num);
    } else {
      onWeightChange(null);
    }
  }

  const hasWeight = weightKg != null;
  const displayWeight = hasWeight
    ? unit === "lb"
      ? `${Math.round(kgToLb(weightKg))} lb`
      : `${Math.round(weightKg)} kg`
    : null;

  return (
    <div className="height-section">
      <button
        type="button"
        className="height-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>
          {hasWeight
            ? `Your weight: ${displayWeight} (personalized calories)`
            : "Add your weight for personalized calories (optional)"}
        </span>
        <span className="height-toggle-chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <>
          <div className="weight-inputs">
            <input
              type="number"
              className="weight-number-input"
              value={inputVal}
              onChange={handleChange}
              min={unit === "lb" ? 66 : 30}
              max={unit === "lb" ? 661 : 300}
              placeholder={unit === "lb" ? "lbs" : "kg"}
              aria-label={`Weight in ${unit === "lb" ? "pounds" : "kilograms"}`}
            />
            <button
              type="button"
              className="weight-unit-toggle"
              onClick={handleUnitToggle}
            >
              {unit === "lb" ? "lb → kg" : "kg → lb"}
            </button>
          </div>
          <p className="height-hint">
            Used to calculate how many calories you burned.
          </p>
        </>
      )}
    </div>
  );
});

// ── Height section ────────────────────────────────────────────────────────

const HeightInput = memo(function HeightInput({ heightFt, heightIn, onChange }) {
  const [open, setOpen] = useState(false);

  function handleFt(e) {
    onChange(e.target.value, heightIn);
  }

  function handleIn(e) {
    onChange(heightFt, e.target.value);
  }

  const hasHeight = heightFt !== null;

  return (
    <div className="height-section">
      <button
        type="button"
        className="height-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>
          {hasHeight
            ? `Your height: ${heightFt}′ ${heightIn}″ (personalized steps)`
            : "Add your height for personalized steps (optional)"}
        </span>
        <span className="height-toggle-chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <>
          <div className="height-inputs">
            <div className="height-selects">
              <select
                value={heightFt ?? ""}
                onChange={handleFt}
                aria-label="Height feet"
              >
                <option value="" disabled>ft</option>
                {FT_OPTIONS.map(f => (
                  <option key={f} value={f}>{f} ft</option>
                ))}
              </select>
              <select
                value={heightIn ?? ""}
                onChange={handleIn}
                aria-label="Height inches"
                disabled={heightFt === null}
              >
                <option value="" disabled>in</option>
                {IN_OPTIONS.map(i => (
                  <option key={i} value={i}>{i} in</option>
                ))}
              </select>
            </div>
          </div>
          <p className="height-hint">
            Uses a biomechanical formula to estimate your personal stride length.
          </p>
        </>
      )}
    </div>
  );
});

// ── Pace section ──────────────────────────────────────────────────────────

const PACE_OPTIONS = [
  { value: "leisurely", label: "Leisurely", detail: "2 mph" },
  { value: "normal",    label: "Normal",    detail: "3 mph" },
  { value: "brisk",     label: "Brisk",     detail: "4 mph" },
];

export const PACE_LABELS = {
  leisurely: "Leisurely · 2 mph",
  normal:    "Normal · 3 mph",
  brisk:     "Brisk · 4 mph",
};

export function safePaceLabel(pace) {
  return Object.prototype.hasOwnProperty.call(PACE_LABELS, pace)
    ? PACE_LABELS[pace]
    : null;
}

export function loadStoredPace() {
  try {
    const v = localStorage.getItem("walkpath:walkPace");
    if (v === "leisurely" || v === "normal" || v === "brisk") return v;
  } catch { /* ignore */ }
  return "normal";
}

const PaceSelector = memo(function PaceSelector({ pace, onChange }) {
  return (
    <div className="pace-selector">
      <div className="pace-selector-label">Walking pace</div>
      <div className="pace-options">
        {PACE_OPTIONS.map(({ value, label, detail }) => (
          <button
            key={value}
            type="button"
            className={`pace-btn${pace === value ? " pace-btn--active" : ""}`}
            onClick={() => onChange(value)}
            aria-pressed={pace === value}
          >
            <span className="pace-btn-label">{label}</span>
            <span className="pace-btn-detail">{detail}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

function pathTypePhrase(pathType) {
  switch (pathType) {
    case "crosswalk":        return "through the crosswalk";
    case "steps":            return "up the steps";
    case "pedestrian plaza": return "through the pedestrian plaza";
    case "bike path":        return "along the bike path";
    case "footway":          return "along the footway";
    case "trail":            return "along the trail";
    default:                 return "along the path";
  }
}

// ── Direction list ────────────────────────────────────────────────────────

function formatStepLabel(step, i) {
  if (step.street) return `${i === 0 ? "Start on" : "Continue on"} ${step.street}`;
  return `${i === 0 ? "Walk" : "Continue"}${step.direction_full ? ` ${step.direction_full}` : ""} ${pathTypePhrase(step.path_type)}`;
}

export function formatDirectionsText(directions, result) {
  const header = `Walk Path Directions\n${result.total_miles} mi · ${result.total_minutes} min · ${result.total_steps.toLocaleString()} steps`;
  const steps = directions.map((step, i) => {
    let streetLine = formatStepLabel(step, i);
    if (step.street && step.direction_full) streetLine += ` heading ${step.direction_full}`;
    return `${i + 1}. ${streetLine} — ${formatBlocks(step.blocks, step.block_type)} · ${step.minutes} min · ${step.steps.toLocaleString()} steps`;
  });
  return [header, "", ...steps, "", "Arrive at destination."].join("\n");
}

function DirectionList({ directions = [], result, activeTurnIndex = null, onStepClick = null, legs = null }) {
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const visible = showAll ? directions : directions.slice(0, 5);
  const hasMore = directions.length > 5;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(formatDirectionsText(directions, result));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="directions-section">
      <div className="directions-heading">
        <span>Turn-by-turn directions</span>
        <div className="directions-actions">
          {result && (
            <button
              type="button"
              className={`copy-directions-btn${copied ? " copy-directions-btn--copied" : ""}`}
              onClick={handleCopy}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          )}
          {hasMore && (
            <button
              type="button"
              className="directions-toggle-all"
              onClick={() => setShowAll(v => !v)}
            >
              {showAll ? "Show fewer" : `Show all ${directions.length} steps`}
            </button>
          )}
        </div>
      </div>

      <ol className="direction-list">
        {visible.map((step, i) => {
          const prev = i > 0 ? visible[i - 1] : null;
          const showLegDivider =
            legs && step.leg_index != null &&
            (prev == null
              ? step.leg_index > 0
              : prev.leg_index !== step.leg_index);
          const legLabel = showLegDivider
            ? legs[step.leg_index]?.to_label ?? `Stop ${step.leg_index + 1}`
            : null;
          return (
            <Fragment key={`${step.street ?? step.path_type ?? "step"}-${i}`}>
              {showLegDivider && (
                <li className="direction-leg-divider" aria-hidden="false">
                  → Stop {step.leg_index + 1}: {legLabel}
                </li>
              )}
              <li
                className={[
                  "direction-item",
                  onStepClick ? "direction-item--clickable" : "",
                  i === activeTurnIndex ? "direction-item--active" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => onStepClick?.(i)}
                role={onStepClick ? "button" : undefined}
                tabIndex={onStepClick ? 0 : undefined}
                onKeyDown={onStepClick ? (e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onStepClick(i); }
                } : undefined}
              >
                <span className="direction-num">{i + 1}</span>
                <span className="direction-body">
                  <span className="direction-street">
                    {formatStepLabel(step, i)}
                  </span>
                  <div className="direction-detail">
                    {step.street && step.direction_full && `Head ${step.direction_full} · `}
                    {formatBlocks(step.blocks, step.block_type)}
                    {" · "}{step.minutes} min
                  </div>
                </span>
                <span className="direction-steps">
                  {formatSteps(step.steps)} steps
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}

// ── Alternative-route flavor tabs ─────────────────────────────────────────

const FLAVOR_LABELS = {
  fastest:      { label: "Fastest",      icon: "⚡", detail: "Shortest walk" },
  fewest_turns: { label: "Fewest turns", icon: "↔",  detail: "Simpler path"  },
  greenest:     { label: "Greenest",     icon: "🌳", detail: "More off-street" },
};

export function safeFlavorLabel(flavor) {
  return Object.prototype.hasOwnProperty.call(FLAVOR_LABELS, flavor)
    ? FLAVOR_LABELS[flavor].label
    : flavor;
}

const RouteFlavorTabs = memo(function RouteFlavorTabs({ routes, activeFlavor, onChange }) {
  if (!routes || routes.length < 2) return null;
  return (
    <div className="flavor-tabs" role="tablist" aria-label="Route alternatives">
      {routes.map(r => {
        const meta = FLAVOR_LABELS[r.flavor] ?? { label: r.flavor, icon: "•", detail: "" };
        const active = r.flavor === activeFlavor;
        return (
          <button
            key={r.flavor}
            type="button"
            role="tab"
            aria-selected={active}
            className={`flavor-tab${active ? " flavor-tab--active" : ""}`}
            onClick={() => onChange(r.flavor)}
          >
            <span className="flavor-tab-icon">{meta.icon}</span>
            <span className="flavor-tab-body">
              <span className="flavor-tab-label">{meta.label}</span>
              <span className="flavor-tab-detail">
                {r.total_miles} mi · {r.total_minutes} min · {r.total_steps.toLocaleString()} steps
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
});

// ── Step hero card ────────────────────────────────────────────────────────

function StepHero({ result, dailyGoal, onShare }) {
  const {
    total_steps, total_miles, total_minutes, calories_approx,
    daily_goal_pct, step_length_inches, personalized,
    personalized_calories,
    elevation_gain_ft,
  } = result;

  const barWidth = Math.min(daily_goal_pct, 100);
  const effectiveGoal = (dailyGoal ?? 10_000).toLocaleString();
  const calorieEquiv = calorieEquivalent(calories_approx);

  return (
    <div className="step-hero">
      <div className="step-hero-count">{formatSteps(total_steps)}</div>
      <div className="step-hero-label">steps</div>

      <div className="step-hero-stats">
        <span className="stat-chip">
          <span className="stat-chip-icon">📍</span>
          {total_miles} mi
        </span>
        <span className="stat-chip">
          <span className="stat-chip-icon">⏱</span>
          {total_minutes} min
        </span>
        <span className="stat-chip">
          <span className="stat-chip-icon">🔥</span>
          ~{calories_approx} cal
          {personalized_calories && (
            <span className="stat-chip-badge">personalized</span>
          )}
        </span>
        {elevation_gain_ft > 10 && (
          <span className="stat-chip">
            <span className="stat-chip-icon">↑</span>
            {Math.round(elevation_gain_ft)} ft
          </span>
        )}
        {safePaceLabel(result.pace) && (
          <span className="stat-chip">
            <span className="stat-chip-icon">🚶</span>
            {safePaceLabel(result.pace)}
          </span>
        )}
      </div>

      {calorieEquiv && (
        <p className="calorie-equiv">{calorieEquiv}</p>
      )}

      <div className="goal-bar-wrap">
        <div className="goal-bar-label">Daily {effectiveGoal} step goal</div>
        <div className="goal-bar-track">
          <div className="goal-bar-fill" style={{ width: `${barWidth}%` }} />
        </div>
        <div className="goal-bar-caption">{daily_goal_pct}% of daily goal</div>
      </div>

      <p className="step-note">
        {personalized
          ? `Personalized to your ${step_length_inches}″ stride length`
          : `Using average ${step_length_inches}″ stride · add your height above for a personalized count`}
      </p>

      {onShare && (
        <button type="button" className="share-card-btn" onClick={onShare}>
          📤 Share route card
        </button>
      )}
    </div>
  );
}

// ── Compare-vs-alternatives panel ─────────────────────────────────────────

function ComparePanel({ miles, walkMinutes, calories }) {
  if (!miles || miles <= 0.1) return null;
  const { driveMin, transitMin, costUsd, co2Kg } = summarize(miles, walkMinutes);
  const driveDelta = Math.round(walkMinutes - driveMin);
  const transitDelta = Math.round(walkMinutes - transitMin);

  return (
    <div className="compare-panel" aria-label="Comparison vs other transportation">
      <div className="compare-heading">Worth walking?</div>
      <ul className="compare-list">
        <li className="compare-item">
          <span className="compare-icon">💵</span>
          <span>~${costUsd.toFixed(0)} saved vs. a ride</span>
        </li>
        <li className="compare-item">
          <span className="compare-icon">🚗</span>
          <span>{driveDelta} min slower than driving</span>
        </li>
        <li className="compare-item">
          <span className="compare-icon">🚌</span>
          <span>{transitDelta > 0 ? `${transitDelta} min slower than transit` : "About as fast as transit"}</span>
        </li>
        <li className="compare-item">
          <span className="compare-icon">🌱</span>
          <span>{co2Kg.toFixed(2)} kg CO₂ avoided</span>
        </li>
        {calories > 0 && (
          <li className="compare-item">
            <span className="compare-icon">🔥</span>
            <span>~{calories} cal you&apos;d otherwise miss</span>
          </li>
        )}
      </ul>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="skeleton-wrapper" aria-busy="true" aria-label="Loading route">
      <div className="skeleton skeleton-line skeleton-line--long" />
      <div className="skeleton skeleton-line skeleton-line--medium" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-line skeleton-line--short" />
    </div>
  );
}

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
        <div className="error" role="alert">
          Something went wrong displaying your route — try a new search.
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Recent Searches ───────────────────────────────────────────────────────

const RECENT_KEY = "walkpath:recentSearches";
export const RECENT_MAX = 10;

export function loadRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecentSearch(originOrStops, destination) {
  try {
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
    const sigOf = (r) => (Array.isArray(r.stops) ? r.stops : [r.origin, r.destination]).join("");
    const deduped = existing.filter(r => sigOf(r) !== sig);
    const updated = [entry, ...deduped].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return null;
  }
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

function RecentSearches({ searches, onSelect, onClear }) {
  if (!searches.length) return null;

  return (
    <div className="recent-searches">
      <div className="recent-searches-header">
        <span className="recent-searches-label">Recent routes</span>
        <button type="button" className="recent-clear-btn" onClick={onClear}>
          Clear history
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

// ── Step log (Multi-Day Step Accumulator) ────────────────────────────────

const STEP_LOG_KEY = "walkpath:stepLog";
export const STEP_LOG_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function pruneExpired(entries, now = Date.now()) {
  const cutoff = now - STEP_LOG_TTL_DAYS * DAY_MS;
  return entries.filter(e => typeof e?.timestamp === "number" && e.timestamp >= cutoff);
}

export function loadStepLog() {
  try {
    const raw = localStorage.getItem(STEP_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const pruned = pruneExpired(parsed);
    if (pruned.length !== parsed.length) {
      try { localStorage.setItem(STEP_LOG_KEY, JSON.stringify(pruned)); } catch { /* ignore */ }
    }
    return pruned;
  } catch {
    return [];
  }
}

export function logWalk({ steps, miles, origin, destination }) {
  try {
    const existing = loadStepLog();
    const now = Date.now();
    const entry = {
      timestamp: now,
      date: new Date(now).toISOString().slice(0, 10),
      steps: Number(steps) || 0,
      miles: Number(miles) || 0,
      origin: String(origin ?? ""),
      destination: String(destination ?? ""),
    };
    const updated = [entry, ...existing];
    localStorage.setItem(STEP_LOG_KEY, JSON.stringify(updated));
    return entry;
  } catch {
    return null;
  }
}

export function clearStepLog() {
  try { localStorage.removeItem(STEP_LOG_KEY); } catch { /* ignore */ }
}

function WeeklySummaryPanel({ log, dailyGoal, onClear }) {
  const [open, setOpen] = useState(false);

  const totals = useMemo(() => {
    let steps = 0;
    let miles = 0;
    for (const e of log) {
      steps += Number(e.steps) || 0;
      miles += Number(e.miles) || 0;
    }
    return { steps, miles };
  }, [log]);

  if (!log.length) return null;

  const weeklyGoal = (dailyGoal ?? 10_000) * 7;
  const weeklyPct = Math.min(100, Math.round((totals.steps / weeklyGoal) * 100));

  return (
    <div className="weekly-summary">
      <button
        type="button"
        className="weekly-summary-toggle"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span>
          This week: {totals.steps.toLocaleString()} steps · {totals.miles.toFixed(1)} mi
        </span>
        <span className="weekly-summary-chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="weekly-summary-body">
          <div className="goal-bar-wrap">
            <div className="goal-bar-label">
              Weekly goal: {weeklyGoal.toLocaleString()} steps
            </div>
            <div className="goal-bar-track">
              <div className="goal-bar-fill" style={{ width: `${weeklyPct}%` }} />
            </div>
            <div className="goal-bar-caption">{weeklyPct}% of weekly goal</div>
          </div>

          <ol className="weekly-log-list">
            {log.map(e => (
              <li key={e.timestamp} className="weekly-log-item">
                <span className="weekly-log-date">{e.date}</span>
                <span className="weekly-log-route">
                  {e.origin} → {e.destination}
                </span>
                <span className="weekly-log-steps">
                  {Number(e.steps).toLocaleString()} steps
                </span>
              </li>
            ))}
          </ol>

          <button type="button" className="weekly-clear-btn" onClick={onClear}>
            Clear log
          </button>
          <p className="weekly-summary-hint">
            Entries auto-expire after 7 days.
          </p>
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────

function loadAccessPrefs() {
  try {
    const raw = localStorage.getItem("walkpath:accessPrefs");
    if (!raw) return { avoidStairs: false, preferPedestrian: false };
    const parsed = JSON.parse(raw);
    return {
      avoidStairs: !!parsed.avoidStairs,
      preferPedestrian: !!parsed.preferPedestrian,
    };
  } catch {
    return { avoidStairs: false, preferPedestrian: false };
  }
}

export default function App() {
  const [stops, setStops] = useState(() => {
    const p = readUrlParams();
    if (p.stops?.length) {
      return p.stops.map(v => ({ id: makeStopId(), value: v }));
    }
    return [
      { id: makeStopId(), value: p.from || "" },
      { id: makeStopId(), value: p.to   || "" },
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

  const [heightFt, setHeightFt]       = useState(() => readUrlParams().hft);
  const [heightIn, setHeightIn]       = useState(() => {
    const { hft, hin } = readUrlParams();
    return hft != null ? hin : null;
  });
  const [weightKg, setWeightKg]       = useState(null);
  const [dailyGoal, setDailyGoalState] = useState(() => loadDailyGoal());
  const [walkPace, setWalkPace]         = useState(loadStoredPace);

  const initialPrefs = loadAccessPrefs();
  const [avoidStairs, setAvoidStairs]           = useState(initialPrefs.avoidStairs);
  const [preferPedestrian, setPreferPedestrian] = useState(initialPrefs.preferPedestrian);

  useEffect(() => {
    try {
      localStorage.setItem(
        "walkpath:accessPrefs",
        JSON.stringify({ avoidStairs, preferPedestrian }),
      );
    } catch { /* ignore quota / privacy mode */ }
  }, [avoidStairs, preferPedestrian]);

  useEffect(() => {
    try { localStorage.setItem("walkpath:walkPace", walkPace); } catch { /* ignore */ }
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
    const p = readUrlParams();
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
    try {
      if (val != null) {
        localStorage.setItem("walkpath:dailyGoal", String(val));
      } else {
        localStorage.removeItem("walkpath:dailyGoal");
      }
    } catch { /* ignore quota / privacy mode */ }
  }, []);

  function handleSwap() {
    if (stops.some(s => !s.value.trim())) return;
    reverseStops();
  }

  async function fetchRoute(stopsList) {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError("");
    setResult(null);

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
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        let msg = `Service error (${res.status})`;
        try {
          const d = await res.json();
          if (d.detail && typeof d.detail === "object" && d.detail.message) {
            msg = d.detail.message;
          } else if (typeof d.detail === "string") {
            msg = d.detail;
          }
        } catch { /* not json */ }
        throw new Error(msg);
      }

      setResult(await res.json());
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
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
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
    try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
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
      const slug = `${origin}-to-${destination}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

  const handleMapPick = useCallback(async (lat, lon) => {
    const targetId = pickMode; // capture before clearing
    setPickMode(null);
    if (!targetId) return;

    const coordStr = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    setStopValue(targetId, coordStr);

    try {
      const res = await fetchWithTimeout(`${BACKEND_URL}/reverse-geocode?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`);
      const data = await res.json();
      if (res.ok && typeof data?.label === "string") {
        const label = data.label.trim().slice(0, 200);
        if (label) setStopValue(targetId, label);
      }
    } catch {
      setToastMsg("Couldn't name that spot — using coordinates");
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToastMsg(""), 3500);
    }
  }, [pickMode]);  // setStopValue is stable; BACKEND_URL, setters captured

  return (
    <div className="app">
      <div className="layout">

        {/* ── Left panel ── */}
        <div className="panel-cards">
          <header className="header">
            <div className="header-top">
              <h1 className="app-title">
                <span className="app-title-icon">🚶</span>
                Walk Path
              </h1>
              <span className="city-pill">
                📍 Chicago, IL
              </span>
            </div>
            <p className="tagline">Real walking directions with exact step counts</p>
          </header>

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
                          title={pickMode === stop.id ? "Cancel pick" : "Click map to set this stop"}
                          aria-label={pickMode === stop.id ? "Cancel pick mode" : `Set ${label} by clicking map`}
                        >
                          📍
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
                          ↑
                        </button>
                        <button
                          type="button"
                          className="stop-move-btn"
                          onClick={() => moveStop(stop.id, 1)}
                          disabled={isLast}
                          aria-label={`Move ${label} down`}
                          title="Move down"
                        >
                          ↓
                        </button>
                        {canRemove && (
                          <button
                            type="button"
                            className="stop-remove-btn"
                            onClick={() => removeStop(stop.id)}
                            aria-label={`Remove ${label}`}
                            title="Remove stop"
                          >
                            ✕
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
                    {stops.length >= MAX_STOPS
                      ? `Maximum ${MAX_STOPS} stops`
                      : "＋ Add stop"}
                  </button>
                  <button
                    type="button"
                    className="swap-btn"
                    onClick={handleSwap}
                    aria-label="Reverse stops"
                    title="Reverse the order of all stops"
                    disabled={stops.some(s => !s.value.trim())}
                  >
                    ↕ Reverse
                  </button>
                </div>
              </div>

              <HeightInput
                heightFt={heightFt}
                heightIn={heightIn}
                onChange={handleHeightChange}
              />

              <WeightInput
                weightKg={weightKg}
                onWeightChange={handleWeightChange}
              />

              <StepGoalInput
                dailyGoal={dailyGoal}
                onChange={handleGoalChange}
              />

              <PaceSelector
                pace={walkPace}
                onChange={setWalkPace}
              />

              <fieldset className="access-prefs">
                <legend>Route preferences</legend>
                <label className="access-pref">
                  <input
                    type="checkbox"
                    checked={avoidStairs}
                    onChange={e => setAvoidStairs(e.target.checked)}
                  />
                  <span>Avoid stairs</span>
                </label>
                <label className="access-pref">
                  <input
                    type="checkbox"
                    checked={preferPedestrian}
                    onChange={e => setPreferPedestrian(e.target.checked)}
                  />
                  <span>Prefer pedestrian paths</span>
                </label>
              </fieldset>

              <button type="submit" className="btn-route" disabled={loading}>
                {loading ? "Finding route…" : "Get walking route"}
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
              <div className="error" role="alert">{error}</div>
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
                    Multi-stop routes use the fastest flavor. Alternative routes
                    (fewest turns / greenest) are available for 2-stop walks only.
                  </div>
                )}

                <StepHero result={viewResult} dailyGoal={dailyGoal} onShare={handleOpenShare} />

                <ComparePanel
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
                  {walkLogged ? "✓ Logged this walk" : "＋ Log this walk"}
                </button>

                <div className="motivation">
                  {motivationMessage(viewResult.total_steps)}
                </div>

                <DirectionList
                  directions={viewResult.directions}
                  result={viewResult}
                  activeTurnIndex={activeTurnIndex}
                  onStepClick={setActiveTurnIndex}
                  legs={isMultiStop ? (result.legs ?? null) : null}
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
          />
        </div>

      </div>

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
              <RouteCard
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

    </div>
  );
}
