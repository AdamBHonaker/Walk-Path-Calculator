import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import {
  renderWalkRoute,
  clearLayers,
  buildTurnsGeoJson,
  lockMapGestures,
  unlockMapGestures,
  haversineMeters,
  toGeo,
  MAP_STYLE_URL,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
} from "./mapHelpers.js";

// Draw-in pacing: ~4 Chicago long blocks per second (long block ≈ 0.125 mi),
// i.e. 0.5 mi/sec. Bounded so tiny/huge routes still feel reasonable.
const ANIM_BLOCKS_PER_SEC   = 4;
const ANIM_MILES_PER_BLOCK  = 0.125;
const ANIM_MIN_DURATION_MS  = 600;
const ANIM_MAX_DURATION_MS  = 8000;

function animDurationMs(miles) {
  const m = Number(miles);
  if (!Number.isFinite(m) || m <= 0) return ANIM_MIN_DURATION_MS;
  const secs = m / (ANIM_BLOCKS_PER_SEC * ANIM_MILES_PER_BLOCK);
  return Math.max(ANIM_MIN_DURATION_MS, Math.min(ANIM_MAX_DURATION_MS, secs * 1000));
}

export default function MapView({
  result          = null,
  turnCoords      = null,
  activeTurnIndex = null,
  pickMode        = null,
  onPickPoint     = null,
  resolveLabel    = null,
  style           = MAP_STYLE_URL,
  center          = DEFAULT_MAP_CENTER,
  zoom            = DEFAULT_MAP_ZOOM,
}) {
  const containerRef   = useRef(null);
  const mapRef         = useRef(null);
  const layerIds       = useRef([]);
  const sourceIds      = useRef([]);
  const rafRef         = useRef(null);
  const turnCoordsRef  = useRef(turnCoords);
  const previewMarkerRef = useRef(null);
  const previewReqRef    = useRef(0);
  const [unlocked, setUnlocked]     = useState(false);
  const [styleError, setStyleError] = useState(false);
  const [previewPick, setPreviewPick] = useState(null); // {lat, lon, label, resolving}

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
          e?.error?.message?.toLowerCase()?.includes("style");
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
      renderWalkRoute(map, result, turnCoords, activeTurnIndex, layerIds.current, sourceIds.current);

      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
      if (reducedMotion) return;

      // Draw-in animation: progressively grow the source LineString from the
      // origin toward the destination. We precompute cumulative segment
      // distances, then each frame setData with a prefix of the path plus an
      // interpolated point at the current target distance.
      const fullPath = result.path; // array of [lat, lon]
      if (!fullPath || fullPath.length < 2) return;

      const cumDist = [0];
      for (let i = 1; i < fullPath.length; i++) {
        cumDist.push(cumDist[i - 1] + haversineMeters(fullPath[i - 1], fullPath[i]));
      }
      const totalDist = cumDist[cumDist.length - 1];
      if (!(totalDist > 0)) return;

      const src = map.getSource("walk-path");
      if (!src?.setData) return;

      // Pre-convert path to [lon, lat] form once so per-frame work is bounded
      // to a slice + the interpolated tip — no per-point allocation per frame.
      const geoFullPath = fullPath.map(toGeo);

      const setProgress = (p) => {
        const target = p * totalDist;
        // Find segment containing target distance
        let i = 1;
        while (i < cumDist.length && cumDist[i] < target) i++;
        const coords = geoFullPath.slice(0, i);
        if (i < fullPath.length) {
          const segLen = cumDist[i] - cumDist[i - 1];
          const t = segLen > 0 ? (target - cumDist[i - 1]) / segLen : 0;
          const a = fullPath[i - 1];
          const b = fullPath[i];
          const lat = a[0] + t * (b[0] - a[0]);
          const lon = a[1] + t * (b[1] - a[1]);
          coords.push([lon, lat]);
        }
        if (coords.length < 2) coords.push(coords[0]);
        try {
          src.setData({
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords },
          });
        } catch { /* source removed */ }
      };
      setProgress(0);

      const durationMs = animDurationMs(result.total_miles);
      const startTime = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - startTime) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        setProgress(eased);
        if (t >= 1) {
          // Restore the full path as the final source data
          try {
            src.setData({
              type: "Feature",
              geometry: { type: "LineString", coordinates: geoFullPath },
            });
          } catch { /* source removed */ }
          rafRef.current = null;
          return;
        }
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

  // Pick-on-map: unlock gestures while picking so the user can pan/zoom to
  // their target, drop a preview pin on click, and only commit after Confirm.
  // Clicking again while a preview is active moves the pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!pickMode) {
      previewMarkerRef.current?.remove();
      previewMarkerRef.current = null;
      previewReqRef.current++;
      setPreviewPick(null);
      if (!unlocked) lockMapGestures(map);
      return;
    }

    unlockMapGestures(map);

    function handleClick(e) {
      const { lng, lat } = e.lngLat;
      previewMarkerRef.current?.remove();
      previewMarkerRef.current = new maplibregl.Marker({ color: "#e53935" })
        .setLngLat([lng, lat])
        .addTo(map);

      const reqId = ++previewReqRef.current;
      setPreviewPick({ lat, lon: lng, label: null, resolving: true });

      if (resolveLabel) {
        Promise.resolve(resolveLabel(lat, lng))
          .then(label => {
            if (previewReqRef.current !== reqId) return;
            setPreviewPick(prev => prev ? { ...prev, label: label || null, resolving: false } : prev);
          })
          .catch(() => {
            if (previewReqRef.current !== reqId) return;
            setPreviewPick(prev => prev ? { ...prev, label: null, resolving: false } : prev);
          });
      } else {
        setPreviewPick(prev => prev ? { ...prev, resolving: false } : prev);
      }
    }

    map.on("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [pickMode, resolveLabel, unlocked]);

  // Crosshair cursor while pick mode is active
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const canvas = map.getCanvas();
    if (canvas) canvas.style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode]);

  function handleConfirmPick() {
    if (!previewPick || !onPickPoint) return;
    const { lat, lon, label } = previewPick;
    previewMarkerRef.current?.remove();
    previewMarkerRef.current = null;
    previewReqRef.current++;
    setPreviewPick(null);
    onPickPoint(lat, lon, label);
  }

  function handleCancelPick() {
    previewMarkerRef.current?.remove();
    previewMarkerRef.current = null;
    previewReqRef.current++;
    setPreviewPick(null);
  }

  function handleUnlock() {
    const map = mapRef.current;
    if (!map) return;
    unlockMapGestures(map);
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
      {pickMode && !previewPick && (
        <div className="map-pick-hint">
          Pan/zoom and click the map to drop a pin
        </div>
      )}
      {previewPick && (
        <div className="map-pick-confirm" role="dialog" aria-label="Confirm location">
          <div className="map-pick-confirm-label">
            {previewPick.resolving
              ? "Resolving address…"
              : (previewPick.label
                  || `${previewPick.lat.toFixed(5)}, ${previewPick.lon.toFixed(5)}`)}
          </div>
          <div className="map-pick-confirm-sub">
            Click elsewhere to move the pin, or confirm this location.
          </div>
          <div className="map-pick-confirm-actions">
            <button
              type="button"
              className="map-pick-confirm-btn map-pick-confirm-btn--cancel"
              onClick={handleCancelPick}
            >
              Cancel
            </button>
            <button
              type="button"
              className="map-pick-confirm-btn map-pick-confirm-btn--ok"
              onClick={handleConfirmPick}
              disabled={previewPick.resolving}
            >
              Confirm
            </button>
          </div>
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
