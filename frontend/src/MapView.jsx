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
  // ── Follow my location ───────────────────────────────────────────────
  // `userPosition` is { lat, lon, accuracy } | null. When set, a pin is
  // rendered. When `following` is also true, the map re-centers on every
  // position update (zoom is preserved). Manual gestures (drag/zoom/rotate/
  // pitch) disengage follow via `onToggleFollow`.
  userPosition    = null,
  following       = false,
  onToggleFollow  = null,
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
  showParks       = false,
  showTreeCanopy  = false,
  showGreenSpace  = false,
  onPlaceGoHere = null,
  // Fires the moment a pin is clicked, before the popup is anchored.
  // The mobile parent uses this to drop the bottom sheet to peek so the
  // popover is fully visible against the map.
  onPlaceTap      = null,
}) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  // Init effect calls lockMapGestures first, so the gesture state is locked
  // by the time the gesture-sync effect below runs.
  const gestureLockedRef = useRef(true);
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
    let targetLocked;
    if (mode === "explore") {
      targetLocked = false;
    } else if (!unlocked && !pickMode) {
      targetLocked = true;
    } else {
      return;
    }
    if (gestureLockedRef.current === targetLocked) return;
    gestureLockedRef.current = targetLocked;
    if (targetLocked) lockMapGestures(map);
    else unlockMapGestures(map);
  }, [mode, unlocked, pickMode, mapReady]);

  // ── User-location pin (live fix) ──────────────────────────────────────
  // Adds an empty GeoJSON source + halo/dot layers once on map load. Later
  // effects mutate the source data when `userPosition` changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const SRC = "walk-path-user-loc";
    function install() {
      if (map.getSource(SRC)) return;
      map.addSource(SRC, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: `${SRC}-halo`,
        type: "circle",
        source: SRC,
        paint: {
          "circle-radius": [
            "interpolate", ["exponential", 2], ["zoom"],
            10, ["max", 4, ["/", ["coalesce", ["get", "accuracy"], 0], 12]],
            18, ["max", 12, ["/", ["coalesce", ["get", "accuracy"], 0], 0.6]],
          ],
          "circle-color": "#2f6fed",
          "circle-opacity": 0.18,
          "circle-stroke-color": "#2f6fed",
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.35,
        },
      });
      map.addLayer({
        id: `${SRC}-dot`,
        type: "circle",
        source: SRC,
        paint: {
          "circle-radius": 6,
          "circle-color": "#2f6fed",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
    }
    if (map.isStyleLoaded()) install();
    else map.once("load", install);
  }, [mapReady]);

  // Sync the user-loc source with the latest fix.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const SRC = "walk-path-user-loc";
    function apply() {
      const src = map.getSource(SRC);
      if (!src) return;
      const features = userPosition
        ? [{
            type: "Feature",
            geometry: { type: "Point", coordinates: [userPosition.lon, userPosition.lat] },
            properties: { accuracy: userPosition.accuracy ?? 0 },
          }]
        : [];
      src.setData({ type: "FeatureCollection", features });
    }
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [userPosition, mapReady]);

  // Auto-recenter when following. Zoom is preserved. We bump the zoom up to a
  // useful walking level only on the first fix of a follow session — otherwise
  // a route's zoomed-out fit would leave the pin too small to read.
  const lastFollowFixRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !following || !userPosition) {
      if (!following) lastFollowFixRef.current = null;
      return;
    }
    const isFirst = lastFollowFixRef.current === null;
    lastFollowFixRef.current = userPosition;
    map.easeTo({
      center: [userPosition.lon, userPosition.lat],
      zoom: isFirst ? Math.max(map.getZoom(), 15) : map.getZoom(),
      duration: 600,
    });
  }, [following, userPosition, mapReady]);

  // Manual gesture → disengage follow. We only react to user-originated events:
  // programmatic `easeTo` does not set `originalEvent` on the camera events.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !following || !onToggleFollow) return;
    function onUserMove(e) {
      if (e?.originalEvent != null) onToggleFollow();
    }
    map.on("dragstart",   onUserMove);
    map.on("zoomstart",   onUserMove);
    map.on("rotatestart", onUserMove);
    map.on("pitchstart",  onUserMove);
    return () => {
      map.off("dragstart",   onUserMove);
      map.off("zoomstart",   onUserMove);
      map.off("rotatestart", onUserMove);
      map.off("pitchstart",  onUserMove);
    };
  }, [following, onToggleFollow, mapReady]);

  function handleUnlock() {
    const map = mapRef.current;
    if (!map) return;
    if (gestureLockedRef.current) {
      gestureLockedRef.current = false;
      unlockMapGestures(map);
    }
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
            showParks={showParks}
            showTreeCanopy={showTreeCanopy}
            showGreenSpace={showGreenSpace}
            activeSubs={activeSubs}
            categoryStyles={categoryStyles}
            mapPadding={mapPadding}
            pickMode={pickMode}
            onPlaceTap={onPlaceTap}
            onPlaceGoHere={onPlaceGoHere}
          />
          <MapPickLayer
            mapRef={mapRef}
            pickMode={pickMode}
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
      {onToggleFollow && !pickMode && !styleError && (
        <button
          type="button"
          className={`map-follow-btn${following ? " map-follow-btn--active" : ""}`}
          onClick={onToggleFollow}
          aria-pressed={following}
          aria-label={following ? "Stop following my location" : "Follow my location"}
          title={following ? "Stop following" : "Follow my location"}
        >
          <WPIcon name="navigation" size={14} />
          <span className="map-follow-btn__label">
            {following ? "Following" : "Follow"}
          </span>
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
