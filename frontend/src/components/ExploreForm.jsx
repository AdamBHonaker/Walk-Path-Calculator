// Origin selector + time-budget slider for the Neighborhood Explorer.
// Used inside the desktop sidebar and inside the mobile bottom-sheet body —
// the markup is identical in both surfaces; the parent wraps it to taste.
//
// Props:
//   origin               — { kind, communityArea }
//   onOriginChange       — receives a new origin object
//   maxMinutes           — current time budget, 5..45
//   onMaxMinutesChange   — receives the new minutes value
//   onSubmit             — fires when the user releases the slider OR clicks
//                          the explicit "Discover" button
//   loading              — disables the submit button while a request is open
//   reachableNeighborhoods — list of strings to render as chips below the
//                          slider; null/empty hides the chip rail
//   onChipClick          — fires with the chip's label when tapped — the
//                          App handles "exit explore mode + populate To"
//   onLocateMe           — when the user picks "📍 My location" we ask the
//                          parent to resolve the browser geolocation
//                          (the parent owns the geolocation lifecycle).
//   locating             — true while geolocation is in flight
//   geoError             — short string shown beside the radio when the
//                          geolocation attempt failed

import { useEffect, useMemo, useRef } from "react";
import { COMMUNITY_AREA_NAMES } from "../lib/communityAreas.js";
import { EXPLORE_BUDGET_MIN, EXPLORE_BUDGET_MAX } from "../lib/explorePrefs.js";
import { WPIcon } from "../wayfarer/walkpath-icons.jsx";

const SLIDER_TICKS = [5, 10, 15, 20, 25, 30, 35, 40, 45];

export function ExploreForm({
  origin,
  onOriginChange,
  maxMinutes,
  onMaxMinutesChange,
  onSubmit,
  loading,
  reachableNeighborhoods,
  onChipClick,
  onLocateMe,
  locating,
  geoError,
}) {
  // Track the slider's "in-progress" value so parent doesn't fire a fetch on
  // every tiny step. We commit (call onSubmit) only on pointer/key release.
  const submitRef = useRef(onSubmit);
  useEffect(() => { submitRef.current = onSubmit; }, [onSubmit]);

  function handleOriginKindChange(kind) {
    if (kind === "current") {
      onOriginChange({ kind: "current", communityArea: null });
      onLocateMe?.();
    } else {
      // Default to the previous community-area pick if we had one in memory,
      // otherwise the prefs default ("Loop").
      onOriginChange({
        kind: "community_area",
        communityArea: origin?.communityArea || "Loop",
      });
    }
  }

  function handleAreaChange(e) {
    const name = e.target.value;
    onOriginChange({ kind: "community_area", communityArea: name });
  }

  function handleSliderChange(e) {
    const next = Math.round(Number(e.target.value));
    if (Number.isFinite(next)) onMaxMinutesChange(next);
  }

  function handleSliderRelease() {
    submitRef.current?.();
  }

  // Local helper — show a humane fragment under the slider so a user
  // who's never seen an isochrone immediately understands the dial.
  const budgetSummary = useMemo(() => {
    const miles = (maxMinutes / 60) * 3; // 3 mph internal pace.
    return `≈ ${miles.toFixed(1)} mi at a steady walk`;
  }, [maxMinutes]);

  const chipsToShow = Array.isArray(reachableNeighborhoods) ? reachableNeighborhoods : [];

  return (
    <div className="explore-form">
      <div className="explore-section">
        <div className="explore-section-label">
          <WPIcon name="crosshair" size={12} />
          <span>Begin exploring from</span>
        </div>

        <div className="explore-origin-modes">
          <button
            type="button"
            className={`explore-origin-btn${origin?.kind === "current" ? " explore-origin-btn--active" : ""}`}
            onClick={() => handleOriginKindChange("current")}
            disabled={locating}
            aria-pressed={origin?.kind === "current"}
          >
            <span className="explore-origin-btn-glyph" aria-hidden="true">
              {locating ? "…" : "📍"}
            </span>
            <span className="explore-origin-btn-text">
              <span className="explore-origin-btn-title">My location</span>
              <span className="explore-origin-btn-sub">
                {locating
                  ? "Reading the compass…"
                  : geoError
                    ? geoError
                    : "Use the device's compass"}
              </span>
            </span>
          </button>

          <button
            type="button"
            className={`explore-origin-btn${origin?.kind === "community_area" ? " explore-origin-btn--active" : ""}`}
            onClick={() => handleOriginKindChange("community_area")}
            aria-pressed={origin?.kind === "community_area"}
          >
            <span className="explore-origin-btn-glyph" aria-hidden="true">🏘️</span>
            <span className="explore-origin-btn-text">
              <span className="explore-origin-btn-title">Community area</span>
              <span className="explore-origin-btn-sub">Pick from the 77</span>
            </span>
          </button>
        </div>

        {origin?.kind === "community_area" && (
          <div className="explore-area-select">
            <select
              value={origin.communityArea || ""}
              onChange={handleAreaChange}
              aria-label="Community area"
            >
              {COMMUNITY_AREA_NAMES.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="explore-section">
        <div className="explore-section-label">
          <WPIcon name="hourglass" size={12} />
          <span>How long can you walk?</span>
        </div>

        <div className="explore-budget">
          <div className="explore-budget-readout">
            <span className="explore-budget-num">{maxMinutes}</span>
            <span className="explore-budget-unit">min</span>
          </div>
          <input
            type="range"
            className="explore-slider"
            min={EXPLORE_BUDGET_MIN}
            max={EXPLORE_BUDGET_MAX}
            step={1}
            value={maxMinutes}
            onChange={handleSliderChange}
            onPointerUp={handleSliderRelease}
            onKeyUp={handleSliderRelease}
            aria-label="Walking time budget in minutes"
            aria-valuemin={EXPLORE_BUDGET_MIN}
            aria-valuemax={EXPLORE_BUDGET_MAX}
            aria-valuenow={maxMinutes}
          />
          <div className="explore-slider-ticks" aria-hidden="true">
            {SLIDER_TICKS.map(t => (
              <span key={t} className="explore-slider-tick">{t}</span>
            ))}
          </div>
          <p className="explore-budget-summary">{budgetSummary}</p>
        </div>

        <button
          type="button"
          className="explore-submit-btn"
          onClick={onSubmit}
          disabled={loading || (origin?.kind === "current" && !origin?.lat)}
        >
          <WPIcon name="stride" size={16} />
          {loading ? "Plotting your range…" : "Survey the surroundings"}
        </button>
      </div>

      {chipsToShow.length > 0 && (
        <div className="explore-section">
          <div className="explore-section-label">
            <WPIcon name="chicago-mark" size={12} />
            <span>Within reach</span>
          </div>
          <div className="explore-chip-rail">
            {chipsToShow.map(name => (
              <button
                key={name}
                type="button"
                className="explore-chip"
                onClick={() => onChipClick?.(name)}
                title={`Walk to ${name}`}
              >
                {name}
                <span className="explore-chip-arrow" aria-hidden="true">→</span>
              </button>
            ))}
          </div>
          <p className="explore-chip-help">
            Tap a name to plot a walk there.
          </p>
        </div>
      )}
    </div>
  );
}
