import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import { WPIcon } from "../wayfarer/walkpath-icons.jsx";
import {
  renderExplore,
  clearExploreLayers,
} from "../mapHelpers.js";

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
      renderExplore(
        map, exploreResult,
        {
          showResidential,
          activeSubs: activeSubs ?? null,
          categoryStyles: categoryStyles ?? [],
          fitPadding: mapPaddingRef.current ?? 60,
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
  }, [mode, exploreResult, showResidential, activeSubs, categoryStyles]);

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
