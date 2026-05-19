// ============================================================
// WAYFARER — Forms (production subset)
// ------------------------------------------------------------
// Editorial form controls actually reached by the app.
//
// Provides:
//   <WFCheck>     — square, ink-filled tick
//   <WFRadio>     — concentric ring (echoes the To-mark)
//
// WFField / WFInput / WFTextarea / WFSelect lived in this file
// previously but were only ever consumed by the wayfarer specimen
// plates, which were retired in May 2026. Restore from git history
// if a future surface needs them.
// ============================================================

import { WF } from "./primitives.jsx";

export function WFCheck({ checked = false, onChange, label, style = {}, disabled = false }) {
  // Caller-supplied `style` is still spread for layout overrides — the
  // base appearance lives in `.wf-check` (see wayfarer/components.css).
  const labelClass = `wf-check${disabled ? " wf-check--disabled" : ""}`;
  const boxClass = `wf-check__box${checked ? " wf-check__box--filled" : ""}`;
  return (
    <label className={labelClass} style={style}>
      <span className={boxClass}>
        {checked && (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1.5 5 L4 7.5 L8.5 2" fill="none" stroke={WF.paper} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </span>
      {label && <span className="wf-check__label">{label}</span>}
      <input
        type="checkbox"
        className="wf-check__input"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
    </label>
  );
}

export function WFRadio({ checked = false, onChange, label, name, style = {} }) {
  return (
    <label className="wf-radio" style={style}>
      <span className="wf-radio__ring">
        {checked && <span className="wf-radio__dot" />}
      </span>
      {label && <span className="wf-radio__label">{label}</span>}
      <input
        type="radio"
        className="wf-radio__input"
        checked={checked}
        onChange={onChange}
        name={name}
      />
    </label>
  );
}
