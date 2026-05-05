import React, { useEffect, useState } from "react";
import { lbToKg } from "../App.jsx";
import { safeGet, safeSet } from "../lib/storage.js";

const FT_OPTIONS = [4, 5, 6, 7];
const IN_OPTIONS = Array.from({ length: 12 }, (_, i) => i);
const GOAL_PRESETS = [5_000, 7_500, 10_000, 15_000, 20_000];

function kgToLb(kg) {
  return kg * 2.20462;
}

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
  const [unit, setUnit] = useState(() => safeGet("walkpath:weightUnit") || "lb");
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
    safeSet("walkpath:weightUnit", newUnit);
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
      return;
    }
    const n = parseInt(val, 10);
    if (Number.isFinite(n) && n >= 1_000 && n <= 100_000) onChangeGoal(n);
  }
  function handleReset() {
    onChangeHeight(null, null);
    onChangeWeight(null);
    onChangeGoal(null);
    setWeightInput("");
    setGoalInput("");
  }

  const sectionLabelStyle = {
    fontFamily: "var(--wf-sans)",
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "var(--mute)",
    marginBottom: 8,
  };
  const hintStyle = {
    fontFamily: "var(--wf-serif)",
    fontStyle: "italic",
    fontSize: 12,
    color: "var(--mute)",
    marginTop: 6,
    lineHeight: 1.45,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="personalize-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 16, 12, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="paper-grain paper-bright"
        style={{
          width: "min(440px, 100%)",
          color: "var(--ink)",
          border: "1px solid var(--ink)",
          padding: 20,
          fontFamily: "var(--wf-serif)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 14,
          }}
        >
          <h2
            id="personalize-title"
            style={{
              fontFamily: "var(--wf-serif)",
              fontStyle: "italic",
              fontWeight: 600,
              fontSize: 22,
              margin: 0,
            }}
          >
            Your particulars.
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close personalize modal"
            style={{
              background: "transparent",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "var(--ink)",
              padding: 4,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </header>

        {/* Height */}
        <section style={{ marginBottom: 18 }}>
          <div style={sectionLabelStyle}>Height</div>
          <div style={{ display: "flex", gap: 10 }}>
            <select
              value={heightFt ?? ""}
              onChange={handleFt}
              aria-label="Height feet"
            >
              <option value="" disabled>ft</option>
              {FT_OPTIONS.map((f) => (
                <option key={f} value={f}>{f} ft</option>
              ))}
            </select>
            <select
              value={heightIn ?? ""}
              onChange={handleIn}
              aria-label="Height inches"
              disabled={heightFt == null}
            >
              <option value="" disabled>in</option>
              {IN_OPTIONS.map((i) => (
                <option key={i} value={i}>{i} in</option>
              ))}
            </select>
          </div>
          <p style={hintStyle}>
            Uses a biomechanical formula to estimate your personal stride length.
          </p>
        </section>

        {/* Weight */}
        <section style={{ marginBottom: 18 }}>
          <div style={sectionLabelStyle}>Weight</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="number"
              value={weightInput}
              onChange={handleWeightChange}
              min={unit === "lb" ? 66 : 30}
              max={unit === "lb" ? 661 : 300}
              placeholder={unit === "lb" ? "lbs" : "kg"}
              aria-label={`Weight in ${unit === "lb" ? "pounds" : "kilograms"}`}
              style={{
                flex: 1,
                padding: "8px 10px",
                border: "1px solid var(--ink)",
                background: "transparent",
                fontFamily: "var(--wf-mono)",
                fontSize: 14,
                color: "var(--ink)",
              }}
            />
            <button
              type="button"
              onClick={handleUnitToggle}
              style={{
                padding: "8px 12px",
                border: "1px solid var(--ink)",
                background: "transparent",
                fontFamily: "var(--wf-serif)",
                fontStyle: "italic",
                fontSize: 13,
                color: "var(--ink)",
                cursor: "pointer",
              }}
            >
              {unit === "lb" ? "lb → kg" : "kg → lb"}
            </button>
          </div>
          <p style={hintStyle}>
            Used to calculate how many calories you burned.
          </p>
        </section>

        {/* Daily measure */}
        <section style={{ marginBottom: 4 }}>
          <div style={sectionLabelStyle}>Daily measure</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {GOAL_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => { onChangeGoal(p); setGoalInput(String(p)); }}
                aria-pressed={dailyGoal === p}
                style={{
                  padding: "6px 10px",
                  border: `1px solid ${dailyGoal === p ? "var(--ink)" : "var(--mute-fog)"}`,
                  background: dailyGoal === p ? "var(--ink)" : "transparent",
                  color: dailyGoal === p ? "var(--paper)" : "var(--ink)",
                  fontFamily: "var(--wf-mono)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
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
            style={{
              width: "100%",
              padding: "8px 10px",
              border: "1px solid var(--ink)",
              background: "transparent",
              fontFamily: "var(--wf-mono)",
              fontSize: 14,
              color: "var(--ink)",
            }}
          />
          <p style={hintStyle}>
            Controls the % progress bar shown after each route.
          </p>
        </section>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 18,
            paddingTop: 12,
            borderTop: "1px solid var(--mute-fog)",
          }}
        >
          <button
            type="button"
            onClick={handleReset}
            style={{
              background: "transparent",
              border: "none",
              fontFamily: "var(--wf-serif)",
              fontStyle: "italic",
              fontSize: 13,
              color: "var(--mute)",
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "10px 18px",
              background: "var(--ink)",
              color: "var(--paper)",
              border: "1px solid var(--ink)",
              fontFamily: "var(--wf-serif)",
              fontStyle: "italic",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Keep these particulars
          </button>
        </div>
      </div>
    </div>
  );
}
