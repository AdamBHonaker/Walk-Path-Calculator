import { Fragment, useState } from "react";
import { formatStepLabel, formatBlocks, formatSteps } from "../lib/directionFormat.js";
import { WFToMark } from "../wayfarer/primitives.jsx";

export function DirectionLedger({
  directions = [],
  result,
  activeTurnIndex = null,
  onStepClick = null,
  legs = null,
  formatDirectionsText,
}) {
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

  const headerSummary = result
    ? `${result.total_miles} MI · ${result.total_minutes} MIN`
    : null;

  return (
    <section className="directions-section">
      <header className="directions-heading">
        <span className="directions-heading-eyebrow">
          Plotted route · {directions.length} {directions.length === 1 ? "turn" : "turns"}
        </span>
        <span className="directions-heading-meta">
          {headerSummary && (
            <span className="directions-heading-summary">{headerSummary}</span>
          )}
          {result && (
            <button
              type="button"
              onClick={handleCopy}
              className="directions-copy-btn"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </span>
      </header>

      <ol className="directions-list">
        {visible.map((step, i) => {
          const isActive = i === activeTurnIndex;
          const isFinal = i === visible.length - 1 && (showAll || !hasMore);
          const prev = i > 0 ? visible[i - 1] : null;
          const showLegDivider =
            legs && step.leg_index != null &&
            (prev == null
              ? step.leg_index > 0
              : prev.leg_index !== step.leg_index);
          const legLabel = showLegDivider
            ? legs[step.leg_index]?.to_label ?? `Stop ${step.leg_index + 1}`
            : null;
          const rowCls = [
            "direction-row",
            onStepClick && "direction-row--clickable",
            isActive && "direction-row--active",
            isFinal && "direction-row--final",
          ].filter(Boolean).join(" ");
          return (
            <Fragment key={`${step.street ?? step.path_type ?? "step"}-${i}`}>
              {showLegDivider && (
                <li className="direction-leg-divider">
                  → Stop {step.leg_index + 1}: {legLabel}
                </li>
              )}
              <li
                onClick={() => onStepClick?.(i)}
                role={onStepClick ? "button" : undefined}
                tabIndex={onStepClick ? 0 : undefined}
                onKeyDown={onStepClick ? (e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onStepClick(i); }
                } : undefined}
                className={rowCls}
              >
                <span className="direction-row-num">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  <span className="direction-row-label">
                    {formatStepLabel(step, i)}
                  </span>
                  <span className="direction-row-meta">
                    {step.street && step.direction_full && `Head ${step.direction_full} · `}
                    {formatBlocks(step.blocks, step.block_type)}
                    {" · "}{step.minutes} min
                  </span>
                </span>
                <span className="direction-row-steps">
                  {formatSteps(step.steps)} steps
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>

      {(showAll || !hasMore) && directions.length > 0 && (
        <footer className="directions-arrival">
          Arrive at destination
          <WFToMark size={14} />
        </footer>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="directions-show-toggle"
        >
          {showAll ? "Show fewer" : `Show all ${directions.length} steps`}
        </button>
      )}
    </section>
  );
}
