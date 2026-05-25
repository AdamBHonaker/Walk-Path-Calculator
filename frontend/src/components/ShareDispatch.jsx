import { useEffect, useRef, forwardRef, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  renderWalkRoute,
  lockMapGestures,
  MAP_STYLE_URL,
  DEFAULT_MAP_CENTER,
  MAP_TINT_LAYER_ID,
  getActiveMapTint,
} from "../mapHelpers.js";
import { safePaceLabel, motivationMessage } from "../lib/routeFormat.js";
import { calorieEquivalent } from "../calorieEquiv.js";
import { WPIcon } from "../wayfarer/walkpath-icons.jsx";
import { COLOPHON_TEXT, DEFAULT_ATTRIBUTION_SOURCES } from "../wayfarer/primitives.jsx";
import "./ShareCard.css";

// TD-044: inline-style → CSS-class migration (the final SEC-007 chunk).
// Static styles live in ShareCard.css; only per-instance dynamics stay
// inline. Three dynamic surfaces remain:
//   1. .share-card-stats `gridTemplateColumns` — 2 / 3 / 4 columns
//      depending on mobility profile + pace-label availability.
//   2. .share-card-stats__cell `borderRight` — last cell omits the
//      divider; can't be expressed as `:last-child` because the cell
//      count varies per render.
//   3. .share-card-stats__num `fontSize` — shrinks from 22 px to 16 px
//      when the value string is > 4 chars so a "leisurely" value
//      doesn't overflow next to a "2.8".

function formatIssueDate(d = new Date()) {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export const ShareDispatch = forwardRef(function ShareDispatch(
  { result, originLabel, destLabel, onMapReady, mapInstanceRef, siteHost, mobilityProfile = "walking" },
  ref,
) {
  const isWheeled = mobilityProfile === "wheeled";
  const mapContainerRef = useRef(null);
  const layerIds = useRef([]);
  const sourceIds = useRef([]);
  const mountedRef = useRef(true);

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
    if (mapInstanceRef) mapInstanceRef.current = map;

    map.once("load", () => {
      // OPT-042: install the editorial map tint BEFORE the route layers
      // are added so the route polyline + endpoint markers render ABOVE
      // it (un-tinted Wayfarer colors), matching the live-map paint
      // contract. The share PNG bakes the tint into the rendered map
      // background so the exported image matches what the user sees.
      if (!map.getLayer(MAP_TINT_LAYER_ID)) {
        const tint = getActiveMapTint();
        map.addLayer({
          id:    MAP_TINT_LAYER_ID,
          type:  "background",
          paint: {
            "background-color":   tint.color,
            "background-opacity": tint.opacity,
          },
        });
      }
      // Share-card route uses ember (#9c2a1a) — kept in sync with --ember in
      // tokens.css. Hex literal because MapLibre paint won't resolve
      // `var(--ember)`; a CSS-var resolver here would be over-engineering.
      renderWalkRoute(map, result, null, null, layerIds.current, sourceIds.current, 18, "#9c2a1a");
      map.once("idle", () => {
        if (mountedRef.current) onMapReady?.();
      });
    });

    return () => {
      map.remove();
      if (mapInstanceRef) mapInstanceRef.current = null;
      layerIds.current = [];
      sourceIds.current = [];
    };
  }, [result, onMapReady, mapInstanceRef]);

  const motivation = useMemo(
    () => (result ? motivationMessage(result.total_steps, mobilityProfile) : null),
    [result, mobilityProfile],
  );
  const equiv = useMemo(
    () => (!isWheeled && result?.calories_approx > 0 ? calorieEquivalent(result.calories_approx) : null),
    [result, isWheeled],
  );

  if (!result) return null;
  const {
    total_steps,
    total_miles,
    total_minutes,
    calories_approx,
    pace,
  } = result;
  const paceLabel = safePaceLabel(pace);

  const statCells = isWheeled
    ? [
        { v: total_miles, u: "miles" },
        { v: total_minutes, u: "minutes" },
      ]
    : [
        { v: total_miles, u: "miles" },
        { v: total_minutes, u: "minutes" },
        { v: calories_approx, u: "calories" },
        ...(paceLabel ? [{ v: paceLabel.split(" · ")[0], u: paceLabel.split(" · ")[1] || "pace" }] : []),
      ];
  const statsGridTemplate = `repeat(${statCells.length}, 1fr)`;

  return (
    <div ref={ref} className="share-card paper-grain paper-bright">
      {/* Masthead */}
      <div className="share-card-masthead">
        <span>{formatIssueDate()}</span>
        <span className="share-card-masthead__brand">Passage</span>
      </div>

      {/* Title block */}
      <div className="share-card-title">
        <div className="share-card-title__eyebrow">A Dispatch · On Foot</div>
        <h1 className="share-card-title__heading">
          <span className="share-card-title__heading-prep">From </span>
          {originLabel}
          <br />
          <span className="share-card-title__heading-prep">to </span>
          {destLabel}
        </h1>
      </div>

      {/* Double rule */}
      <div className="share-card-rule" />

      {/* Drop figure + italic body */}
      <div className="share-card-drop">
        <div className="share-card-drop__figure">
          {isWheeled ? total_miles : total_steps.toLocaleString()}
        </div>
        <div className="share-card-drop__body">
          <div className="share-card-drop__label">
            {isWheeled ? "Miles · all the way" : "Steps · all the way"}
          </div>
          {motivation && (
            <div className="share-card-drop__motivation">{motivation}</div>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="share-card-map-wrap">
        <div ref={mapContainerRef} className="share-card-map" />
      </div>

      {/* Stats grid — gridTemplateColumns is dynamic (per render) */}
      <div className="share-card-stats" style={{ gridTemplateColumns: statsGridTemplate }}>
        {statCells.map((s, i, arr) => (
          <div
            key={i}
            className="share-card-stats__cell"
            // borderRight is dynamic — last cell omits the divider, and the
            // cell count varies per render so :last-child won't suffice.
            style={{ borderRight: i < arr.length - 1 ? "1px solid var(--mute-fog)" : "none" }}
          >
            <div
              className="share-card-stats__num"
              // fontSize is dynamic — shrink to 16 px when the value string is
              // > 4 chars (e.g. "Strolling" pace label) so it doesn't overflow
              // next to a numeric cell.
              style={{ fontSize: typeof s.v === "string" && s.v.length > 4 ? 16 : 22 }}
            >
              {s.v}
            </div>
            <div className="share-card-stats__unit">{s.u}</div>
          </div>
        ))}
      </div>

      {/* Calorie equivalent aside */}
      {equiv && (
        <div className="share-card-equiv">
          <span className="share-card-equiv__pill">
            <WPIcon name="calorie-sigil" size={12} color="var(--gilt)" />
            {equiv}
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="share-card-footer">
        <span className="share-card-footer__brand">Passage</span>
        <span className="share-card-footer__colophon">{COLOPHON_TEXT}</span>
      </div>

      {/* Data attribution — mirrors the page-footer WFAttribution subline so
          the share card credits upstream sources (CDP / OSM / LocationIQ)
          even when the PNG is shared standalone. */}
      <div className="share-card-data">
        <span className="share-card-data__sources">
          Data: {DEFAULT_ATTRIBUTION_SOURCES.join(" · ")}
        </span>
      </div>

      {/* Visit strip — printed URL invites recipients of the PNG to plan
          their own trip. The full deep-link with stops is carried by the
          Web Share API / clipboard path; here we only print the host. */}
      {siteHost && (
        <div className="share-card-visit">
          <span className="share-card-visit__cta">Plan yours at</span>
          <span className="share-card-visit__host">{siteHost}</span>
        </div>
      )}
    </div>
  );
});
