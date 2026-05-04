import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import {
  renderWalkRoute,
  clearLayers,
  buildTurnsGeoJson,
  lockMapGestures,
} from "./mapHelpers.js";

const DEFAULT_STYLE  = import.meta.env.VITE_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";
const DEFAULT_CENTER = [-87.654, 41.966]; // Uptown, Chicago
const DEFAULT_ZOOM   = 13;

const ANIM_DURATION_MS = 1500;

export default function MapView({
  result          = null,
  turnCoords      = null,
  activeTurnIndex = null,
  pickMode        = null,
  onPickPoint     = null,
  style           = DEFAULT_STYLE,
  center          = DEFAULT_CENTER,
  zoom            = DEFAULT_ZOOM,
}) {
  const containerRef   = useRef(null);
  const mapRef         = useRef(null);
  const layerIds       = useRef([]);
  const sourceIds      = useRef([]);
  const rafRef         = useRef(null);
  const turnCoordsRef  = useRef(turnCoords);
  const [unlocked, setUnlocked]     = useState(false);
  const [styleError, setStyleError] = useState(false);

  // Keep ref in sync so the activeTurnIndex effect can read latest coords
  useEffect(() => { turnCoordsRef.current = turnCoords; }, [turnCoords]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const stopAnim = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const render = () => {
      stopAnim();
      clearLayers(map, layerIds.current, sourceIds.current);
      if (!result) return;

      // Markers render synchronously here — animation below never gates them
      renderWalkRoute(map, result, turnCoords, activeTurnIndex, layerIds.current, sourceIds.current);

      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
      if (reducedMotion) return;

      const startTime = performance.now();
      let dashStep = 0;

      const frame = (now) => {
        if (now - startTime >= ANIM_DURATION_MS) {
          try { map.setPaintProperty("walk-path-line", "line-dasharray", [1, 0]); } catch { /* layer removed */ }
          rafRef.current = null;
          return;
        }
        dashStep = (dashStep + 1) % 200;
        try { map.setPaintProperty("walk-path-line", "line-dasharray", [0, 4, dashStep / 50, 4]); } catch { /* layer removed */ }
        rafRef.current = requestAnimationFrame(frame);
      };
      rafRef.current = requestAnimationFrame(frame);
    };

    if (map.isStyleLoaded()) {
      render();
    } else {
      map.once("load", render);
    }

    return () => {
      stopAnim();
      map.off("load", render);
    };
  // intentional: only re-render route when result/turnCoords change; mapRef is a stable ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, turnCoords]);

  // Update turn marker highlight and fly to the active turn without re-rendering everything
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const src = map.getSource("walk-turns");
    if (!src) return;

    const coords = turnCoordsRef.current;
    src.setData(buildTurnsGeoJson(coords ?? [], activeTurnIndex));

    if (activeTurnIndex != null && coords?.[activeTurnIndex]) {
      const [lat, lon] = coords[activeTurnIndex];
      map.flyTo({ center: [lon, lat], zoom: 16, duration: 600 });
    }
  }, [activeTurnIndex]);

  // Pick-on-map: one-shot click handler, fires regardless of gesture lock
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pickMode || !onPickPoint) return;

    function handleClick(e) {
      const { lng, lat } = e.lngLat;
      onPickPoint(lat, lng);
    }

    map.once("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [pickMode, onPickPoint]);

  // Crosshair cursor while pick mode is active
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const canvas = map.getCanvas();
    if (canvas) canvas.style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode]);

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
      {pickMode && (
        <div className="map-pick-hint">
          Click the map to set this stop
        </div>
      )}
      {result && !unlocked && !styleError && !pickMode && (
        <button className="map-unlock-btn" onClick={handleUnlock}>
          🔓 Unlock map
        </button>
      )}
    </div>
  );
}
