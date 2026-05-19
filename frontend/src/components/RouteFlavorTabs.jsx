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
      <div className="route-flavor-wheeled-note" role="note">
        Optimized for accessible routes.
      </div>
    );
  }
  if (!routes || routes.length < 2) return null;
  return (
    <div
      role="tablist"
      aria-label="Route alternatives"
      className="route-flavor-tablist"
      style={{ gridTemplateColumns: `repeat(${routes.length}, 1fr)` }}
    >
      {routes.map((r) => {
        const meta = FLAVOR_META[r.flavor] ?? { label: r.flavor, icon: null, detail: "" };
        const isActive = r.flavor === activeFlavor;
        const tabClass = [
          "route-flavor-tab",
          isCompact ? "route-flavor-tab--compact" : "",
          isActive ? "route-flavor-tab--active" : "",
        ].filter(Boolean).join(" ");
        return (
          <button
            key={r.flavor}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={meta.detail || undefined}
            onClick={() => onChange(r.flavor)}
            className={tabClass}
          >
            {meta.icon && (
              <WPIcon name={meta.icon} size={16} color={isActive ? "var(--ember)" : "currentColor"} />
            )}
            <span className="route-flavor-tab__label">{meta.label}</span>
            {!isCompact && (
              <span className="route-flavor-tab__stats">
                {r.total_miles} MI · {r.total_minutes} MIN · {r.total_steps.toLocaleString()} STEPS
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
