import { useMemo } from "react";
import { summarize } from "../compareEstimates.js";
import { calorieEquivalent } from "../calorieEquiv.js";

export function CompareDispatch({ miles, walkMinutes, calories }) {
  // 12×10 nested search inside calorieEquivalent — cache so re-renders
  // driven by sibling state (sheet drag, theme toggle) don't repeat it.
  // Must run before the early-return below to satisfy rules-of-hooks.
  const equiv = useMemo(
    () => (calories > 0 ? calorieEquivalent(calories) : null),
    [calories],
  );

  if (!miles || miles <= 0.1) return null;

  const { driveMin, transitMin, costUsd, co2Kg } = summarize(miles, walkMinutes);
  const driveDelta = Math.round(walkMinutes - driveMin);
  const transitDelta = Math.round(walkMinutes - transitMin);

  return (
    <section className="compare-dispatch" aria-label="Comparison vs other transportation">
      <div className="compare-dispatch-eyebrow">Worth Walking?</div>

      <ul className="compare-dispatch-list">
        <li className="compare-dispatch-label">vs. <em>driving</em></li>
        <li className="compare-dispatch-value">
          {driveDelta > 0 ? `${driveDelta} min slower` : driveDelta < 0 ? `${Math.abs(driveDelta)} min faster` : "about as fast"}
        </li>
        <li className="compare-dispatch-label">vs. <em>transit</em></li>
        <li className="compare-dispatch-value">
          {transitDelta > 0 ? `${transitDelta} min slower` : transitDelta < 0 ? `${Math.abs(transitDelta)} min faster` : "about as fast"}
        </li>
      </ul>

      <div className="compare-dispatch-divider" />

      <div className="compare-dispatch-impact">
        <span>${costUsd.toFixed(0)} saved</span>
        <span className="compare-dispatch-impact-sep">·</span>
        <span>{co2Kg.toFixed(2)} kg CO₂ kept</span>
      </div>

      {equiv && (
        <>
          <div className="compare-dispatch-divider compare-dispatch-equiv-divider" />
          <p className="compare-dispatch-equiv">{equiv}</p>
        </>
      )}
    </section>
  );
}
