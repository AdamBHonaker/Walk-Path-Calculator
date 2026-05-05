import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import { WPIcon } from "./wayfarer/walkpath-icons.jsx";
import { WFFromMark, WFToMark } from "./wayfarer/primitives.jsx";
import {
  renderWalkRoute,
  buildTurnsGeoJson,
  lockMapGestures,
  unlockMapGestures,
  MAP_STYLE_URL,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
} from "./mapHelpers.js";

// Draw-in pacing: ~2 Chicago long blocks per second (long block ≈ 0.125 mi),
// i.e. 0.25 mi/sec. Bounded so tiny/huge routes still feel reasonable.
//
// History: shipped at 4 blocks/sec when the animation grew source LineString
// data each frame. After switching to `line-trim-offset` (GPU-side reveal,
// see MapView.render() below) the same numeric duration FELT faster —
// drawing-on-paper vs. wiping-fog-off-glass. Halved the blocks-per-second
// rate, doubled the floor, and raised the ceiling so long multi-stop tours
// (a 30-mi walk through 5 neighborhoods) get visual time proportional to
// the distance instead of snapping in 8 seconds flat.
const ANIM_BLOCKS_PER_SEC   = 2;
const ANIM_MILES_PER_BLOCK  = 0.125;
const ANIM_MIN_DURATION_MS  = 1200;
const ANIM_MAX_DURATION_MS  = 15000;

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
  // Endpoint markers persist across renders and are repositioned in place
  // (rather than torn down + re-mounted) when the route changes.
  const endpointMarkersRef = useRef({ from: null, to: null });
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

    const clearEndpointMarkers = () => {
      const markers = endpointMarkersRef.current;
      for (const kind of ["from", "to"]) {
        const m = markers[kind];
        if (!m) continue;
        try { m.marker.remove(); } catch { /* already removed */ }
        const root = m.root;
        queueMicrotask(() => { try { root.unmount(); } catch { /* already gone */ } });
        markers[kind] = null;
      }
    };

    const upsertEndpointMark = ({ coords, kind, ariaLabel }) => {
      if (!coords) return;
      const [lat, lon] = coords;
      const existing = endpointMarkersRef.current[kind];
      if (existing) {
        existing.el.setAttribute("aria-label", ariaLabel);
        existing.marker.setLngLat([lon, lat]);
        return;
      }
      const el = document.createElement("div");
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", ariaLabel);
      // Inline so MapLibre's marker-anchor math sees the correct box.
      el.style.width = "36px";
      el.style.height = "36px";
      el.style.display = "block";
      el.style.pointerEvents = "none";
      const root = createRoot(el);
      root.render(kind === "from" ? <WFFromMark size={36} /> : <WFToMark size={36} />);
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([lon, lat])
        .addTo(map);
      endpointMarkersRef.current[kind] = { marker, root, el };
    };

    const render = () => {
      stopAnim();
      if (!result) {
        clearEndpointMarkers();
        return;
      }
      // renderWalkRoute upserts sources via setData when they already exist,
      // so back-to-back renders (route flavor swap) reuse GPU buffers instead
      // of tearing every source down and rebuilding it.
      renderWalkRoute(
        map, result, turnCoords, activeTurnIndex,
        layerIds.current, sourceIds.current,
        60, undefined, /* drawEndpointDots = */ false
      );

      const stops = Array.isArray(result.stops) ? result.stops : null;
      const originLabel = stops?.[0] ?? "origin";
      const destLabel   = stops?.[stops.length - 1] ?? "destination";
      upsertEndpointMark({
        coords: result.origin_coords,
        kind: "from",
        ariaLabel: `Origin: ${originLabel}`,
      });
      upsertEndpointMark({
        coords: result.dest_coords,
        kind: "to",
        ariaLabel: `Destination: ${destLabel}`,
      });

      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
      if (reducedMotion) return;

      // Draw-in animation via MapLibre's `line-trim-offset` paint property —
      // visually trims the line without touching its source data. Two big wins:
      //   1. Source data stays as the full path. If RAF is throttled, cancelled,
      //      or stubbed in tests, the line stays visible by default.
      //   2. The trim is set INSIDE the first RAF callback, not synchronously,
      //      so a non-firing RAF leaves the line at default (no trim) = visible.
      const fullPath = result.path; // array of [lat, lon]
      if (!fullPath || fullPath.length < 2) return;

      const setTrim = (p) => {
        // [trimStart=p, trimEnd=1]: visible region is [0..p], hidden is [p..1].
        // Animation runs p from 0 → 1, "drawing in" from origin to destination.
        // `triggerRepaint` forces MapLibre to render this paint change on the
        // current frame — without it, paint property updates can be batched
        // into the next internal render cycle, halving the perceived frame
        // rate of the draw-in.
        try {
          map.setPaintProperty("walk-path-line", "line-trim-offset", [p, 1]);
          map.triggerRepaint();
        } catch { /* layer removed */ }
      };
      const clearTrim = () => {
        try {
          map.setPaintProperty("walk-path-line", "line-trim-offset", null);
          map.triggerRepaint();
        } catch { /* layer removed */ }
      };

      const durationMs = animDurationMs(result.total_miles);
      let startTime = null;
      const frame = (now) => {
        if (startTime === null) {
          startTime = now;
          // First frame: collapse the line, then schedule the next frame to
          // start the actual progress animation. Doing this here (rather than
          // before `requestAnimationFrame`) means a non-firing RAF leaves the
          // line at default visibility.
          setTrim(0);
          rafRef.current = requestAnimationFrame(frame);
          return;
        }
        const t = Math.min(1, (now - startTime) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        setTrim(eased);
        if (t >= 1) {
          // Final state: clear the trim entirely so subsequent paint changes
          // (theme toggles, route swaps) don't carry forward stale trim data.
          clearTrim();
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
      // Endpoint markers intentionally persist across this cleanup so the next
      // render can reposition them via marker.setLngLat instead of re-mounting.
      // They're disposed in the dedicated unmount effect below.
    };
  // intentional: only re-render route when result/turnCoords change; mapRef is a stable ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, turnCoords]);

  // Unmount-only: release React roots backing the persistent endpoint markers.
  // We intentionally read endpointMarkersRef.current at unmount time (not at
  // effect-mount time) so the cleanup sees the latest marker objects.
  useEffect(() => {
    const markersRef = endpointMarkersRef;
    return () => {
      const markers = markersRef.current;
      for (const kind of ["from", "to"]) {
        const m = markers[kind];
        if (!m) continue;
        try { m.marker.remove(); } catch { /* already removed */ }
        const root = m.root;
        queueMicrotask(() => { try { root.unmount(); } catch { /* already gone */ } });
        markers[kind] = null;
      }
    };
  }, []);

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
          Tiles unavailable. Try again in a moment.
        </div>
      )}
      {pickMode && !previewPick && (
        <div className="map-pick-hint">
          <span className="map-pick-hint-lamp" aria-hidden="true" />
          <em>Pan or zoom, then click the map to set this point.</em>
        </div>
      )}
      {previewPick && (
        <div className="map-pick-confirm" role="dialog" aria-label="Confirm location">
          <div className="map-pick-confirm-label">
            {previewPick.resolving
              ? "Looking up that spot…"
              : (previewPick.label
                  || `${previewPick.lat.toFixed(5)}, ${previewPick.lon.toFixed(5)}`)}
          </div>
          <div className="map-pick-confirm-sub">
            Click again to move the pin. Confirm to keep it.
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
        <button className="map-unlock-btn" onClick={handleUnlock} aria-label="Unlock map gestures">
          <WPIcon name="unlock" size={14} />
          Unlock map
        </button>
      )}
    </div>
  );
}
