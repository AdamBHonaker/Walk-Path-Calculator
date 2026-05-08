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

export function WFCheck({ checked = false, onChange, label, style = {} }) {
  return (
    <label style={{
      display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer",
      minHeight: 44, padding: "4px 0",
      ...style,
    }}>
      <span style={{
        width: 16, height: 16, border: `1.5px solid ${WF.ink}`,
        background: checked ? WF.ink : "transparent",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        {checked && (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1.5 5 L4 7.5 L8.5 2" fill="none" stroke={WF.paper} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </span>
      {label && (
        <span style={{ fontFamily: WF.serif, fontSize: 14, color: WF.ink }}>{label}</span>
      )}
      <input type="checkbox" checked={checked} onChange={onChange}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
    </label>
  );
}

export function WFRadio({ checked = false, onChange, label, name, style = {} }) {
  return (
    <label style={{
      display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer",
      minHeight: 44, padding: "4px 0",
      ...style,
    }}>
      <span style={{
        width: 16, height: 16, border: `1.5px solid ${WF.ink}`, borderRadius: "50%",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        {checked && (
          <span style={{
            width: 8, height: 8, background: WF.ink, borderRadius: "50%",
          }} />
        )}
      </span>
      {label && (
        <span style={{ fontFamily: WF.serif, fontSize: 14, color: WF.ink }}>{label}</span>
      )}
      <input type="radio" checked={checked} onChange={onChange} name={name}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
    </label>
  );
}
