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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMMUNITY_AREA_NAMES } from "../lib/communityAreas.js";
import { EXPLORE_BUDGET_MIN, EXPLORE_BUDGET_MAX } from "../lib/explorePrefs.js";
import { WPIcon } from "../wayfarer/walkpath-icons.jsx";
import { AddressAutocomplete } from "./AddressAutocomplete.jsx";

// Local filter over the 77 community-area names. We deliberately keep this
// constrained to the 77 — the Explorer routes through `lookup_centroid`
// server-side, which only accepts names from this list. The full address
// autocomplete (used in App.jsx route stops) goes through the API endpoint.
function filterCommunityAreas(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) {
    // Empty query falls back to the alphabetical head — gives the user
    // something to scroll through when they first focus the input.
    return COMMUNITY_AREA_NAMES.slice(0, 8).map(name => ({
      label: name,
      source: "community_area",
    }));
  }
  const matches = [];
  for (const name of COMMUNITY_AREA_NAMES) {
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) {
      matches.push({ name, prefix: true });
    } else if (lower.includes(q)) {
      matches.push({ name, prefix: false });
    }
    if (matches.length >= 32) break;
  }
  // Prefix matches outrank substring matches; preserve alphabetical inside
  // each bucket so the dropdown order matches user expectation.
  matches.sort((a, b) => {
    if (a.prefix !== b.prefix) return a.prefix ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return matches.slice(0, 8).map(m => ({ label: m.name, source: "community_area" }));
}

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
  // Keyboard arrow taps fire keyup on every press, including ones that
  // didn't actually change the value (Tab cycles, focus changes, modifier
  // keys). Track whether the slider's value has changed since the last
  // commit so we only fetch when there's something new to ask about.
  const sliderDirtyRef = useRef(false);

  function handleOriginKindChange(kind) {
    if (kind === "current") {
      // Retain the prior community-area pick in memory so a geolocation
      // denial can restore it as the fallback. Persistence still nulls this
      // (see sanitize() in explorePrefs.js) — preservation is session-only.
      onOriginChange({ kind: "current", communityArea: origin?.communityArea || null });
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

  // The combobox is permissive on text — the user can type any string — but
  // only commit to a real origin change when they pick a known area (the
  // backend's `lookup_centroid` only accepts the 77 names). The displayed
  // value is therefore a local `areaQuery` state, not the parent's
  // `origin.communityArea`: free-typed substrings show in the input as the
  // user types and only "win" the origin when a suggestion is selected.
  const [areaQuery, setAreaQuery] = useState(origin?.communityArea || "");
  // Re-sync from the parent when origin changes from outside (e.g. the user
  // toggled to "My location" and back, or the persisted origin loaded after
  // mount). Only sync when the source-of-truth name actually changes —
  // mid-type keystrokes are protected because they don't touch the parent.
  useEffect(() => {
    if (origin?.kind === "community_area" && origin.communityArea) {
      setAreaQuery(origin.communityArea);
    }
  }, [origin?.kind, origin?.communityArea]);

  const handleAreaSelect = useCallback((suggestion) => {
    if (!suggestion?.label) return;
    setAreaQuery(suggestion.label);
    onOriginChange({ kind: "community_area", communityArea: suggestion.label });
  }, [onOriginChange]);

  const fetchAreaSuggestions = useCallback(async (q) => filterCommunityAreas(q), []);

  function handleSliderChange(e) {
    const next = Math.round(Number(e.target.value));
    if (Number.isFinite(next)) {
      sliderDirtyRef.current = true;
      onMaxMinutesChange(next);
    }
  }

  function handleSliderRelease() {
    if (!sliderDirtyRef.current) return;
    sliderDirtyRef.current = false;
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
            <AddressAutocomplete
              value={areaQuery}
              onChange={setAreaQuery}
              onSelect={handleAreaSelect}
              getSuggestions={fetchAreaSuggestions}
              placeholder="Search community area"
              ariaLabel="Community area"
              className="explore-area-autocomplete"
            />
          </div>
        )}
      </div>

      <div className="explore-section">
        <div className="explore-section-label">
          <WPIcon name="hourglass" size={12} />
          <span>How long can you walk?</span>
          <span
            className="explore-section-tooltip"
            title="Survey time assumes a steady 3 mph pace."
            aria-label="Survey time assumes a steady 3 mph pace"
            tabIndex={0}
          >
            ⓘ
          </span>
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
          disabled={loading || locating || (origin?.kind === "current" && !origin?.lat)}
        >
          <WPIcon name="stride" size={16} />
          {locating
            ? "Reading the compass…"
            : loading
              ? "Plotting your range…"
              : "Survey the surroundings"}
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
