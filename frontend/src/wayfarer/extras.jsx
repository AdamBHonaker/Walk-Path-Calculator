// ============================================================
// WAYFARER — Extra primitives
// ------------------------------------------------------------
// Beyond the core: tags, tabs, lists, tooltips, modals, avatars,
// progress. All in editorial Wayfarer voice.
// ============================================================

import React from "react";
import { WF, WFCaps } from "./primitives.jsx";

// ── <WFTag> — small paper chip ─────────────────────────────
export function WFTag({ children, onRemove, tone = "ink", style = {} }) {
  const map = { ink: WF.ink, ember: WF.ember, harbor: WF.harbor, field: WF.field, gilt: WF.gilt };
  const c = map[tone] || WF.ink;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 8px", border: `1px solid ${c}`, color: c,
      fontFamily: WF.serif, fontStyle: "italic", fontSize: 12,
      background: WF.paperBright, ...style,
    }}>
      {children}
      {onRemove && (
        <button onClick={onRemove} style={{
          background: "transparent", border: "none", color: c,
          padding: 0, cursor: "pointer", fontFamily: WF.serif,
          fontSize: 14, lineHeight: 1, marginLeft: 2,
        }}>×</button>
      )}
    </span>
  );
}

// ── <WFTabs> — editorial tab strip ─────────────────────────
export function WFTabs({ tabs = [], active, onChange, position = "top" }) {
  const isTop = position === "top";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: `repeat(${tabs.length}, 1fr)`,
      borderTop: !isTop ? `2px solid ${WF.ink}` : "none",
      borderBottom: isTop ? `2px solid ${WF.ink}` : "none",
      background: WF.paper,
    }}>
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button key={t.id} onClick={() => onChange?.(t.id)} style={{
            background: "transparent", border: "none",
            padding: "10px 6px", textAlign: "center", cursor: "pointer",
            fontFamily: WF.serif, fontSize: 13,
            fontStyle: isActive ? "normal" : "italic",
            fontWeight: isActive ? 700 : 400,
            color: isActive ? WF.ink : WF.mute,
            borderBottom: isTop && isActive ? `2px solid ${WF.ink}` : "2px solid transparent",
            borderTop: !isTop && isActive ? `2px solid ${WF.ink}` : "2px solid transparent",
            marginBottom: isTop ? -2 : 0, marginTop: !isTop ? -2 : 0,
          }}>{t.label}</button>
        );
      })}
    </div>
  );
}

// ── <WFList> — numbered (§) / dotted / timeline ────────────
export function WFList({ items = [], variant = "numbered", style = {} }) {
  return (
    <div style={style}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        if (variant === "timeline") {
          return (
            <div key={i} style={{ display: "flex", gap: 12, paddingBottom: last ? 0 : 16 }}>
              <div style={{ width: 14, position: "relative", flexShrink: 0 }}>
                <div style={{
                  width: 1, background: WF.ink, position: "absolute",
                  top: 6, bottom: last ? "50%" : -16, left: 7,
                }} />
                <div style={{
                  width: 8, height: 8, border: `1.5px solid ${WF.ink}`,
                  background: it.done ? WF.ink : WF.paper,
                  position: "absolute", top: 4, left: 3,
                }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: WF.serif, fontSize: 15, fontWeight: 600 }}>{it.title}</div>
                {it.body && <div style={{
                  fontFamily: WF.serif, fontStyle: "italic", fontSize: 12,
                  color: WF.mute, marginTop: 3, lineHeight: 1.45,
                }}>{it.body}</div>}
              </div>
              {it.meta && <div style={{ fontFamily: WF.mono, fontSize: 11, color: WF.mute }}>{it.meta}</div>}
            </div>
          );
        }
        return (
          <div key={i} style={{
            padding: "10px 0",
            borderBottom: last ? "none" : `1px ${variant === "dotted" ? "dashed" : "solid"} ${WF.muteFog}`,
            display: "flex", alignItems: "baseline", gap: 10,
          }}>
            {variant === "numbered" && (
              <span style={{
                fontFamily: WF.serif, fontStyle: "italic", color: WF.mute,
                fontSize: 11, width: 20,
              }}>§{i + 1}</span>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: WF.serif, fontSize: 15, fontWeight: 600 }}>{it.title}</div>
              {it.body && <div style={{
                fontFamily: WF.serif, fontStyle: "italic", fontSize: 12,
                color: WF.mute, marginTop: 2,
              }}>{it.body}</div>}
            </div>
            {it.meta && <div style={{ fontFamily: WF.mono, fontSize: 11, color: WF.inkSoft }}>{it.meta}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── <WFTooltip> — dispatch-frame popover ───────────────────
export function WFTooltip({ children, content, style = {} }) {
  const [open, setOpen] = React.useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block", ...style }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && (
        <span style={{
          position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
          marginBottom: 8, padding: "6px 10px", background: WF.paperBright,
          border: `2px double ${WF.ink}`, fontFamily: WF.serif, fontStyle: "italic",
          fontSize: 11, color: WF.ink, whiteSpace: "nowrap", zIndex: 10,
        }}>{content}</span>
      )}
    </span>
  );
}

// ── <WFModal> — paper sheet over vellum scrim ──────────────
export function WFModal({ open, onClose, title, children, style = {} }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(23,19,16,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} className="paper-grain paper-bright" style={{
        maxWidth: 480, width: "100%", border: `1px solid ${WF.ink}`,
        boxShadow: "0 12px 40px rgba(23,19,16,0.25)", padding: 24, ...style,
      }}>
        {title && (
          <>
            <WFCaps>Dispatch</WFCaps>
            <h2 style={{
              fontFamily: WF.serif, fontSize: 22, fontWeight: 700,
              letterSpacing: -0.5, margin: "4px 0 8px",
            }}><span style={{ fontStyle: "italic", fontWeight: 400 }}>On </span>{title}</h2>
            <div style={{ height: 2, background: WF.ink, marginBottom: 12 }} />
          </>
        )}
        {children}
      </div>
    </div>
  );
}

// ── <WFAvatar> — initials in italic serif square frame ─────
export function WFAvatar({ initials = "—", size = 36, tone = "ink" }) {
  const map = { ink: WF.ink, ember: WF.ember, harbor: WF.harbor, field: WF.field, gilt: WF.gilt };
  const c = map[tone] || WF.ink;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size, height: size, border: `1.5px solid ${c}`, color: c,
      background: WF.paperBright, fontFamily: WF.serif, fontStyle: "italic",
      fontWeight: 700, fontSize: size * 0.45,
    }}>{initials}</span>
  );
}

// ── <WFProgress> — hand-ruled progress ─────────────────────
export function WFProgress({ value = 0, max = 100, label, style = {} }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={style}>
      {label && <WFCaps style={{ marginBottom: 6 }}>{label}</WFCaps>}
      <div style={{ position: "relative", height: 8 }}>
        <div style={{
          position: "absolute", left: 0, right: 0, top: 3,
          borderTop: `1px dashed ${WF.muteFog}`,
        }} />
        <div style={{
          position: "absolute", left: 0, top: 0,
          width: `${pct}%`, height: 8, background: WF.ink,
          transition: "width 320ms cubic-bezier(.22,.61,.36,1)",
        }} />
        <div style={{
          position: "absolute", left: `calc(${pct}% - 1px)`, top: -3, height: 14,
          width: 2, background: WF.ember,
        }} />
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontFamily: WF.mono, fontSize: 10, color: WF.mute, marginTop: 4,
      }}>
        <span>{value}</span><span>/ {max}</span>
      </div>
    </div>
  );
}

