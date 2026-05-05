import React from "react";
import { WPIcon } from "../wayfarer/walkpath-icons.jsx";

const FLAVOR_META = {
  fastest:      { label: "Fastest",      icon: "bolt",   detail: "Shortest walk" },
  fewest_turns: { label: "Fewest turns", icon: "branch", detail: "Simpler path" },
  greenest:     { label: "Greenest",     icon: "tree",   detail: "More off-street" },
};

export function RouteFlavorTabs({ routes, activeFlavor, onChange }) {
  if (!routes || routes.length < 2) return null;
  return (
    <div
      role="tablist"
      aria-label="Route alternatives"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${routes.length}, 1fr)`,
        borderBottom: "1px solid var(--mute-fog)",
        background: "transparent",
      }}
    >
      {routes.map((r) => {
        const meta = FLAVOR_META[r.flavor] ?? { label: r.flavor, icon: null, detail: "" };
        const isActive = r.flavor === activeFlavor;
        return (
          <button
            key={r.flavor}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(r.flavor)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              padding: "10px 6px",
              background: "transparent",
              border: "none",
              borderBottom: isActive ? "2px solid var(--ember)" : "2px solid transparent",
              marginBottom: -1,
              color: isActive ? "var(--ink)" : "var(--mute)",
              cursor: "pointer",
              transition: "color 120ms ease",
            }}
          >
            {meta.icon && (
              <WPIcon name={meta.icon} size={16} color={isActive ? "var(--ember)" : "currentColor"} />
            )}
            <span
              style={{
                fontFamily: "var(--wf-serif)",
                fontStyle: "italic",
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {meta.label}
            </span>
            <span
              style={{
                fontFamily: "var(--wf-mono)",
                fontSize: 10,
                fontVariantNumeric: "tabular-nums",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                color: "var(--mute)",
              }}
            >
              {r.total_miles} MI · {r.total_minutes} MIN · {r.total_steps.toLocaleString()} STEPS
            </span>
          </button>
        );
      })}
    </div>
  );
}
