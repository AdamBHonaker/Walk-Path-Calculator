import React, { useMemo, useState } from "react";

export function WeeklySummaryPanel({ log, dailyGoal, onClear }) {
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
        <span>This week</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--wf-mono)", fontVariantNumeric: "tabular-nums" }}>
            {totals.steps.toLocaleString()} steps walked over {totals.miles.toFixed(1)} mi
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
              Weekly measure · {weeklyGoal.toLocaleString()} steps
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
                  {Number(e.steps).toLocaleString()} steps
                  {e.miles ? ` · ${Number(e.miles).toFixed(1)} mi` : ""}
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
