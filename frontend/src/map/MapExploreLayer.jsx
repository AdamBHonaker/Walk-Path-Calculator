import { useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import { WPIcon } from "../wayfarer/walkpath-icons.jsx";
import {
  renderExplorePolygon,
  renderExploreResidential,
  renderExploreCanopy,
  renderExploreParks,
  renderExploreGreenSpace,
  renderExplorePlaces,
  clearExploreLayers,
  EXPLORE_STROKE_COLOR,
  CANOPY_BAND_COLORS,
} from "../mapHelpers.js";
import { useTheme } from "../lib/theme.js";
import { filterPlacesByVisibleCategories } from "../lib/exploreCategories.js";

// Defer `fn` until the MapLibre style is loaded. Returns a cleanup
// callback. The per-source render effects each call this so a freshly-
// mounted Map doesn't drop their first render on the floor when the
// style hasn't parsed yet — the prior single-effect implementation
// shared one listener; with per-source effects, each one needs its own
// guard.
function _whenStyleReady(map, fn) {
  if (map.isStyleLoaded()) {
    fn();
    return () => {};
  }
  map.once("load", fn);
  return () => { map.off("load", fn); };
}

// Resolve a Wayfarer color token like "var(--field)" to its current hex
// value. MapLibre paint properties don't parse CSS custom properties, so
// we read the computed value off the document root. Falls back to the
// passed-in string for raw colors (#hex, rgb(), etc.).
function resolveCssColor(value) {
  if (typeof value !== "string") return value;
  const m = value.match(/^var\((--[\w-]+)\)$/);
  if (!m) return value;
  if (typeof window === "undefined" || !document?.documentElement) return value;
  const resolved = getComputedStyle(document.documentElement)
    .getPropertyValue(m[1])
    .trim();
  return resolved || value;
}

// Renders the explorer's polygon + residential heatmap + clustered place
// pins. Owns the popup React-root lifecycle — the popup body is rendered
// into a portal hosted inside `maplibregl.Popup` so the browser anchors it
// to the pin during pan/zoom.
export function MapExploreLayer({
  mapRef,
  mode,
  exploreResult,
  showResidential,
  showParks,
  showTreeCanopy,
  showGreenSpace,
  activeSubs,
  categoryStyles,
  mapPadding,
  pickMode,
  onPlaceTap,
  onPlaceGoHere,
}) {
  const layerIds  = useRef([]);
  const sourceIds = useRef([]);
  const mapPaddingRef = useRef(mapPadding);
  useEffect(() => { mapPaddingRef.current = mapPadding; }, [mapPadding]);
  // Track identity of the last-rendered exploreResult so fitBounds is only
  // called when a new isochrone arrives, not on display-only re-renders
  // (category filter, heatmap toggle).
  const prevExploreResultRef = useRef(null);

  // TD-065 / F-08: the prior implementation observed Wayfarer's Cream / Dusk
  // swap via a MutationObserver on the `<html>` `class` attribute, then
  // bumped a `themeVersion` state counter to invalidate paint-color memos.
  // This worked but coupled the paint layer to a DOM side-effect — any
  // unrelated `<html>` class mutation would trip the observer, and the
  // observer + rAF batching layer was a lot of machinery for "did the
  // theme change?". The replacement: `useTheme()` subscribes to the
  // module-level publisher in `lib/theme.js`, which `applyTheme` notifies
  // synchronously. One write path, no DOM observation, no batching needed.
  const themeVersion = useTheme();

  // Build the GeoJSON FeatureCollection for the pin source from the
  // /explore response, filtered by the user's category/sub selection.
  // The filter predicate lives in lib/exploreCategories.js so the App
  // result panel's "X of Y places shown" counter and the map agree by
  // construction (otherwise the counter overstates what's visible).
  const placeFeatures = useMemo(() => {
    return filterPlacesByVisibleCategories(exploreResult?.places, activeSubs)
      .map(p => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: {
          name:        p.name ?? "",
          address:     p.address ?? "",
          category:    p.category ?? "",
          subcategory: p.subcategory ?? "",
          source:      p.source ?? "",
        },
      }));
    // Narrowed to `exploreResult?.places` — the top-level exploreResult
    // identity churns on every fetch (and on display-only re-renders that
    // pass a fresh wrapper) even when the underlying places array is
    // unchanged. Tying the memo to the array reference keeps an unchanged
    // pin set from rebuilding features + re-indexing supercluster.
  }, [exploreResult?.places, activeSubs]);

  // Build MapLibre `match` expressions that paint each pin by its
  // `category` property. CSS-var colors from `categoryStyles` are
  // resolved to literal hex up-front because MapLibre paint properties
  // don't parse `var(--…)`. Recomputed when categoryStyles changes OR
  // when the theme observer above bumps `themeVersion`, so Cream ↔ Dusk
  // re-resolves token hex without forcing a /explore refetch.
  const placeExpressions = useMemo(() => {
    const styles = Array.isArray(categoryStyles) ? categoryStyles : [];
    const colorPairs = [];
    const glyphPairs = [];
    for (const s of styles) {
      if (!s?.key) continue;
      colorPairs.push(s.key, resolveCssColor(s.color) || EXPLORE_STROKE_COLOR);
      glyphPairs.push(s.key, s.glyph || "•");
    }
    if (colorPairs.length === 0) {
      return {
        colorExpr: ["literal", EXPLORE_STROKE_COLOR],
        glyphExpr: ["literal", "•"],
      };
    }
    return {
      colorExpr: ["match", ["get", "category"], ...colorPairs, EXPLORE_STROKE_COLOR],
      glyphExpr: ["match", ["get", "category"], ...glyphPairs, "•"],
    };
  // `themeVersion` looks unused to the linter, but `resolveCssColor` reads
  // computed CSS-var values via `getComputedStyle`, so the bump is a real
  // signal that the resolved hex strings have changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryStyles, themeVersion]);

  // Resolve the canopy band CSS vars to literal hex strings; MapLibre
  // paint props don't parse `var(--…)`. Recomputed on theme flips for
  // the same reason `placeExpressions` is.
  const canopyBandColors = useMemo(() => ({
    low:  resolveCssColor(CANOPY_BAND_COLORS.low)  || CANOPY_BAND_COLORS.low,
    mid:  resolveCssColor(CANOPY_BAND_COLORS.mid)  || CANOPY_BAND_COLORS.mid,
    high: resolveCssColor(CANOPY_BAND_COLORS.high) || CANOPY_BAND_COLORS.high,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [themeVersion]);

  // Re-apply canopy band colors on theme flip without forcing the layer
  // to be torn down + rebuilt. Mirrors the placeExpressions effect below.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer?.("explore-canopy-fill")) return;
    try {
      map.setPaintProperty("explore-canopy-fill", "fill-color", [
        "match", ["get", "density_band"],
        "low",  canopyBandColors.low,
        "mid",  canopyBandColors.mid,
        "high", canopyBandColors.high,
        canopyBandColors.mid,
      ]);
    } catch { /* layer torn down between checks */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canopyBandColors]);

  // Re-apply pin color + glyph expressions to the live layers when
  // `placeExpressions` changes. `ensureLayer` short-circuits on
  // already-present layers, so a `renderExplore` re-run wouldn't push
  // the new expression — we have to call `setPaintProperty` /
  // `setLayoutProperty` ourselves. Skips silently when the layers
  // haven't been created yet (the next render effect will pick them up
  // with the current expressions).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.getLayer?.("explore-places-pin")) return;
    try {
      map.setPaintProperty("explore-places-pin", "circle-color", placeExpressions.colorExpr);
      map.setLayoutProperty("explore-places-glyph", "text-field", placeExpressions.glyphExpr);
    } catch { /* layer torn down between checks */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeExpressions]);

  // ── Per-source render effects ─────────────────────────────────────────
  //
  // OPT-039 — the legacy single effect re-ran `renderExplore` end-to-end
  // on any heatmap toggle, including `setData` on the supercluster pin
  // source (re-tiles ~200 places). Splitting by layer source means
  // toggling residential doesn't touch the canopy / parks / greenspace
  // / pins layers, and a category-filter change doesn't touch the
  // heatmaps. Each effect's dep array is scoped to the toggle + the
  // exact GeoJSON slice it owns.
  //
  // Cleanup contract: when `mode !== "explore"` or the relevant data is
  // null, each helper drops its own tracked source + layers. The
  // polygon effect additionally drops the whole stack (mirrors the
  // legacy `clearExploreLayers` semantics) when the polygon itself goes
  // away — because heatmaps + pins are meaningless without a polygon
  // and the operator could land here via a route → explore → route → …
  // bounce. Other effects either short-circuit (data already absent) or
  // run their own targeted dropTracked, so the second pass is a no-op
  // for sources already cleared by the polygon path.

  // Polygon effect — also owns the "leaving explore" full clear so the
  // stack doesn't leak heatmap / pin layers when mode flips back to
  // route. Tracks identity of the last-rendered exploreResult so
  // fitBounds is only called when a NEW isochrone arrives, not on
  // display-only re-renders (category filter, heatmap toggle).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return _whenStyleReady(map, () => {
      if (mode !== "explore" || !exploreResult?.polygon) {
        // Clear everything — heatmaps/pins make no sense without a
        // polygon, and a mode flip should wipe the slate fully.
        clearExploreLayers(map, layerIds.current, sourceIds.current);
        prevExploreResultRef.current = null;
        return;
      }
      const didResultChange = exploreResult !== prevExploreResultRef.current;
      prevExploreResultRef.current = exploreResult;
      renderExplorePolygon(map, exploreResult.polygon, layerIds.current, sourceIds.current, {
        fitOnRender: didResultChange,
        fitPadding: mapPaddingRef.current ?? 60,
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, exploreResult]);

  // Residential heatmap effect.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return _whenStyleReady(map, () => {
      const data = mode === "explore" ? exploreResult?.residential_heatmap : null;
      renderExploreResidential(map, showResidential, data, layerIds.current, sourceIds.current);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showResidential, exploreResult?.residential_heatmap]);

  // Tree-canopy heatmap effect. `canopyBandColors` is intentionally
  // omitted from deps — the dedicated paint-update effect above handles
  // theme-driven color rotations on an existing layer via
  // `setPaintProperty`, and a closure read here picks up the latest
  // band-color values for any first-time layer creation.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return _whenStyleReady(map, () => {
      const data = mode === "explore" ? exploreResult?.tree_canopy_heatmap : null;
      renderExploreCanopy(map, showTreeCanopy, data, canopyBandColors, layerIds.current, sourceIds.current);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showTreeCanopy, exploreResult?.tree_canopy_heatmap]);

  // CPD parks heatmap effect.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return _whenStyleReady(map, () => {
      const data = mode === "explore" ? exploreResult?.parks_heatmap : null;
      renderExploreParks(map, showParks, data, layerIds.current, sourceIds.current);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showParks, exploreResult?.parks_heatmap]);

  // Non-CPD green-space heatmap effect.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return _whenStyleReady(map, () => {
      const data = mode === "explore" ? exploreResult?.green_space_heatmap : null;
      renderExploreGreenSpace(map, showGreenSpace, data, layerIds.current, sourceIds.current);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showGreenSpace, exploreResult?.green_space_heatmap]);

  // Place pins + clusters effect. `placeExpressions` is consumed at
  // initial-layer-create time only; later expression changes are picked
  // up by the dedicated `placeExpressions` effect higher up via
  // `setPaintProperty` + `setLayoutProperty`, avoiding a source tear-
  // down. So this effect's deps don't include `placeExpressions`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return _whenStyleReady(map, () => {
      if (mode !== "explore" || !exploreResult?.polygon) return;
      renderExplorePlaces(map, placeFeatures, placeExpressions, layerIds.current, sourceIds.current);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, placeFeatures, exploreResult?.polygon]);

  // ── Pin/cluster click + popup lifecycle ─────────────────────────────
  // Cluster click zooms in; pin click pops a MapLibre Popup that contains a
  // React-rendered card (name, address, a "Walk here" CTA). Using
  // maplibregl.Popup keeps the popover anchored to the pin during pan/zoom —
  // far cleaner than tracking screen pixels.
  const popupRef     = useRef(null);
  const popupRootRef = useRef(null);
  const popupElRef   = useRef(null);
  const onPlaceGoHereRef = useRef(onPlaceGoHere);
  useEffect(() => { onPlaceGoHereRef.current = onPlaceGoHere; }, [onPlaceGoHere]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mode !== "explore") {
      // Tear down popup state when leaving explore mode.
      try { popupRef.current?.remove(); } catch { /* gone */ }
      popupRef.current = null;
      const root = popupRootRef.current;
      popupRootRef.current = null;
      popupElRef.current = null;
      if (root) queueMicrotask(() => { try { root.unmount(); } catch { /* gone */ } });
      return;
    }

    function teardownPopup() {
      try { popupRef.current?.remove(); } catch { /* already gone */ }
      popupRef.current = null;
      const root = popupRootRef.current;
      popupRootRef.current = null;
      popupElRef.current = null;
      if (root) queueMicrotask(() => { try { root.unmount(); } catch { /* gone */ } });
    }

    function renderPopupContent(props) {
      const root = popupRootRef.current;
      if (!root) return;
      root.render(
        <div className="explore-popup-card">
          <div className="explore-popup-card-name">{props.name || "Unnamed"}</div>
          {props.address && (
            <div className="explore-popup-card-address">{props.address}</div>
          )}
          <div className="explore-popup-card-meta">
            <span className="explore-popup-card-cat">
              {(props.subcategory || props.category || "").replace(/_/g, " ")}
            </span>
            {props.source && (
              <span className="explore-popup-card-source">
                via {props.source.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <button
            type="button"
            className="explore-popup-card-walk"
            onClick={() => {
              const cb = onPlaceGoHereRef.current;
              teardownPopup();
              if (cb) cb({
                lat: props.lat,
                lon: props.lon,
                name: props.name,
                address: props.address,
              });
            }}
          >
            <WPIcon name="stride" size={14} />
            <span>Go here</span>
          </button>
        </div>
      );
    }

    function onPinClick(e) {
      const f = e.features?.[0];
      if (!f) return;
      const [lon, lat] = f.geometry.coordinates;
      const props = { ...f.properties, lat, lon };

      onPlaceTap?.();

      // Reuse the existing popup container DOM so React re-renders the card
      // in place; avoids a flash of empty popup when stepping pin → pin.
      if (!popupElRef.current) {
        popupElRef.current = document.createElement("div");
        popupRootRef.current = createRoot(popupElRef.current);
      }
      renderPopupContent(props);

      // Drop the ref BEFORE removing the old popup so the prior popup's
      // close handler (which fires synchronously inside .remove()) sees a
      // mismatch and skips teardownPopup(). Otherwise it would null out
      // popupElRef.current / unmount popupRootRef.current right before the
      // new popup tries to mount into them, leaving the second click's
      // popup empty.
      if (popupRef.current) {
        const stale = popupRef.current;
        popupRef.current = null;
        try { stale.remove(); } catch { /* gone */ }
      }
      const me = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        offset: 18,
        className: "explore-popup",
        maxWidth: "260px",
      })
        .setLngLat([lon, lat])
        .setDOMContent(popupElRef.current)
        .addTo(map);
      popupRef.current = me;

      me.on("close", () => {
        // Only tear down if `me` is still the live popup — guards against
        // a pin→pin click sequence where a later popup has already replaced
        // popupRef.current by the time this handler fires.
        if (popupRef.current === me) {
          teardownPopup();
        }
      });
    }
    function onClusterClick(e) {
      const f = e.features?.[0];
      if (!f) return;
      const src = map.getSource("explore-places");
      if (!src) return;
      src.getClusterExpansionZoom(f.properties.cluster_id, (err, zoom) => {
        if (err) return;
        map.easeTo({
          center: f.geometry.coordinates,
          zoom: Math.min(17, zoom),
          duration: 450,
        });
      });
    }
    function setPinCursor() { map.getCanvas().style.cursor = "pointer"; }
    function clearPinCursor() {
      // The pick-mode layer owns the cursor while picking; don't clobber.
      if (!pickMode) map.getCanvas().style.cursor = "";
    }

    map.on("click",      "explore-places-pin",     onPinClick);
    map.on("click",      "explore-places-cluster", onClusterClick);
    map.on("mouseenter", "explore-places-pin",     setPinCursor);
    map.on("mouseleave", "explore-places-pin",     clearPinCursor);
    map.on("mouseenter", "explore-places-cluster", setPinCursor);
    map.on("mouseleave", "explore-places-cluster", clearPinCursor);

    return () => {
      map.off("click",      "explore-places-pin",     onPinClick);
      map.off("click",      "explore-places-cluster", onClusterClick);
      map.off("mouseenter", "explore-places-pin",     setPinCursor);
      map.off("mouseleave", "explore-places-pin",     clearPinCursor);
      map.off("mouseenter", "explore-places-cluster", setPinCursor);
      map.off("mouseleave", "explore-places-cluster", clearPinCursor);
      teardownPopup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pickMode, onPlaceTap]);

  return null;
}
