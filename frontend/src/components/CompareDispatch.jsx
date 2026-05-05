import React from "react";
import { summarize } from "../compareEstimates.js";
import { calorieEquivalent } from "../calorieEquiv.js";

const italicStyle = {
  fontFamily: "var(--wf-serif)",
  fontStyle: "italic",
  fontSize: 13,
  color: "var(--ink-soft)",
};
const monoStyle = {
  fontFamily: "var(--wf-mono)",
  fontSize: 12,
  color: "var(--ink)",
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
};

export function CompareDispatch({ miles, walkMinutes, calories }) {
  if (!miles || miles <= 0.1) return null;

  const { driveMin, transitMin, costUsd, co2Kg } = summarize(miles, walkMinutes);
  const driveDelta = Math.round(walkMinutes - driveMin);
  const transitDelta = Math.round(walkMinutes - transitMin);
  const equiv = calories > 0 ? calorieEquivalent(calories) : null;

  return (
    <section
      aria-label="Comparison vs other transportation"
      style={{
        border: "1px solid var(--ink)",
        borderTop: "3px double var(--ink)",
        padding: "12px 16px 14px",
        background: "var(--paper-bright)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--wf-sans)",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "var(--ember)",
          marginBottom: 8,
        }}
      >
        Worth Walking?
      </div>

      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          rowGap: 4,
          columnGap: 12,
        }}
      >
        <li style={italicStyle}>
          vs. <em>driving</em>
        </li>
        <li style={monoStyle}>
          {driveDelta > 0 ? `${driveDelta} min slower` : driveDelta < 0 ? `${Math.abs(driveDelta)} min faster` : "about as fast"}
        </li>
        <li style={italicStyle}>
          vs. <em>transit</em>
        </li>
        <li style={monoStyle}>
          {transitDelta > 0 ? `${transitDelta} min slower` : transitDelta < 0 ? `${Math.abs(transitDelta)} min faster` : "about as fast"}
        </li>
      </ul>

      <div style={{ height: 1, background: "var(--mute-fog)", margin: "10px 0" }} />

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 12,
          fontFamily: "var(--wf-mono)",
          fontSize: 12,
          color: "var(--ember)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>${costUsd.toFixed(0)} saved</span>
        <span style={{ color: "var(--mute-fog)" }}>·</span>
        <span>{co2Kg.toFixed(2)} kg CO₂ kept</span>
      </div>

      {equiv && (
        <>
          <div style={{ height: 1, background: "var(--mute-fog)", margin: "10px 0 8px" }} />
          <p
            style={{
              margin: 0,
              fontFamily: "var(--wf-serif)",
              fontStyle: "italic",
              fontSize: 12,
              color: "var(--mute)",
              textAlign: "center",
              lineHeight: 1.45,
            }}
          >
            {equiv}
          </p>
        </>
      )}
    </section>
  );
}
