import { useEffect, useState } from "react";
import { lbToKg, kgToLb } from "../lib/units.js";
import { loadWeightUnit, saveWeightUnit } from "../lib/personaPrefs.js";
import { loadTheme, applyTheme } from "../lib/theme.js";

const FT_OPTIONS = [4, 5, 6, 7];
const IN_OPTIONS = Array.from({ length: 12 }, (_, i) => i);
const GOAL_PRESETS = [5_000, 7_500, 10_000, 15_000, 20_000];

const THEME_OPTIONS = [
  { value: "cream", label: "Cream", detail: "Bone-white paper" },
  { value: "dusk",  label: "Dusk",  detail: "Lamplit deep ink" },
];

export function PersonalizeModal({
  open,
  onClose,
  heightFt,
  heightIn,
  weightKg,
  dailyGoal,
  onChangeHeight,
  onChangeWeight,
  onChangeGoal,
}) {
  const [unit, setUnit] = useState(loadWeightUnit);
  const [theme, setTheme] = useState(() => loadTheme());

  function handleThemeChange(next) {
    setTheme(next);
    applyTheme(next);
  }
  const [weightInput, setWeightInput] = useState(() =>
    weightKg != null
      ? String(Math.round(unit === "lb" ? kgToLb(weightKg) : weightKg))
      : ""
  );
  // Mirror the weightInput pattern: track raw keystrokes locally so
  // intermediate / out-of-range values (e.g. "" while editing, "1" on the way
  // to "15000") don't snap back. Only commit to onChangeGoal when valid.
  const [goalInput, setGoalInput] = useState(() =>
    dailyGoal != null ? String(dailyGoal) : ""
  );
  // Inline message when an entered goal is silently clamped or rejected,
  // so the user isn't left wondering why their number didn't stick.
  const [goalNote, setGoalNote] = useState("");

  // Reseed the local input mirrors when the modal opens or when the parent
  // values change. Without this, parent-driven updates (deep-link import,
  // external reset) would be hidden behind stale local state because the
  // component only returns null while closed — it doesn't unmount.
  useEffect(() => {
    if (!open) return;
    setWeightInput(
      weightKg != null
        ? String(Math.round(unit === "lb" ? kgToLb(weightKg) : weightKg))
        : ""
    );
    setGoalInput(dailyGoal != null ? String(dailyGoal) : "");
    setGoalNote("");
  }, [open, weightKg, dailyGoal, unit]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleFt(e) {
    onChangeHeight(e.target.value, heightIn);
  }
  function handleIn(e) {
    onChangeHeight(heightFt, e.target.value);
  }
  function handleUnitToggle() {
    const newUnit = unit === "lb" ? "kg" : "lb";
    const num = parseFloat(weightInput);
    if (!Number.isNaN(num) && num > 0) {
      const converted =
        unit === "lb" ? Math.round(lbToKg(num)) : Math.round(kgToLb(num));
      setWeightInput(String(converted));
    }
    setUnit(newUnit);
    saveWeightUnit(newUnit);
  }
  function handleWeightChange(e) {
    const val = e.target.value;
    setWeightInput(val);
    const num = parseFloat(val);
    if (!Number.isNaN(num) && num > 0) {
      onChangeWeight(unit === "lb" ? lbToKg(num) : num);
    } else {
      onChangeWeight(null);
    }
  }
  function handleGoalNumber(e) {
    const val = e.target.value;
    setGoalInput(val);
    if (val === "") {
      onChangeGoal(null);
      setGoalNote("");
      return;
    }
    const n = parseInt(val, 10);
    if (!Number.isFinite(n)) {
      setGoalNote("");
      return;
    }
    // Always commit the user's intent — clamp into [1k, 100k] and surface
    // a hint when we did so, instead of silently dropping the input.
    const clamped = Math.max(1_000, Math.min(100_000, n));
    onChangeGoal(clamped);
    if (clamped !== n) {
      setGoalNote(`Adjusted to ${clamped.toLocaleString()} — goals stay between 1,000 and 100,000.`);
    } else {
      setGoalNote("");
    }
  }
  function handleReset() {
    onChangeHeight(null, null);
    onChangeWeight(null);
    onChangeGoal(null);
    setWeightInput("");
    setGoalInput("");
    setGoalNote("");
  }

  const heightInchesDisabled = heightFt == null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="personalize-title"
      onClick={onClose}
      className="wf-modal-overlay"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="wf-modal-card paper-grain paper-bright"
      >
        <header className="personalize-header">
          <h2 id="personalize-title" className="personalize-title">
            Your particulars.
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close personalize modal"
            className="personalize-close"
          >
            ×
          </button>
        </header>

        {/* Height */}
        <section className="personalize-section">
          <div className="personalize-section-label">Height</div>
          <div className="personalize-row">
            <span className="personalize-select-wrap">
              <select
                value={heightFt ?? ""}
                onChange={handleFt}
                aria-label="Height feet"
                className="personalize-select"
              >
                <option value="" disabled>ft</option>
                {FT_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f} ft</option>
                ))}
              </select>
              <span aria-hidden="true" className="personalize-select-chevron">▾</span>
            </span>
            <span className="personalize-select-wrap">
              <select
                value={heightIn ?? ""}
                onChange={handleIn}
                aria-label="Height inches"
                disabled={heightInchesDisabled}
                className="personalize-select"
              >
                <option value="" disabled>in</option>
                {IN_OPTIONS.map((i) => (
                  <option key={i} value={i}>{i} in</option>
                ))}
              </select>
              <span aria-hidden="true" className="personalize-select-chevron">▾</span>
            </span>
          </div>
          <p className="personalize-section-hint">
            Uses a biomechanical formula to estimate your personal stride length.
          </p>
        </section>

        {/* Weight */}
        <section className="personalize-section">
          <div className="personalize-section-label">Weight</div>
          <div className="personalize-row personalize-row--centered">
            <input
              type="number"
              value={weightInput}
              onChange={handleWeightChange}
              min={unit === "lb" ? 66 : 30}
              max={unit === "lb" ? 661 : 300}
              placeholder={unit === "lb" ? "lbs" : "kg"}
              aria-label={`Weight in ${unit === "lb" ? "pounds" : "kilograms"}`}
              className="personalize-input"
            />
            <button
              type="button"
              onClick={handleUnitToggle}
              className="personalize-unit-toggle"
            >
              {unit === "lb" ? "lb → kg" : "kg → lb"}
            </button>
          </div>
          <p className="personalize-section-hint">
            Used to calculate how many calories you burned.
          </p>
        </section>

        {/* Daily measure */}
        <section className="personalize-section-final">
          <div className="personalize-section-label">Daily measure</div>
          <div className="personalize-presets">
            {GOAL_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => { onChangeGoal(p); setGoalInput(String(p)); setGoalNote(""); }}
                aria-pressed={dailyGoal === p}
                className={`personalize-preset${dailyGoal === p ? " personalize-preset--active" : ""}`}
              >
                {p.toLocaleString()}
              </button>
            ))}
          </div>
          <input
            type="number"
            placeholder="Custom (1,000–100,000)"
            value={goalInput}
            min={1_000}
            max={100_000}
            step={500}
            onChange={handleGoalNumber}
            aria-label="Custom daily step goal"
            className="personalize-input personalize-input--full"
          />
          {goalNote && (
            <p
              role="status"
              aria-live="polite"
              className="personalize-section-hint personalize-section-hint--clamped"
            >
              {goalNote}
            </p>
          )}
          <p className="personalize-section-hint">
            Controls the % progress bar shown after each route.
          </p>
        </section>

        {/* Display */}
        <section className="personalize-section-final">
          <div className="personalize-section-label">Display</div>
          <div role="radiogroup" aria-label="Page theme" className="personalize-theme-row">
            {THEME_OPTIONS.map(({ value, label, detail }) => {
              const checked = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => handleThemeChange(value)}
                  className={`personalize-theme-btn${checked ? " personalize-theme-btn--active" : ""}`}
                >
                  <span>{label}</span>
                  <span className="personalize-theme-btn-detail">{detail}</span>
                </button>
              );
            })}
          </div>
          <p className="personalize-section-hint">
            Switch the paper stock between cream daylight and lamplit dusk.
          </p>
        </section>

        <div className="personalize-footer">
          <button type="button" onClick={handleReset} className="personalize-reset">
            Reset
          </button>
          <button type="button" onClick={onClose} className="personalize-keep">
            Keep these particulars
          </button>
        </div>
      </div>
    </div>
  );
}
