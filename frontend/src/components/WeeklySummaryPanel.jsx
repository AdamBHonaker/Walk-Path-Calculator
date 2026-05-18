import { useMemo, useState } from "react";

export function WeeklySummaryPanel({ log, dailyGoal, onClear, metricMode = "steps", stepLengthInches }) {
  const [open, setOpen] = useState(false);
  const isDistance = metricMode === "distance";

  const totals = useMemo(() => {
    let steps = 0;
    let miles = 0;
    let minutes = 0;
    for (const e of log) {
      steps += Number(e.steps) || 0;
      miles += Number(e.miles) || 0;
      minutes += Number(e.minutes) || 0;
    }
    return { steps, miles, minutes };
  }, [log]);

  if (!log.length) return null;

  // Distance mode derives a weekly miles target from the user's daily step goal
  // and stride length, so the existing dailyGoal slider drives both modes.
  const stride = Number.isFinite(stepLengthInches) ? stepLengthInches : 30;
  const weeklyStepGoal = (dailyGoal ?? 10_000) * 7;
  const weeklyMileGoal = (weeklyStepGoal * stride) / (12 * 5280);
  const weeklyPct = isDistance
    ? Math.min(100, Math.round((totals.miles / Math.max(weeklyMileGoal, 0.0001)) * 100))
    : Math.min(100, Math.round((totals.steps / weeklyStepGoal) * 100));

  return (
    <div className="weekly-summary">
      <button
        type="button"
        className="weekly-summary-toggle"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span>This week</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--wf-mono)", fontVariantNumeric: "tabular-nums" }}>
            {isDistance
              ? `${totals.miles.toFixed(1)} mi over ${Math.round(totals.minutes)} min`
              : `${totals.steps.toLocaleString()} steps walked over ${totals.miles.toFixed(1)} mi`}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              color: "var(--mute)",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s ease",
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="weekly-summary-body">
          <div className="goal-bar-wrap">
            <div className="goal-bar-label">
              {isDistance
                ? `Weekly measure · ${weeklyMileGoal.toFixed(1)} mi`
                : `Weekly measure · ${weeklyStepGoal.toLocaleString()} steps`}
              <span style={{ float: "right", fontFamily: "var(--wf-mono)", letterSpacing: 0 }}>
                {weeklyPct}%
              </span>
            </div>
            <div className="goal-bar-track">
              <div className="goal-bar-fill" style={{ width: `${weeklyPct}%` }} />
            </div>
          </div>

          <ol className="weekly-log-list">
            {log.map(e => (
              <li key={e.timestamp} className="weekly-log-item">
                <span className="weekly-log-date">{e.date}</span>
                <span className="weekly-log-route">
                  <em>From</em> {e.origin} <em>to</em> {e.destination}
                </span>
                <span className="weekly-log-steps">
                  {isDistance
                    ? <>{Number(e.miles || 0).toFixed(1)} mi{Number.isFinite(Number(e.minutes)) && e.minutes != null ? ` · ${Math.round(Number(e.minutes))} min` : " · —"}</>
                    : <>{Number(e.steps).toLocaleString()} steps{e.miles ? ` · ${Number(e.miles).toFixed(1)} mi` : ""}</>}
                </span>
              </li>
            ))}
          </ol>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <p className="weekly-summary-hint">Entries fade after seven days.</p>
            <button type="button" className="weekly-clear-btn" onClick={onClear}>
              Clear log
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
