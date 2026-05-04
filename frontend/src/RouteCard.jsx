import { useEffect, useRef, forwardRef } from "react";
import maplibregl from "maplibre-gl";
import {
  renderWalkRoute,
  lockMapGestures,
  MAP_STYLE_URL,
  DEFAULT_MAP_CENTER,
} from "./mapHelpers.js";
import { safePaceLabel } from "./App.jsx";

const RouteCard = forwardRef(function RouteCard(
  { result, originLabel, destLabel, onMapReady },
  ref,
) {
  const mapContainerRef = useRef(null);
  const layerIds        = useRef([]);
  const sourceIds       = useRef([]);
  const mountedRef      = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !result) return;

    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE_URL,
      center: DEFAULT_MAP_CENTER,
      zoom: 12,
      preserveDrawingBuffer: true,
      attributionControl: false,
      failIfMajorPerformanceCaveat: false,
    });

    lockMapGestures(map);

    map.once("load", () => {
      renderWalkRoute(map, result, null, null, layerIds.current, sourceIds.current, 20);
      map.once("idle", () => {
        if (mountedRef.current) onMapReady?.();
      });
    });

    return () => {
      map.remove();
      layerIds.current  = [];
      sourceIds.current = [];
    };
  }, [result, onMapReady]);

  if (!result) return null;
  const { total_steps, total_miles, total_minutes, calories_approx, pace } = result;
  const paceLabel = safePaceLabel(pace);

  return (
    <div className="route-card" ref={ref}>
      <div className="route-card-header">
        <span className="route-card-brand">🚶 Walk Path</span>
        <span className="route-card-city">📍 Chicago, IL</span>
      </div>

      <div ref={mapContainerRef} className="route-card-map" />

      <div className="route-card-body">
        <div className="route-card-steps">{total_steps.toLocaleString()}</div>
        <div className="route-card-steps-label">steps</div>

        <div className="route-card-stats">
          <span className="route-card-stat">📍 {total_miles} mi</span>
          <span className="route-card-stat">⏱ {total_minutes} min</span>
          <span className="route-card-stat">🔥 ~{calories_approx} cal</span>
          {paceLabel && <span className="route-card-stat">🚶 {paceLabel}</span>}
        </div>

        <div className="route-card-route">
          <span className="route-card-origin">{originLabel}</span>
          <span className="route-card-arrow">→</span>
          <span className="route-card-dest">{destLabel}</span>
        </div>
      </div>

      <div className="route-card-footer">walkpath.app</div>
    </div>
  );
});

export default RouteCard;
