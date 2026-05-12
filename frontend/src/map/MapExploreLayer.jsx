import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import { WPIcon } from "../wayfarer/walkpath-icons.jsx";
import {
  renderExplore,
  clearExploreLayers,
  EXPLORE_STROKE_COLOR,
} from "../mapHelpers.js";

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
  activeSubs,
  categoryStyles,
  mapPadding,
  pickMode,
  onPlaceTap,
  onPlaceWalkHere,
}) {
  const layerIds  = useRef([]);
  const sourceIds = useRef([]);
  const mapPaddingRef = useRef(mapPadding);
  useEffect(() => { mapPaddingRef.current = mapPadding; }, [mapPadding]);
  // Track identity of the last-rendered exploreResult so fitBounds is only
  // called when a new isochrone arrives, not on display-only re-renders
  // (category filter, heatmap toggle).
  const prevExploreResultRef = useRef(null);

  // Theme observer: Wayfarer's Cream / Dusk swap is a class flip on
  // `<html>` (e.g. `theme-dusk`). Pin colors come from CSS-var tokens
  // that resolve differently per theme, so we bump a counter on each
  // class mutation and feed it into `placeExpressions`' deps. The
  // colors-only effect below then re-applies the new hex via
  // `setPaintProperty` without re-tiling the supercluster source.
  const [themeVersion, setThemeVersion] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || !document?.documentElement) return;
    const obs = new MutationObserver(() => setThemeVersion(v => v + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Build the GeoJSON FeatureCollection for the pin source from the
  // /explore response, filtered by the user's category/sub selection.
  // A place passes when either its parent category is in `activeSubs`
  // (user picked the whole category) or its `category/subcategory`
  // composite key is (user picked a specific sub). When `activeSubs`
  // is null, no filter is applied — matches the legacy "show everything"
  // debug path.
  const placeFeatures = useMemo(() => {
    const places = exploreResult?.places;
    if (!Array.isArray(places)) return [];
    return places
      .filter(p => {
        if (typeof p?.lat !== "number" || typeof p?.lon !== "number") return false;
        if (!activeSubs) return true;
        if (activeSubs.has(p.category)) return true;
        if (p.subcategory && activeSubs.has(`${p.category}/${p.subcategory}`)) return true;
        return false;
      })
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
  }, [exploreResult, activeSubs]);

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

  // ── Polygon + heatmap + pins render ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const renderE = () => {
      if (mode !== "explore") {
        clearExploreLayers(map, layerIds.current, sourceIds.current);
        return;
      }
      if (!exploreResult) {
        clearExploreLayers(map, layerIds.current, sourceIds.current);
        return;
      }
      const didResultChange = exploreResult !== prevExploreResultRef.current;
      prevExploreResultRef.current = exploreResult;
      renderExplore(
        map, exploreResult,
        {
          showResidential,
          placeFeatures,
          placeExpressions,
          fitPadding: mapPaddingRef.current ?? 60,
          fitOnRender: didResultChange,
        },
        layerIds.current, sourceIds.current,
      );
    };

    if (map.isStyleLoaded()) {
      renderE();
    } else {
      map.once("load", renderE);
    }

    return () => {
      map.off("load", renderE);
    };
  // ref-stored map handle is stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, exploreResult, showResidential, placeFeatures, placeExpressions]);

  // ── Pin/cluster click + popup lifecycle ─────────────────────────────
  // Cluster click zooms in; pin click pops a MapLibre Popup that contains a
  // React-rendered card (name, address, a "Walk here" CTA). Using
  // maplibregl.Popup keeps the popover anchored to the pin during pan/zoom —
  // far cleaner than tracking screen pixels.
  const popupRef     = useRef(null);
  const popupRootRef = useRef(null);
  const popupElRef   = useRef(null);
  const onPlaceWalkHereRef = useRef(onPlaceWalkHere);
  useEffect(() => { onPlaceWalkHereRef.current = onPlaceWalkHere; }, [onPlaceWalkHere]);

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
              const cb = onPlaceWalkHereRef.current;
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
            <span>Walk here</span>
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

      if (popupRef.current) {
        try { popupRef.current.remove(); } catch { /* gone */ }
      }
      popupRef.current = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        offset: 18,
        className: "explore-popup",
        maxWidth: "260px",
      })
        .setLngLat([lon, lat])
        .setDOMContent(popupElRef.current)
        .addTo(map);

      popupRef.current.on("close", () => {
        // Only tear down if this is still the live popup.
        if (popupRef.current && popupRef.current.isOpen?.() === false) {
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
