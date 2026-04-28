import { useState, useRef, useEffect } from "react";
import "./App.css";
import MapView from "./MapView.jsx";

function normalizeBackendUrl(rawUrl) {
  if (!rawUrl) return null;
  return rawUrl.match(/^https?:\/\//i) ? rawUrl : `https://${rawUrl}`;
}

const BACKEND_URL = normalizeBackendUrl(import.meta.env.VITE_BACKEND_URL) || "http://localhost:8000";
console.log('BACKEND_URL:', BACKEND_URL); // Debug: check what URL is being used

// ── Helpers ───────────────────────────────────────────────────────────────

function formatSteps(n) {
  return n.toLocaleString();
}

function formatBlocks(blocks, blockType) {
  const t = blockType === "long" ? "long block" : "short block";
  return `${blocks} ${blocks === 1 ? t : t + "s"}`;
}

function motivationMessage(steps) {
  if (steps < 1500) return "A great short walk. Every step counts toward your health!";
  if (steps < 4000) return "A solid neighborhood walk — this is exactly what daily health looks like.";
  if (steps < 7000) return "You're racking up serious steps. This beats a car ride every time.";
  if (steps < 10000) return "Almost a full day's goal in one trip — this walk is genuinely good for you.";
  return "Over 10,000 steps in a single walk! That's extraordinary. Your body will thank you.";
}

// ── Height section ────────────────────────────────────────────────────────

function HeightInput({ heightFt, heightIn, onChange }) {
  const [open, setOpen] = useState(false);

  function handleFt(e) {
    const ft = parseInt(e.target.value, 10);
    onChange(ft, heightIn);
  }

  function handleIn(e) {
    const inches = parseInt(e.target.value, 10);
    onChange(heightFt, inches);
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
                {[4, 5, 6, 7].map(f => (
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
                {Array.from({ length: 12 }, (_, i) => (
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
}

// ── Direction list ────────────────────────────────────────────────────────

function DirectionList({ directions }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? directions : directions.slice(0, 5);
  const hasMore = directions.length > 5;

  return (
    <div className="directions-section">
      <div className="directions-heading">
        <span>Turn-by-turn directions</span>
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

      <ol className="direction-list">
        {visible.map((step, i) => (
          <li key={i} className="direction-item">
            <span className="direction-num">{i + 1}</span>
            <span className="direction-body">
              <span className="direction-street">
                {i === 0 ? "Start on" : "Continue on"} {step.street}
              </span>
              <div className="direction-detail">
                {step.direction_full && `Head ${step.direction_full} · `}
                {formatBlocks(step.blocks, step.block_type)}
                {" · "}{step.minutes} min
              </div>
            </span>
            <span className="direction-steps">
              {formatSteps(step.steps)} steps
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Step hero card ────────────────────────────────────────────────────────

function StepHero({ result }) {
  const {
    total_steps, total_miles, total_minutes, calories_approx,
    daily_goal_pct, step_length_inches, personalized,
  } = result;

  const barWidth = Math.min(daily_goal_pct, 100);

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
        </span>
      </div>

      <div className="goal-bar-wrap">
        <div className="goal-bar-label">Daily 10,000 step goal</div>
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

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  const [origin, setOrigin]           = useState("");
  const [destination, setDestination] = useState("");
  const [heightFt, setHeightFt]       = useState(null);
  const [heightIn, setHeightIn]       = useState(null);

  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const abortRef = useRef(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  function handleHeightChange(ft, inches) {
    setHeightFt(ft === "" ? null : Number(ft));
    setHeightIn(inches === "" ? null : Number(inches));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!origin.trim() || !destination.trim()) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError("");
    setResult(null);

    // Compute total height in inches if both fields are set
    const height_inches =
      heightFt !== null && heightIn !== null
        ? heightFt * 12 + heightIn
        : null;

    try {
      const res = await fetch(`${BACKEND_URL}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin:      origin.trim(),
          destination: destination.trim(),
          height_inches,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        let msg = `Service error (${res.status})`;
        try { const d = await res.json(); msg = d.detail || msg; } catch { /* not json */ }
        throw new Error(msg);
      }

      setResult(await res.json());
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

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
              <label>
                From
                <input
                  type="search"
                  placeholder="e.g. Wrigleyville, 600 N Clark St"
                  value={origin}
                  onChange={e => setOrigin(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="words"
                  enterKeyHint="next"
                />
              </label>

              <label>
                To
                <input
                  type="search"
                  placeholder="e.g. Logan Square, Navy Pier"
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="words"
                  enterKeyHint="go"
                />
              </label>

              <HeightInput
                heightFt={heightFt}
                heightIn={heightIn}
                onChange={handleHeightChange}
              />

              <button type="submit" className="btn-route" disabled={loading}>
                {loading ? "Finding route…" : "Get walking route"}
              </button>
            </form>

            {error && (
              <div className="error" role="alert">{error}</div>
            )}

            {loading && <LoadingSkeleton />}

            {result && !loading && (
              <>
                <StepHero result={result} />

                <div className="motivation">
                  {motivationMessage(result.total_steps)}
                </div>

                <DirectionList directions={result.directions} />
              </>
            )}
          </main>
        </div>

        {/* ── Map panel ── */}
        <div className="panel-map">
          <MapView result={result} />
        </div>

      </div>
    </div>
  );
}
