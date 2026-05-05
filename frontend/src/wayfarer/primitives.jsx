// ============================================================
// WAYFARER — Primitives
// ------------------------------------------------------------
// Editorial UI building blocks. Drop into any React + Babel
// HTML file alongside tokens.css.
//
// Provides:
//   WF              — JS access to the design tokens
//   <WFCaps>        — small uppercase signpost label
//   <WFLamp>        — live-state flicker dot
//   <WFRule>        — hairline / thick / double / dashed rules
//   <WFDispatch>    — the double-frame advisory panel
//   <WFButton>      — primary (ink) / ghost (outline) / link
//   <WFPill>        — coloured chip (any hex/token)
//   <WFCard>        — paper-stock card with optional grain
//   <WFMasthead>    — date + volume editorial header
//   <WFFooter>      — printed-in-… footer
//   <WFDropNumber>  — large italic figure with caption
//   <WFFromMark>    — silcrow square (origin / "from")
//   <WFToMark>      — surveyor's target (destination / "to")
//   <WFCompassMark> — compass with flicker ring (you / "here")
//   <WFGrain>       — paper-grain background wrapper
//
// All components read from CSS custom properties when possible
// so theme overrides at :root cascade naturally.
// ============================================================

// ── Token mirror (for inline-style access) ──────────────────
// Mirrors :root in tokens.css. If you override a CSS var in
// your :root, also override the matching key here when setting
// inline styles.
export const WF = {
  paper: "#f2ece0",
  paperDeep: "#e9e1d1",
  paperBright: "#fffbef",
  ink: "#171310",
  inkSoft: "#4a3f32",
  mute: "#7a6a54",
  muteFog: "#a89a82",
  ember: "#9c2a1a",
  harbor: "#1a4d6f",
  field: "#1f6d3b",
  gilt: "#b8862a",
  mist: "#cedde2",
  moss: "#cbd4c5",
  serif: '"Fraunces","GT Sectra","Playfair Display", Georgia, serif',
  sans:  '"Inter", -apple-system, system-ui, sans-serif',
  mono:  '"JetBrains Mono","IBM Plex Mono", ui-monospace, monospace',
};

// ── <WFGrain> — paper texture wrapper ───────────────────────
export function WFGrain({ bright = false, style = {}, children, ...rest }) {
  const cls = bright ? "paper-grain paper-bright" : "paper-grain";
  return (
    <div className={cls} style={style} {...rest}>{children}</div>
  );
}

// ── <WFCaps> — uppercase signpost label ────────────────────
export function WFCaps({ children, tone = "mute", style = {} }) {
  const map = {
    mute: WF.mute, ink: WF.ink, ember: WF.ember,
    harbor: WF.harbor, field: WF.field, gilt: WF.gilt,
  };
  return (
    <div style={{
      fontFamily: WF.sans, fontSize: 10, fontWeight: 700,
      letterSpacing: 2, textTransform: "uppercase",
      color: map[tone] || WF.mute, ...style,
    }}>{children}</div>
  );
}

// ── <WFLamp> — flicker dot for live state ──────────────────
export function WFLamp({ label = "Live", color = WF.ember }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span className="wf-lamp" style={{ background: color, boxShadow: `0 0 6px ${color}, 0 0 0 1.5px ${WF.paper}` }} />
      {label && (
        <span style={{
          fontFamily: WF.sans, fontSize: 9, fontWeight: 700, letterSpacing: 2,
          textTransform: "uppercase", color: WF.mute,
        }}>{label}</span>
      )}
    </span>
  );
}

// ── <WFRule> — editorial divider ───────────────────────────
export function WFRule({ kind = "hair", style = {} }) {
  const map = {
    hair:   { height: 1, background: WF.ink },
    thick:  { height: 2, background: WF.ink },
    double: { height: 5, borderTop: `1px solid ${WF.ink}`, borderBottom: `1px solid ${WF.ink}` },
    dash:   { borderTop: `1px dashed ${WF.muteFog}`, height: 0 },
  };
  return <div style={{ ...map[kind], ...style }} />;
}

// ── <WFDispatch> — double-frame advisory ───────────────────
export function WFDispatch({ kicker = "Advisory", tone = "ember", children, style = {} }) {
  const toneMap = { ember: WF.ember, harbor: WF.harbor, field: WF.field, ink: WF.ink, gilt: WF.gilt };
  return (
    <div className="wf-dispatch" style={style}>
      {kicker && (
        <div style={{
          fontFamily: WF.sans, fontSize: 9, fontWeight: 800, letterSpacing: 1,
          color: toneMap[tone] || WF.ember, marginBottom: 4, textTransform: "uppercase",
        }}>{kicker}</div>
      )}
      <div style={{
        fontFamily: WF.serif, fontStyle: "italic", fontSize: 13, lineHeight: 1.45, color: WF.ink,
      }}>{children}</div>
    </div>
  );
}

// ── <WFButton> — primary / ghost / link ────────────────────
export function WFButton({ variant = "primary", italic = true, children, style = {}, ...rest }) {
  const base = {
    fontFamily: WF.serif, fontSize: 14, fontWeight: 600,
    fontStyle: italic ? "italic" : "normal",
    padding: "12px 16px", cursor: "pointer", border: "none",
    letterSpacing: 0.2,
  };
  const variants = {
    primary: { background: WF.ink, color: WF.paper },
    ghost:   { background: "transparent", color: WF.ink, border: `1px solid ${WF.ink}` },
    link:    { background: "transparent", color: WF.ink, padding: "4px 0",
               textDecoration: "underline", textUnderlineOffset: 4, border: "none" },
  };
  return (
    <button style={{ ...base, ...variants[variant], ...style }} {...rest}>{children}</button>
  );
}

// ── <WFPill> — coloured chip ───────────────────────────────
// Usage: <WFPill color="#9c2a1a" code="WF" /> or
//        <WFPill color="ember" code="!" size="lg" />
export function WFPill({ color = WF.ink, code = "", label = "", size = "md", style = {} }) {
  const tokenMap = { ember: WF.ember, harbor: WF.harbor, field: WF.field, gilt: WF.gilt, ink: WF.ink };
  const bg = tokenMap[color] || color;
  // Pick text color: dark backgrounds get paper, very light get ink.
  const textColor = pickContrast(bg);
  const dims = size === "sm"
    ? { h: 20, minW: 22, fs: 9, pad: "0 6px" }
    : size === "lg"
    ? { h: 34, minW: 34, fs: 13, pad: "0 10px" }
    : { h: 26, minW: 26, fs: 11, pad: "0 8px" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: dims.minW, height: dims.h, padding: dims.pad,
      background: bg, color: textColor, fontFamily: WF.sans,
      fontWeight: 900, fontSize: dims.fs, letterSpacing: 1,
      borderRadius: 2, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)",
      ...style,
    }}>{code || label}</span>
  );
}

function pickContrast(hex) {
  // Quick perceptual check; cream paper for dark, ink for very light.
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  return lum > 0.7 ? WF.ink : WF.paper;
}

// ── <WFCard> — paper-stock card ────────────────────────────
export function WFCard({ bright = false, padding = 16, children, style = {} }) {
  return (
    <div className={bright ? "paper-grain paper-bright" : "paper-grain"} style={{
      border: `1px solid ${WF.ink}`, padding, ...style,
    }}>{children}</div>
  );
}

// ── <WFMasthead> — date · volume · issue ───────────────────
export function WFMasthead({ left = "Monday, April 20", right = "Vol. IV · No. 112", style = {} }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      fontFamily: WF.sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase",
      color: WF.mute, fontWeight: 700, ...style,
    }}>
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

// ── <WFFooter> — printed-in footer ─────────────────────────
export function WFFooter({ children = "⟡ Printed for the daily wayfarer ⟡", style = {} }) {
  return (
    <div style={{
      padding: "10px 22px 14px", fontFamily: WF.sans,
      fontSize: 9, color: WF.mute, letterSpacing: 1.8, textTransform: "uppercase",
      fontWeight: 700, textAlign: "center", borderTop: `2px solid ${WF.ink}`, ...style,
    }}>{children}</div>
  );
}

// ── <WFDropNumber> — italic display figure with caption ────
export function WFDropNumber({ value, unit = "", caption = "", size = 72, style = {} }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 16, ...style }}>
      <div style={{
        fontFamily: WF.serif, fontSize: size, fontWeight: 700,
        lineHeight: 0.82, letterSpacing: -size * 0.045, fontStyle: "italic", color: WF.ink,
      }}>{value}</div>
      <div style={{ paddingTop: 6 }}>
        {unit && <WFCaps>{unit}</WFCaps>}
        {caption && (
          <div style={{
            fontFamily: WF.serif, fontStyle: "italic", fontSize: 13,
            color: WF.inkSoft, marginTop: 6, lineHeight: 1.45,
          }}>{caption}</div>
        )}
      </div>
    </div>
  );
}

// ── Map marks ──────────────────────────────────────────────
// Three orthogonal silhouettes: square (from), ring (to), compass (you).
// Each takes a `size` (px on each side). Backgrounds default to paper
// so they read against any map fill.

export function WFFromMark({ size = 60, glyph = "§", style = {} }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="-30 -30 60 60" style={style}>
      <rect x="-11" y="-11" width="22" height="22" fill={WF.paper} />
      <rect x="-11" y="-11" width="22" height="22" fill="none" stroke={WF.ink} strokeWidth="2" />
      <rect x="-8" y="-8" width="16" height="16" fill="none" stroke={WF.ink} strokeWidth="0.75" />
      <text x="0" y="5.5" fontSize="16" fontWeight="700" fill={WF.ink}
        fontFamily={WF.serif} fontStyle="italic" textAnchor="middle">{glyph}</text>
    </svg>
  );
}

export function WFToMark({ size = 60, style = {} }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="-30 -30 60 60" style={style}>
      <circle r="13" fill={WF.paper} />
      <circle r="12" fill="none" stroke={WF.ink} strokeWidth="2" />
      <circle r="9" fill="none" stroke={WF.ink} strokeWidth="0.75" />
      <line x1="-12" y1="0" x2="-5.5" y2="0" stroke={WF.ink} strokeWidth="1.25" />
      <line x1="5.5" y1="0" x2="12" y2="0" stroke={WF.ink} strokeWidth="1.25" />
      <line x1="0" y1="-12" x2="0" y2="-5.5" stroke={WF.ink} strokeWidth="1.25" />
      <line x1="0" y1="5.5" x2="0" y2="12" stroke={WF.ink} strokeWidth="1.25" />
      <circle r="3" fill={WF.ink} />
    </svg>
  );
}

export function WFCompassMark({ size = 60, heading = 35, accent = WF.ember, style = {} }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="-30 -30 60 60" style={style}>
      <circle r="14" fill="none" stroke={accent} strokeWidth="1" opacity="0.45">
        <animate attributeName="r" values="14;18;14" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.45;0;0.45" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <circle r="11" fill={WF.paper} stroke={accent} strokeWidth="1.5" />
      <line x1="0" y1="-11" x2="0" y2="-8" stroke={accent} strokeWidth="1" />
      <line x1="0" y1="11" x2="0" y2="8" stroke={accent} strokeWidth="1" />
      <line x1="-11" y1="0" x2="-8" y2="0" stroke={accent} strokeWidth="1" />
      <line x1="11" y1="0" x2="8" y2="0" stroke={accent} strokeWidth="1" />
      <g transform={`rotate(${heading})`}>
        <path d="M 0,-8 L 3,2 L 0,0 L -3,2 Z" fill={accent} />
        <path d="M 0,8 L 2,2 L 0,0 L -2,2 Z" fill={WF.ink} opacity="0.4" />
      </g>
      <circle r="1.4" fill={WF.ink} />
    </svg>
  );
}

