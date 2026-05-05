import { useEffect, useRef, forwardRef, useMemo } from "react";
import maplibregl from "maplibre-gl";
import {
  renderWalkRoute,
  lockMapGestures,
  MAP_STYLE_URL,
  DEFAULT_MAP_CENTER,
} from "../mapHelpers.js";
import { safePaceLabel, motivationMessage } from "../lib/routeFormat.js";
import { calorieEquivalent } from "../calorieEquiv.js";
import { WPIcon } from "../wayfarer/walkpath-icons.jsx";

const CARD_WIDTH = 480;
const HORIZONTAL_PAD = 22;
const MAP_HEIGHT = 200;

function formatIssueDate(d = new Date()) {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export const ShareDispatch = forwardRef(function ShareDispatch(
  { result, originLabel, destLabel, onMapReady },
  ref,
) {
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

    map.once("load", () => {
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
      layerIds.current = [];
      sourceIds.current = [];
    };
  }, [result, onMapReady]);

  const motivation = useMemo(
    () => (result ? motivationMessage(result.total_steps) : null),
    [result],
  );
  const equiv = useMemo(
    () => (result?.calories_approx > 0 ? calorieEquivalent(result.calories_approx) : null),
    [result],
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

  return (
    <div
      ref={ref}
      className="paper-grain paper-bright"
      style={{
        width: CARD_WIDTH,
        background: "var(--paper-bright)",
        color: "var(--ink)",
        border: "2px solid var(--ink)",
        fontFamily: "var(--wf-serif)",
        boxSizing: "border-box",
      }}
    >
      {/* Masthead */}
      <div
        style={{
          padding: "10px 18px 8px",
          borderBottom: "1px solid var(--ink)",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          fontFamily: "var(--wf-sans)",
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 2.5,
          textTransform: "uppercase",
          color: "var(--mute)",
        }}
      >
        <span>{formatIssueDate()}</span>
        <span style={{ color: "var(--ink)" }}>Passage</span>
      </div>

      {/* Title block */}
      <div style={{ padding: "10px 22px 6px", textAlign: "center" }}>
        <div
          style={{
            fontFamily: "var(--wf-sans)",
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "var(--ember)",
          }}
        >
          A Dispatch · On Foot
        </div>
        <h1
          style={{
            fontFamily: "var(--wf-serif)",
            fontWeight: 700,
            fontStyle: "italic",
            fontSize: 26,
            lineHeight: 1.1,
            margin: "4px 0 0",
            color: "var(--ink)",
            letterSpacing: -0.4,
          }}
        >
          <span style={{ fontStyle: "normal", fontWeight: 500 }}>From </span>
          {originLabel}
          <br />
          <span style={{ fontStyle: "normal", fontWeight: 500 }}>to </span>
          {destLabel}
        </h1>
      </div>

      {/* Double rule */}
      <div
        style={{
          margin: "0 22px",
          height: 5,
          borderTop: "1px solid var(--ink)",
          borderBottom: "1px solid var(--ink)",
        }}
      />

      {/* Drop figure + italic body */}
      <div
        style={{
          padding: "10px 22px 8px",
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
        }}
      >
        <div
          style={{
            fontFamily: "var(--wf-mono)",
            fontSize: 54,
            fontWeight: 600,
            color: "var(--ink)",
            lineHeight: 0.85,
            letterSpacing: -2,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {total_steps.toLocaleString()}
        </div>
        <div style={{ flex: 1, paddingTop: 4, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--wf-sans)",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "var(--ink)",
            }}
          >
            Steps · all the way
          </div>
          {motivation && (
            <div
              style={{
                fontFamily: "var(--wf-serif)",
                fontStyle: "italic",
                fontSize: 13,
                color: "var(--ink-soft)",
                lineHeight: 1.45,
                marginTop: 6,
              }}
            >
              {motivation}
            </div>
          )}
        </div>
      </div>

      {/* Map */}
      <div style={{ padding: `0 ${HORIZONTAL_PAD}px 12px` }}>
        <div
          ref={mapContainerRef}
          style={{
            height: MAP_HEIGHT,
            width: "100%",
            background: "var(--paper-deep)",
            border: "1px solid var(--ink)",
            position: "relative",
            overflow: "hidden",
          }}
        />
      </div>

      {/* Stats grid */}
      <div
        style={{
          margin: "0 22px",
          borderTop: "1px solid var(--ink)",
          borderBottom: "1px solid var(--ink)",
          display: "grid",
          gridTemplateColumns: paceLabel ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr",
        }}
      >
        {[
          { v: total_miles, u: "miles" },
          { v: total_minutes, u: "minutes" },
          { v: calories_approx, u: "calories" },
          ...(paceLabel ? [{ v: paceLabel.split(" · ")[0], u: paceLabel.split(" · ")[1] || "pace" }] : []),
        ].map((s, i, arr) => (
          <div
            key={i}
            style={{
              textAlign: "center",
              padding: "10px 4px",
              borderRight: i < arr.length - 1 ? "1px solid var(--mute-fog)" : "none",
            }}
          >
            <div
              style={{
                fontFamily: "var(--wf-mono)",
                fontSize: typeof s.v === "string" && s.v.length > 4 ? 16 : 22,
                fontWeight: 600,
                color: "var(--ink)",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {s.v}
            </div>
            <div
              style={{
                fontFamily: "var(--wf-sans)",
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: 1.5,
                color: "var(--mute)",
                textTransform: "uppercase",
                marginTop: 4,
              }}
            >
              {s.u}
            </div>
          </div>
        ))}
      </div>

      {/* Calorie equivalent aside */}
      {equiv && (
        <div style={{ padding: "10px 22px 0", textAlign: "center" }}>
          <span
            style={{
              fontFamily: "var(--wf-serif)",
              fontStyle: "italic",
              fontSize: 12,
              color: "var(--gilt)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <WPIcon name="calorie-sigil" size={12} color="var(--gilt)" />
            {equiv}
          </span>
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          marginTop: 12,
          padding: "10px 22px",
          borderTop: "2px solid var(--ink)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: "var(--wf-serif)",
            fontStyle: "italic",
            fontSize: 11,
            color: "var(--mute)",
          }}
        >
          walkpath.app
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--wf-sans)",
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            color: "var(--ink)",
          }}
        >
          ⟡ Printed in Chicago, on foot ⟡
        </span>
      </div>
    </div>
  );
});
