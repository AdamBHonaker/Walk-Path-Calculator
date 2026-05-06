import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { WPIcon } from "./wayfarer/walkpath-icons.jsx";
import {
  lockMapGestures,
  unlockMapGestures,
  MAP_STYLE_URL,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
} from "./mapHelpers.js";
import { MapRouteLayer } from "./map/MapRouteLayer.jsx";
import { MapExploreLayer } from "./map/MapExploreLayer.jsx";
import { MapPickLayer } from "./map/MapPickLayer.jsx";

// Owns the maplibregl.Map instance and the surfacing chrome (style-error
// banner, unlock button, locate button). The three sibling layer components
// subscribe to the map via the shared `mapRef` and each owns its own
// rendering lifecycle. See [TD-010] in archive/RESOLVED_HISTORY.md.
export default function MapView({
  result          = null,
  turnCoords      = null,
  activeTurnIndex = null,
  pickMode        = null,
  onPickPoint     = null,
  resolveLabel    = null,
  onLocateMe      = null,
  locating        = false,
  style           = MAP_STYLE_URL,
  center          = DEFAULT_MAP_CENTER,
  zoom            = DEFAULT_MAP_ZOOM,
  // Per-edge pixels to keep clear when fitting the route. Accepts a number
  // (uniform) or { top, bottom, left, right }. Used by the mobile layout to
  // pad against the bottom sheet so the route polyline isn't hidden under it.
  mapPadding      = null,
  // ── Neighborhood Explorer integration ─────────────────────────────────
  // When `mode === "explore"`, the route polyline is hidden and the
  // explorer's polygon + place pins + residential heatmap are drawn instead.
  // `exploreResult` is the backend /explore response; `categoryStyles` /
  // `activeSubs` / `showResidential` mirror the user's selection panel.
  mode            = "route",
  exploreResult   = null,
  categoryStyles  = null,
  activeSubs      = null,
  showResidential = true,
  onPlaceWalkHere = null,
  // Fires the moment a pin is clicked, before the popup is anchored.
  // The mobile parent uses this to drop the bottom sheet to peek so the
  // popover is fully visible against the map.
  onPlaceTap      = null,
}) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const [mapReady, setMapReady]     = useState(false);
  const [unlocked, setUnlocked]     = useState(false);
  const [styleError, setStyleError] = useState(false);

  useEffect(() => {
    let map = null;

    const timerId = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;

      map = new maplibregl.Map({
        container,
        style,
        center,
        zoom,
        failIfMajorPerformanceCaveat: false,
      });

      lockMapGestures(map);

      map.once("load", () => {
        map.resize();
        map.triggerRepaint();
      });

      map.on("error", (e) => {
        console.error("[MapView] map error:", e?.error ?? e);
        const status = e?.error?.status;
        const isStyleSource =
          e?.sourceId === "openmaptiles" ||
          e?.error?.message?.toLowerCase()?.includes("style");
        if (isStyleSource && (status === 0 || (status >= 400 && status < 600))) {
          setStyleError(true);
          map.once("styledata", () => setStyleError(false));
        }
      });

      mapRef.current = map;
      setMapReady(true);
    }, 0);

    return () => {
      clearTimeout(timerId);
      map?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  // intentional: map init runs once; style/center/zoom are treated as stable init props
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Explore mode unlocks pan/zoom: panning the polygon to look around is
  // the whole point, so we shouldn't require the user to hit "Unlock" first.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mode === "explore") {
      unlockMapGestures(map);
    } else if (!unlocked && !pickMode) {
      lockMapGestures(map);
    }
  }, [mode, unlocked, pickMode, mapReady]);

  function handleUnlock() {
    const map = mapRef.current;
    if (!map) return;
    unlockMapGestures(map);
    setUnlocked(true);
  }

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-container" />
      {mapReady && (
        <>
          <MapRouteLayer
            mapRef={mapRef}
            result={result}
            turnCoords={turnCoords}
            activeTurnIndex={activeTurnIndex}
            mode={mode}
            mapPadding={mapPadding}
          />
          <MapExploreLayer
            mapRef={mapRef}
            mode={mode}
            exploreResult={exploreResult}
            showResidential={showResidential}
            activeSubs={activeSubs}
            categoryStyles={categoryStyles}
            mapPadding={mapPadding}
            pickMode={pickMode}
            onPlaceTap={onPlaceTap}
            onPlaceWalkHere={onPlaceWalkHere}
          />
          <MapPickLayer
            mapRef={mapRef}
            pickMode={pickMode}
            unlocked={unlocked}
            resolveLabel={resolveLabel}
            onPickPoint={onPickPoint}
          />
        </>
      )}
      {styleError && (
        <div className="map-error">
          Tiles unavailable. Try again in a moment.
        </div>
      )}
      {result && !unlocked && !styleError && !pickMode && mode !== "explore" && (
        <button className="map-unlock-btn" onClick={handleUnlock} aria-label="Unlock map gestures">
          <WPIcon name="unlock" size={14} />
          <span className="map-unlock-btn__label">Unlock map</span>
        </button>
      )}
      {onLocateMe && !pickMode && !styleError && mode !== "explore" && (
        <button
          type="button"
          className={`map-locate-btn${locating ? " map-locate-btn--locating wf-anim-radar" : ""}`}
          onClick={onLocateMe}
          disabled={locating}
          aria-label={locating ? "Finding your location" : "Use my current location"}
          title="Use my current location"
        >
          <WPIcon name="crosshair" size={14} />
          <span className="map-locate-btn__label">My location</span>
        </button>
      )}
    </div>
  );
}
