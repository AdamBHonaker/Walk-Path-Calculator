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
    <section
      className="directions-section"
      style={{
        border: "1px solid var(--ink)",
        background: "var(--paper-bright)",
        padding: 0,
      }}
    >
      <header
        className="directions-heading"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          padding: "12px 16px",
          borderBottom: "2px solid var(--ink)",
          borderTopRightRadius: 0,
          borderTopLeftRadius: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--wf-sans)",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "var(--ink)",
          }}
        >
          Plotted route · {directions.length} {directions.length === 1 ? "turn" : "turns"}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: 12,
          }}
        >
          {headerSummary && (
            <span
              style={{
                fontFamily: "var(--wf-mono)",
                fontSize: 11,
                color: "var(--ink)",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: 0.5,
              }}
            >
              {headerSummary}
            </span>
          )}
          {result && (
            <button
              type="button"
              onClick={handleCopy}
              style={{
                background: "transparent",
                border: "1px solid var(--mute-fog)",
                fontFamily: "var(--wf-sans)",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                padding: "8px 12px",
                minHeight: 36,
                cursor: "pointer",
                color: "var(--ink)",
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </span>
      </header>

      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
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
          return (
            <Fragment key={`${step.street ?? step.path_type ?? "step"}-${i}`}>
              {showLegDivider && (
                <li
                  style={{
                    padding: "6px 16px",
                    background: "var(--paper)",
                    borderTop: "1px solid var(--ink)",
                    borderBottom: "1px solid var(--ink)",
                    fontFamily: "var(--wf-serif)",
                    fontStyle: "italic",
                    fontSize: 12,
                    color: "var(--mute)",
                    textAlign: "center",
                  }}
                >
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
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px 1fr auto",
                  alignItems: "baseline",
                  columnGap: 12,
                  padding: "12px 16px",
                  minHeight: 44,
                  borderLeft: isActive ? "3px solid var(--ember)" : "3px solid transparent",
                  borderBottom: isFinal ? "none" : "1px dashed var(--mute-fog)",
                  cursor: onStepClick ? "pointer" : "default",
                  background: isActive ? "var(--paper)" : "transparent",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--wf-mono)",
                    fontSize: 11,
                    color: isActive ? "var(--ember)" : "var(--mute)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  <span
                    style={{
                      display: "block",
                      fontFamily: "var(--wf-serif)",
                      fontStyle: "italic",
                      fontSize: 14,
                      color: isActive ? "var(--ink)" : "var(--ink-soft)",
                      lineHeight: 1.35,
                    }}
                  >
                    {formatStepLabel(step, i)}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontFamily: "var(--wf-mono)",
                      fontSize: 11,
                      color: "var(--mute)",
                      fontVariantNumeric: "tabular-nums",
                      marginTop: 2,
                    }}
                  >
                    {step.street && step.direction_full && `Head ${step.direction_full} · `}
                    {formatBlocks(step.blocks, step.block_type)}
                    {" · "}{step.minutes} min
                  </span>
                </span>
                <span
                  style={{
                    fontFamily: "var(--wf-mono)",
                    fontSize: 11,
                    color: "var(--ink-soft)",
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatSteps(step.steps)} steps
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>

      {(showAll || !hasMore) && directions.length > 0 && (
        <footer
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "12px 16px",
            borderTop: "1px solid var(--ink)",
            fontFamily: "var(--wf-sans)",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "var(--ember)",
          }}
        >
          Arrive at destination
          <WFToMark size={14} />
        </footer>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            borderTop: "1px solid var(--mute-fog)",
            padding: "12px 16px",
            minHeight: 44,
            fontFamily: "var(--wf-serif)",
            fontStyle: "italic",
            fontSize: 13,
            color: "var(--ember)",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          {showAll ? "Show fewer" : `Show all ${directions.length} steps`}
        </button>
      )}
    </section>
  );
}
