import { WPIcon } from "../wayfarer/walkpath-icons.jsx";
import { useMediaQuery, MQ_MOBILE } from "../lib/useMediaQuery.js";

const FLAVOR_META = {
  fastest:      { label: "Fastest",      icon: "bolt",   detail: "Shortest route" },
  fewest_turns: { label: "Fewest turns", icon: "branch", detail: "Simpler path" },
  greenest:     { label: "Greenest",     icon: "tree",   detail: "Through parks, under canopy" },
};

export function RouteFlavorTabs({ routes, activeFlavor, onChange, mobilityProfile = "walking" }) {
  // Below 480px the per-tab stats line ("X mi · Y min · Z STEPS") is too
  // dense for ~107px-wide tabs. Drop the stats; the StepHero below the tabs
  // shows the active flavor's stats anyway.
  const isCompact = useMediaQuery(MQ_MOBILE);

  // Wheeled mode collapses to a single `custom` flavor (prefer_pedestrian
  // defaults on). Render a tiny explainer in place of the tabs so the user
  // knows alternatives aren't missing — they're intentionally hidden.
  if ((!routes || routes.length < 2) && mobilityProfile === "wheeled") {
    return (
      <div
        className="route-flavor-wheeled-note"
        role="note"
        style={{
          padding: "8px 6px",
          borderBottom: "1px solid var(--mute-fog)",
          fontFamily: "var(--wf-sans)",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          color: "var(--mute)",
          textAlign: "center",
        }}
      >
        Optimized for accessible routes.
      </div>
    );
  }
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
            title={meta.detail || undefined}
            onClick={() => onChange(r.flavor)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              padding: isCompact ? "12px 6px" : "10px 6px",
              minHeight: 44,
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
            {!isCompact && (
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
            )}
          </button>
        );
      })}
    </div>
  );
}
