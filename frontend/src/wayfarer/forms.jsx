// ============================================================
// WAYFARER — Forms
// ------------------------------------------------------------
// Editorial form controls. Underlined inputs, italic labels,
// no rounded boxes. Designed to feel like writing on paper.
//
// Provides:
//   <WFInput>     — single-line, with italic from-label
//   <WFTextarea>  — multi-line, ruled-paper feel
//   <WFSelect>    — native select, restyled to match
//   <WFCheck>     — square, ink-filled tick
//   <WFRadio>     — concentric ring (echoes the To-mark)
//   <WFField>     — wrapper: caps label + control + caption
// ============================================================

import { WF, WFCaps } from "./primitives.jsx";

export function WFField({ label, caption, error, children, style = {} }) {
  return (
    <label style={{ display: "block", ...style }}>
      {label && <WFCaps style={{ marginBottom: 6 }}>{label}</WFCaps>}
      {children}
      {(caption || error) && (
        <div style={{
          fontFamily: WF.serif, fontStyle: "italic", fontSize: 11,
          color: error ? WF.ember : WF.mute, marginTop: 4, lineHeight: 1.45,
        }}>{error || caption}</div>
      )}
    </label>
  );
}

export function WFInput({ leadLabel, value, defaultValue, placeholder = "", onChange, style = {}, ...rest }) {
  const isControlled = value !== undefined;
  const valueProps = isControlled
    ? { value, onChange: onChange || (() => {}) }
    : { defaultValue: defaultValue ?? "", onChange };
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 10,
      borderBottom: `1px solid ${WF.ink}`, padding: "8px 0",
      minHeight: 44,
      ...style,
    }}>
      {leadLabel && (
        <span style={{
          fontFamily: WF.serif, fontStyle: "italic", fontSize: 14,
          color: WF.mute, minWidth: 36,
        }}>{leadLabel}</span>
      )}
      <input
        {...valueProps} placeholder={placeholder}
        style={{
          flex: 1, border: "none", outline: "none", background: "transparent",
          fontFamily: WF.serif, fontSize: 18, fontWeight: 500, color: WF.ink,
          padding: 0,
        }}
        {...rest}
      />
    </div>
  );
}

export function WFTextarea({ value, defaultValue, placeholder = "", onChange, rows = 4, style = {}, ...rest }) {
  const isControlled = value !== undefined;
  const valueProps = isControlled
    ? { value, onChange: onChange || (() => {}) }
    : { defaultValue: defaultValue ?? "", onChange };
  return (
    <textarea
      {...valueProps} placeholder={placeholder} rows={rows}
      style={{
        width: "100%", boxSizing: "border-box",
        border: "none", outline: "none",
        background: `repeating-linear-gradient(transparent, transparent 23px, ${WF.muteFog} 23px, ${WF.muteFog} 24px)`,
        backgroundAttachment: "local",
        fontFamily: WF.serif, fontSize: 16, lineHeight: "24px", color: WF.ink,
        padding: "0 0 0 0", resize: "vertical", ...style,
      }}
      {...rest}
    />
  );
}

export function WFSelect({ value, onChange, children, style = {}, ...rest }) {
  return (
    <div style={{
      display: "flex", alignItems: "center",
      borderBottom: `1px solid ${WF.ink}`, padding: "6px 0", position: "relative",
      ...style,
    }}>
      <select value={value} onChange={onChange}
        style={{
          flex: 1, appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
          border: "none", outline: "none", background: "transparent",
          fontFamily: WF.serif, fontSize: 16, color: WF.ink,
          padding: "4px 24px 4px 0", cursor: "pointer",
        }}
        {...rest}>{children}</select>
      <span style={{
        position: "absolute", right: 4, fontFamily: WF.serif,
        fontStyle: "italic", color: WF.mute, fontSize: 14, pointerEvents: "none",
      }}>▾</span>
    </div>
  );
}

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

