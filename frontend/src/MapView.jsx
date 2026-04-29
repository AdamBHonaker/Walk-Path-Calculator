import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

const DEFAULT_STYLE  = import.meta.env.VITE_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";
const DEFAULT_CENTER = [-87.654, 41.966]; // Uptown, Chicago
const DEFAULT_ZOOM   = 13;
const WALK_PATH_COLOR = "#2d7a3e";

// Backend returns [lat, lon]; GeoJSON / MapLibre expects [lon, lat].
const toGeo = ([lat, lon]) => [lon, lat];

function clearLayers(map, layerIds, sourceIds) {
  for (const id of layerIds.splice(0)) {
    try { map.removeLayer(id); } catch { /* already gone */ }
  }
  for (const id of sourceIds.splice(0)) {
    try { map.removeSource(id); } catch { /* already gone */ }
  }
}

function _trackSource(map, id, data, sourceIds) {
  map.addSource(id, data);
  sourceIds.push(id);
}

function _trackLayer(map, cfg, layerIds) {
  map.addLayer(cfg);
  layerIds.push(cfg.id);
}

function renderWalkRoute(map, result, layerIds, sourceIds) {
  if (!result?.path?.length) return;

  const { path, origin_coords, dest_coords } = result;

  // Convert coords and compute bounding box in a single pass
  const { geoPath, bounds } = path.reduce(
    ({ geoPath, bounds }, pt) => {
      const [lon, lat] = toGeo(pt);
      geoPath.push([lon, lat]);
      return {
        geoPath,
        bounds: [
          [Math.min(bounds[0][0], lon), Math.min(bounds[0][1], lat)],
          [Math.max(bounds[1][0], lon), Math.max(bounds[1][1], lat)],
        ],
      };
    },
    { geoPath: [], bounds: [[Infinity, Infinity], [-Infinity, -Infinity]] },
  );

  // Walk path — solid green line
  _trackSource(map, "walk-path", {
    type: "geojson",
    data: { type: "Feature", geometry: { type: "LineString", coordinates: geoPath } },
  }, sourceIds);
  _trackLayer(map, {
    id:     "walk-path-line",
    type:   "line",
    source: "walk-path",
    layout: { "line-cap": "round", "line-join": "round" },
    paint:  { "line-color": WALK_PATH_COLOR, "line-width": 4 },
  }, layerIds);

  // Origin marker — green dot
  if (origin_coords) {
    const pt = [origin_coords[1], origin_coords[0]];
    _trackSource(map, "walk-origin", {
      type: "geojson",
      data: { type: "Feature", geometry: { type: "Point", coordinates: pt } },
    }, sourceIds);
    _trackLayer(map, {
      id: "walk-origin-circle", type: "circle", source: "walk-origin",
      paint: {
        "circle-radius": 9, "circle-color": WALK_PATH_COLOR,
        "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
      },
    }, layerIds);
  }

  // Destination marker — dark dot
  if (dest_coords) {
    const pt = [dest_coords[1], dest_coords[0]];
    _trackSource(map, "walk-dest", {
      type: "geojson",
      data: { type: "Feature", geometry: { type: "Point", coordinates: pt } },
    }, sourceIds);
    _trackLayer(map, {
      id: "walk-dest-circle", type: "circle", source: "walk-dest",
      paint: {
        "circle-radius": 9, "circle-color": "#1a1a1a",
        "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
      },
    }, layerIds);
  }

  // Auto-fit to route
  if (geoPath.length > 0) {
    map.fitBounds(bounds, { padding: 60, animate: false });
  }
}

export default function MapView({
  result      = null,
  style       = DEFAULT_STYLE,
  center      = DEFAULT_CENTER,
  zoom        = DEFAULT_ZOOM,
}) {
  const containerRef  = useRef(null);
  const mapRef        = useRef(null);
  const layerIds      = useRef([]);
  const sourceIds     = useRef([]);
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

      map.scrollZoom.disable();
      map.dragPan.disable();
      map.dragRotate.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
      map.keyboard.disable();

      map.once("load", () => {
        map.resize();
        map.triggerRepaint();
      });

      map.on("error", (e) => {
        console.error("[MapView] map error:", e?.error ?? e);
        const status = e?.error?.status;
        const isStyleSource =
          e?.sourceId === "openmaptiles" ||
          e?.error?.message?.toLowerCase().includes("style");
        if (isStyleSource && (status === 0 || (status >= 400 && status < 600))) {
          setStyleError(true);
          map.once("styledata", () => setStyleError(false));
        }
      });

      mapRef.current = map;
    }, 0);

    return () => {
      clearTimeout(timerId);
      map?.remove();
      mapRef.current = null;
    };
  // intentional: map init runs once; style/center/zoom are treated as stable init props
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const render = () => {
      clearLayers(map, layerIds.current, sourceIds.current);
      if (result) renderWalkRoute(map, result, layerIds.current, sourceIds.current);
    };

    if (map.isStyleLoaded()) {
      render();
    } else {
      map.once("load", render);
      return () => map.off("load", render);
    }
  // intentional: only re-render route when result changes; mapRef is a stable ref
  }, [result]);

  function handleUnlock() {
    const map = mapRef.current;
    if (!map) return;
    map.scrollZoom.enable();
    map.dragPan.enable();
    map.dragRotate.enable();
    map.doubleClickZoom.enable();
    map.touchZoomRotate.enable();
    map.keyboard.enable();
    setUnlocked(true);
  }

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-container" />
      {styleError && (
        <div className="map-error">
          Map tiles unavailable — check your connection or try again later.
        </div>
      )}
      {result && !unlocked && !styleError && (
        <button className="map-unlock-btn" onClick={handleUnlock}>
          🔓 Unlock map
        </button>
      )}
    </div>
  );
}
