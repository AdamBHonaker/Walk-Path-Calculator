import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { WFSheet } from "../wayfarer/primitives.jsx";
import { saveSheetSnap } from "../lib/sheetSnap.js";
import { useMediaQuery } from "../lib/useMediaQuery.js";

// Three snap points: peek (form is visible without dismissing the map),
// half (route hero + first results visible above the polyline), full (the
// directions ledger gets the full sheet to scroll inside).
const DEFAULT_SNAP_POINTS = ["140px", "50dvh", "88dvh"];

// Landscape phones (e.g. 667×375) are short enough that a 140 px peek eats
// 37 % of the viewport and an 88dvh full snap swallows the map. Retune to
// a handle-only peek, a half that preserves the map's upper third, and a
// full that takes the whole screen.
const LANDSCAPE_SNAP_POINTS = ["48px", "60dvh", "100dvh"];
const LANDSCAPE_PHONE_QUERY = "(orientation: landscape) and (max-height: 480px)";

// Wait this long after the last user-initiated snap change before persisting.
// Long enough to coalesce a "drag through 1 to 2" sequence into one write,
// short enough that a quick close + reload still captures the user's intent.
const SNAP_PERSIST_DELAY_MS = 500;

// Map-first mobile composition root. The map fills the viewport; a floating
// masthead overlays the top edge; everything else (form, results, directions)
// lives inside a draggable WFSheet anchored to the bottom.
//
// Props:
//   masthead         — the compact Masthead JSX, rendered as a floating header
//   map              — the MapView JSX, rendered full-bleed underneath
//   snap             — controlled snap index (0|1|2)
//   defaultSnap      — uncontrolled initial snap
//   onSnapChange     — fires when the sheet settles at a new snap index
//   onObscuredChange — fires with the px the sheet currently obscures, so
//                      a parent can compute MapView's `mapPadding.bottom`
//   snapPoints       — override the three default snap heights
export function MobileLayout({
  masthead,
  map,
  snap,
  defaultSnap = 0,
  onSnapChange,
  onObscuredChange,
  snapPoints,
  children,
}) {
  const isLandscapePhone = useMediaQuery(LANDSCAPE_PHONE_QUERY);
  // Stable identity across renders so WFSheet's snapPx useMemo can stay
  // cached when neither input changed.
  const resolvedSnapPoints = useMemo(
    () => snapPoints ?? (isLandscapePhone ? LANDSCAPE_SNAP_POINTS : DEFAULT_SNAP_POINTS),
    [snapPoints, isLandscapePhone],
  );
  const isControlled = snap !== undefined;
  const [internalSnap, setInternalSnap] = useState(defaultSnap);
  const currentSnap = isControlled ? snap : internalSnap;

  // WFSheet only fires onSnapChange from drag releases (not from prop
  // changes), so any value reaching this handler is user-initiated and
  // worth persisting. Debounce so a quick peek→half→full motion writes
  // once instead of three times.
  const persistTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(persistTimerRef.current), []);

  const handleSnapChange = useCallback((idx) => {
    if (!isControlled) setInternalSnap(idx);
    onSnapChange?.(idx);
    clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(
      () => saveSheetSnap(idx),
      SNAP_PERSIST_DELAY_MS,
    );
  }, [isControlled, onSnapChange]);

  return (
    <div className="mobile-shell">
      <div className="mobile-shell-map">
        {map}
      </div>
      {masthead && (
        <div className="mobile-shell-header">
          {masthead}
        </div>
      )}
      <WFSheet
        snap={currentSnap}
        onSnapChange={handleSnapChange}
        snapPoints={resolvedSnapPoints}
        obscuredAreaCallback={onObscuredChange}
      >
        {children}
      </WFSheet>
    </div>
  );
}
