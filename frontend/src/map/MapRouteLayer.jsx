import { useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import { WFFromMark, WFToMark } from "../wayfarer/primitives.jsx";
import {
  renderWalkRoute,
  buildRouteSegments,
  SEG_ALT_OPACITY_EXPR,
} from "../mapHelpers.js";

// Draw-in pacing: ~2 Chicago long blocks per second (long block ≈ 0.125 mi),
// i.e. 0.25 mi/sec. Bounded so tiny/huge routes still feel reasonable.
//
// History: shipped at 4 blocks/sec when the animation grew source LineString
// data each frame. After switching to `line-trim-offset` (GPU-side reveal,
// see render() below) the same numeric duration FELT faster — drawing-on-paper
// vs. wiping-fog-off-glass. Halved the blocks-per-second rate, doubled the
// floor, and raised the ceiling so long multi-stop tours (a 30-mi walk
// through 5 neighborhoods) get visual time proportional to the distance
// instead of snapping in 8 seconds flat.
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

// Renders the route polyline + endpoint markers + draw-in animation, and
// updates the active-turn highlight when the user clicks a direction step.
// The map itself is owned by MapView; this component subscribes to it via
// `mapRef`.
export function MapRouteLayer({
  mapRef,
  result,
  turnCoords,
  activeTurnIndex,
  mode,
  mapPadding,
}) {
  const layerIds       = useRef([]);
  const sourceIds      = useRef([]);
  const rafRef         = useRef(null);
  const turnCoordsRef  = useRef(turnCoords);
  // Endpoint markers persist across renders and are repositioned in place
  // (rather than torn down + re-mounted) when the route changes.
  const endpointMarkersRef = useRef({ from: null, to: null });
  // Read inside the route-render and active-turn effects without re-running
  // them: the sheet drag shouldn't force a fitBounds, but the next route
  // arrival should fit using the current sheet height.
  const mapPaddingRef = useRef(mapPadding);

  useEffect(() => { turnCoordsRef.current = turnCoords; }, [turnCoords]);
  useEffect(() => { mapPaddingRef.current = mapPadding; }, [mapPadding]);

  // OPT-038 + OPT-059: memoize the per-step segment FeatureCollection on
  // (path, directions) identity. `buildRouteSegments` internally walks the
  // path to compute cum-distance for every direction step — a flavor swap
  // that lands on the same path (and the same directions array) used to
  // re-do this work end-to-end. With the memo, that flavor swap is a
  // useMemo cache hit and the data-load effect sees a stable segments
  // reference, skipping the upsertGeoSource setData call entirely (its
  // own equality check short-circuits on identical data).
  const routeSegments = useMemo(() => {
    if (!result?.path?.length || !result?.directions?.length) return null;
    return buildRouteSegments(result.path, result.directions);
  }, [result?.path, result?.directions]);

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
      // Reset any leftover line-trim-offset from a previously-cancelled
      // draw-in animation BEFORE the reduced-motion / short-path bails below.
      // Without this, a route swap mid-animation that lands on a render which
      // skips the animation (prefers-reduced-motion or path.length < 2) would
      // leave the new polyline half-hidden at the prior trim value.
      try { map.setPaintProperty("walk-path-line", "line-trim-offset", null); }
      catch { /* layer not yet created */ }
      // In explore mode, the route line + endpoints don't render at all —
      // the explore-mode layer owns the map's painted state. Tear down any
      // route artifacts left behind from a previous mode flip.
      if (mode === "explore") {
        clearEndpointMarkers();
        return;
      }
      if (!result) {
        clearEndpointMarkers();
        return;
      }
      // renderWalkRoute upserts sources via setData when they already exist,
      // so back-to-back renders (route flavor swap) reuse GPU buffers instead
      // of tearing every source down and rebuilding it. `routeSegments` is
      // the memoised per-step FeatureCollection — passing it in skips the
      // cum-distance walk inside `buildRouteSegments` for flavor swaps that
      // land on an identical (path, directions) pair.
      renderWalkRoute(
        map, result, turnCoords, activeTurnIndex,
        layerIds.current, sourceIds.current,
        mapPaddingRef.current ?? 60, undefined, /* drawEndpointDots = */ false,
        routeSegments,
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

      // Reset scrim/segment visibility for the new animation cycle.
      // Placed here (after renderWalkRoute) so layers exist on first render
      // — the layers are created by renderWalkRoute above, so try/catch
      // silently skips first-render attempts on a fresh map.
      try { map.setPaintProperty("walk-path-line",    "line-opacity", 1); } catch { /* layer not yet created */ }
      try { map.setPaintProperty("walk-segments-line","line-opacity", 0); } catch { /* layer not yet created */ }

      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
      if (reducedMotion) {
        // Reveal alternating segments immediately; skip draw-in.
        try { map.setPaintProperty("walk-path-line",    "line-opacity", 0);                    } catch { /* layer removed */ }
        try { map.setPaintProperty("walk-segments-line","line-opacity", SEG_ALT_OPACITY_EXPR); } catch { /* layer removed */ }
        return;
      }

      // Draw-in animation via MapLibre's `line-trim-offset` paint property —
      // visually trims the line without touching its source data. Two big wins:
      //   1. Source data stays as the full path. If RAF is throttled, cancelled,
      //      or stubbed in tests, the line stays visible by default.
      //   2. The trim is set INSIDE the first RAF callback, not synchronously,
      //      so a non-firing RAF leaves the line at default (no trim) = visible.
      const fullPath = result.path; // array of [lat, lon]
      if (!fullPath || fullPath.length < 2) {
        // Reveal without animation for degenerate paths.
        try { map.setPaintProperty("walk-path-line",    "line-opacity", 0);                    } catch { /* layer removed */ }
        try { map.setPaintProperty("walk-segments-line","line-opacity", SEG_ALT_OPACITY_EXPR); } catch { /* layer removed */ }
        return;
      }

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
        // Swap: hide the scrim, reveal the alternating-segment line.
        try { map.setPaintProperty("walk-path-line",    "line-trim-offset",  null);              } catch { /* layer removed */ }
        try { map.setPaintProperty("walk-path-line",    "line-opacity",      0);                 } catch { /* layer removed */ }
        try { map.setPaintProperty("walk-segments-line","line-opacity",      SEG_ALT_OPACITY_EXPR); } catch { /* layer removed */ }
        map.triggerRepaint();
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
  // OPT-038: narrowed from `[result, turnCoords, mode]` so a flavor swap that
  // produces an identical (path, directions) pair doesn't re-run the effect —
  // and even when the pair changes, `routeSegments` is the only thing in the
  // dep array that meaningfully captures "did the geometry change," sparing
  // the GPU buffer reallocation + draw-in re-kick on identity-only swaps.
  // Endpoint marker coords (origin_coords / dest_coords / stops) only change
  // when the underlying fetch result changes, and that always changes path
  // identity too — so the markers stay in sync via the same effect firing.
  // mapRef is a stable ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.path, result?.directions, routeSegments, turnCoords, mode]);

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

  // Active-turn highlight: flip a single feature's state instead of
  // rebuilding + re-uploading the whole turn-points GeoJSON. The walk-turns
  // layer paint reads `["feature-state", "active"]`, so this is a property
  // bump on existing tile data — no source rebuild, no GPU re-upload.
  const prevActiveTurnRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const src = map.getSource("walk-turns");
    if (!src) {
      prevActiveTurnRef.current = activeTurnIndex;
      return;
    }

    const prev = prevActiveTurnRef.current;
    if (prev != null && prev !== activeTurnIndex) {
      try { map.setFeatureState({ source: "walk-turns",    id: prev }, { active: false }); }
      catch { /* feature gone (route changed underfoot) */ }
      try { map.setFeatureState({ source: "walk-segments", id: prev }, { active: false }); }
      catch { /* segment source not present */ }
    }
    if (activeTurnIndex != null) {
      try { map.setFeatureState({ source: "walk-turns",    id: activeTurnIndex }, { active: true }); }
      catch { /* feature missing (deduped or route changed) */ }
      try { map.setFeatureState({ source: "walk-segments", id: activeTurnIndex }, { active: true }); }
      catch { /* segment source not present */ }
    }
    prevActiveTurnRef.current = activeTurnIndex;

    const coords = turnCoordsRef.current;
    if (activeTurnIndex != null && coords?.[activeTurnIndex]) {
      const [lat, lon] = coords[activeTurnIndex];
      const pad = mapPaddingRef.current;
      map.flyTo({
        center: [lon, lat],
        zoom: 16,
        duration: 600,
        ...(pad ? { padding: pad } : {}),
      });
    }
  // mapRef is a stable ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTurnIndex]);

  return null;
}
