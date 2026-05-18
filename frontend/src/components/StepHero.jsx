import { calorieEquivalent } from "../calorieEquiv.js";
import { formatSteps } from "../lib/directionFormat.js";
import { safePaceLabel } from "../lib/routeFormat.js";
import { WPIcon } from "../wayfarer/walkpath-icons.jsx";

export function StepHero({ result, dailyGoal, onShare, metricMode = "steps" }) {
  const {
    total_steps, total_miles, total_minutes, calories_approx,
    daily_goal_pct, step_length_inches, personalized,
    personalized_calories,
    elevation_gain_ft,
  } = result;

  const pct = Number.isFinite(daily_goal_pct) ? daily_goal_pct : 0;
  const barWidth = Math.min(pct, 100);
  const effectiveGoal = (dailyGoal ?? 10_000).toLocaleString();
  const calorieEquiv = calorieEquivalent(calories_approx);
  const isDistance = metricMode === "distance";

  return (
    <div className="step-hero">
      {isDistance ? (
        <>
          <div className="step-hero-count">{total_miles}</div>
          <div className="step-hero-label">miles</div>
        </>
      ) : (
        <>
          <div className="step-hero-count">{formatSteps(total_steps)}</div>
          <div className="step-hero-label">steps</div>
        </>
      )}

      <div className="step-hero-stats">
        {isDistance ? (
          <span className="stat-chip">
            <span className="stat-chip-icon"><WPIcon name="hourglass" size={12} /></span>
            {total_minutes} min
          </span>
        ) : (
          <>
            <span className="stat-chip">
              <span className="stat-chip-icon"><WPIcon name="ruler" size={12} /></span>
              {total_miles} mi
            </span>
            <span className="stat-chip">
              <span className="stat-chip-icon"><WPIcon name="hourglass" size={12} /></span>
              {total_minutes} min
            </span>
            <span className="stat-chip">
              <span className="stat-chip-icon"><WPIcon name="calorie-sigil" size={12} /></span>
              ~{calories_approx} cal
              {personalized_calories && (
                <span className="stat-chip-badge">personalized</span>
              )}
            </span>
          </>
        )}
        {elevation_gain_ft > 10 && (
          <span className="stat-chip">
            <span className="stat-chip-icon"><WPIcon name="elevation" size={12} /></span>
            {Math.round(elevation_gain_ft)} ft
          </span>
        )}
        {!isDistance && safePaceLabel(result.pace) && (
          <span className="stat-chip">
            <span className="stat-chip-icon"><WPIcon name="stride" size={12} /></span>
            {safePaceLabel(result.pace)}
          </span>
        )}
      </div>

      {!isDistance && calorieEquiv && (
        <p className="calorie-equiv">{calorieEquiv}</p>
      )}

      {!isDistance && (
        <div className="goal-bar-wrap">
          <div className="goal-bar-label">Daily measure · {effectiveGoal} steps</div>
          <div className="goal-bar-track">
            <div className="goal-bar-fill" style={{ width: `${barWidth}%` }} />
          </div>
          <div className="goal-bar-caption">{pct}% of daily measure</div>
        </div>
      )}

      {!isDistance && (
        <p className="step-note">
          {personalized
            ? `Measured to your ${step_length_inches}″ stride.`
            : `Using an average ${step_length_inches}″ stride. Add your particulars for a more honest count.`}
        </p>
      )}

      {onShare && (
        <button type="button" className="share-card-btn" onClick={onShare}>
          <span className="share-card-btn-inner">
            <WPIcon name="printer" size={14} />
            Print dispatch
          </span>
        </button>
      )}
    </div>
  );
}
