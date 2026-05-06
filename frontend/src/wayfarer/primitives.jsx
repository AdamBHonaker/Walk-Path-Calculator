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
//   <WFSheet>       — draggable bottom sheet (mobile-first)
//
// All components read from CSS custom properties when possible
// so theme overrides at :root cascade naturally.
// ============================================================

import { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from "react";

// ── Token mirror (for inline-style access) ──────────────────
// Resolves to CSS custom properties so inline styles cascade
// with theme overrides (theme-dusk, theme-vellum, theme-field)
// the same way className-based styles do.
export const WF = {
  paper:       "var(--paper)",
  paperDeep:   "var(--paper-deep)",
  paperBright: "var(--paper-bright)",
  ink:         "var(--ink)",
  inkSoft:     "var(--ink-soft)",
  mute:        "var(--mute)",
  muteFog:     "var(--mute-fog)",
  ember:       "var(--ember)",
  harbor:      "var(--harbor)",
  field:       "var(--field)",
  gilt:        "var(--gilt)",
  mist:        "var(--mist)",
  moss:        "var(--moss)",
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
    minHeight: 44,
  };
  const variants = {
    primary: { background: WF.ink, color: WF.paper },
    ghost:   { background: "transparent", color: WF.ink, border: `1px solid ${WF.ink}` },
    link:    { background: "transparent", color: WF.ink, padding: "4px 0",
               textDecoration: "underline", textUnderlineOffset: 4, border: "none",
               minHeight: 0 },
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

function pickContrast(value) {
  // CSS-var tokens can't be measured at JS time — assume the token's
  // theme-defined contrast pair (paper on ink-family, ink on gilt).
  if (typeof value !== "string" || !value.startsWith("#")) {
    return value === WF.gilt ? WF.ink : WF.paper;
  }
  const h = value.replace("#", "");
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

// ── <WFColophon> — single source of truth for the masthead colophon ──
// "⟡ Printed in Chicago, on foot ⟡". Used by the page footer and by the
// share-card footer so a copy edit in one place can't drift from the other.
export const COLOPHON_TEXT = "⟡ Printed in Chicago, on foot ⟡";
export function WFColophon({ as: Tag = "span", className = "", style = {} }) {
  return <Tag className={className} style={style}>{COLOPHON_TEXT}</Tag>;
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

// ── <WFSheet> — draggable bottom sheet ─────────────────────
// Map-first mobile pattern: a paper-stock panel anchored to
// the bottom of its (positioned) parent, with snap positions
// the user drags between. Honours prefers-reduced-motion and
// the editorial easing curve.
//
// Snap-point strings accept px / % (of parent) / dvh (viewport).
//
// Props:
//   open                — render-or-not
//   snapPoints          — ascending sizes, e.g. ["120px","50dvh","88dvh"]
//   snap, onSnapChange  — controlled mode
//   defaultSnap         — uncontrolled initial index
//   obscuredAreaCallback(px) — fires when the sheet settles, with the
//                              vertical px now hidden behind it. Lets a
//                              parent map pad its viewport so the route
//                              stays visible above the sheet.
//   handleLabel         — accessible label on the drag handle
//
// The body of the sheet is always the largest snap height; smaller
// snaps are achieved by translating the sheet downward. Inner content
// scrolls vertically with overscroll-behavior: contain so iOS doesn't
// rubber-band the page when the sheet is at the top.
export function WFSheet({
  open = true,
  snapPoints = ["120px", "50dvh", "88dvh"],
  snap,
  defaultSnap = 1,
  onSnapChange,
  obscuredAreaCallback,
  handleLabel = "Drag to resize panel",
  children,
  style = {},
  className = "",
  ...rest
}) {
  const containerRef = useRef(null);
  const dragStateRef = useRef(null);   // { startY, startTranslate, pointerId }
  const bodyDragRef = useRef(null);    // body-drag state machine — see onBodyPointerDown
  const reducedMotionRef = useRef(false);

  const [containerHeight, setContainerHeight] = useState(0);
  const [internalSnap, setInternalSnap] = useState(defaultSnap);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTranslate, setDragTranslate] = useState(null);

  const isControlled = snap !== undefined;
  const currentSnap = isControlled ? snap : internalSnap;

  // Memoised so the useCallbacks below — which depend on snapPx and the
  // derived maxHeightPx — actually hit cache across re-renders. Without
  // this every parent render produced a fresh array, recreated every
  // pointer handler, and re-attached the handle/body listeners (~60 Hz
  // mid-drag). Recomputes only when snapPoints identity or containerHeight
  // changes.
  const snapPx = useMemo(
    () => snapPoints.map(p => resolveSnapPx(p, containerHeight)),
    [snapPoints, containerHeight],
  );
  const sheetHeight = snapPx[currentSnap] ?? snapPx[snapPx.length - 1] ?? 0;
  const maxHeightPx = snapPx[snapPx.length - 1] ?? 0;
  const restingTranslate = Math.max(0, maxHeightPx - sheetHeight);
  const translateY = isDragging && dragTranslate != null ? dragTranslate : restingTranslate;

  // Track parent height so % / dvh snap points stay current.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !el.parentElement) return;
    const parent = el.parentElement;
    const update = () => {
      const h = parent.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 0);
      setContainerHeight(h);
    };
    update();
    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(parent);
    }
    if (typeof window !== "undefined") window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      if (typeof window !== "undefined") window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { reducedMotionRef.current = mql.matches; };
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (obscuredAreaCallback) obscuredAreaCallback(sheetHeight);
  }, [sheetHeight, obscuredAreaCallback]);

  const settleToSnap = useCallback((idx) => {
    const clamped = Math.max(0, Math.min(snapPx.length - 1, idx));
    if (!isControlled) setInternalSnap(clamped);
    onSnapChange?.(clamped);
  }, [snapPx.length, isControlled, onSnapChange]);

  const onPointerDown = useCallback((e) => {
    if (e.button != null && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragStateRef.current = {
      startY: e.clientY,
      startTranslate: restingTranslate,
      pointerId: e.pointerId,
      samples: [{ t: pointerNow(), y: e.clientY }],
    };
    setIsDragging(true);
    setDragTranslate(restingTranslate);
  }, [restingTranslate]);

  const onPointerMove = useCallback((e) => {
    const ds = dragStateRef.current;
    if (!ds || ds.pointerId !== e.pointerId) return;
    const delta = e.clientY - ds.startY;
    const next = Math.max(0, Math.min(maxHeightPx, ds.startTranslate + delta));
    setDragTranslate(next);
    ds.samples.push({ t: pointerNow(), y: e.clientY });
    if (ds.samples.length > 6) ds.samples.shift();
  }, [maxHeightPx]);

  const onPointerUp = useCallback((e) => {
    const ds = dragStateRef.current;
    if (!ds || ds.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    const finalTranslate = dragTranslate ?? restingTranslate;
    const targetIdx = decideSnap({
      samples: ds.samples,
      currentSnap,
      finalTranslate,
      snapPx,
      maxHeightPx,
      reducedMotion: reducedMotionRef.current,
    });

    // Haptic confirmation when the snap actually changes — Android Chrome
    // honours navigator.vibrate; iOS Safari ignores it (no-op). Skip when
    // the user has reduced-motion set, since vibration is itself a motion
    // signal, and skip on same-snap releases (release at the start point).
    if (
      targetIdx !== currentSnap
      && !reducedMotionRef.current
      && typeof navigator !== "undefined"
      && typeof navigator.vibrate === "function"
    ) {
      try { navigator.vibrate(10); } catch { /* not supported */ }
    }

    dragStateRef.current = null;
    setIsDragging(false);
    setDragTranslate(null);
    settleToSnap(targetIdx);
  }, [dragTranslate, restingTranslate, snapPx, maxHeightPx, settleToSnap, currentSnap]);

  // Body-drag with scroll handoff. The decision to drag the sheet vs. let
  // the body scroll is made on the first move past the deadzone:
  //   scrollTop === 0 + downward → drag the sheet
  //   anything else              → release the gesture, let the body scroll
  // Once committed, no mid-gesture flips. Once "dragging", we collect the
  // same velocity samples as the handle drag so a flick released from the
  // body still benefits from velocity-aware snap (decideSnap).
  const onBodyPointerDown = useCallback((e) => {
    if (e.button != null && e.button !== 0) return;
    bodyDragRef.current = {
      phase: "pending",
      startY: e.clientY,
      startScrollTop: e.currentTarget.scrollTop || 0,
      startTranslate: restingTranslate,
      pointerId: e.pointerId,
      samples: [{ t: pointerNow(), y: e.clientY }],
    };
  }, [restingTranslate]);

  const onBodyPointerMove = useCallback((e) => {
    const bs = bodyDragRef.current;
    if (!bs || bs.pointerId !== e.pointerId) return;
    const delta = e.clientY - bs.startY;

    if (bs.phase === "pending") {
      // ~8 px deadzone matches Vaul's default — keeps small accidental
      // scroll attempts from being hijacked into a sheet drag.
      if (Math.abs(delta) < BODY_DRAG_DEADZONE_PX) return;
      const goingDown = delta > 0;
      if (goingDown && bs.startScrollTop === 0) {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        bs.phase = "dragging";
        setIsDragging(true);
        setDragTranslate(Math.max(0, Math.min(maxHeightPx, bs.startTranslate + delta)));
        bs.samples.push({ t: pointerNow(), y: e.clientY });
      } else {
        bs.phase = "released";
      }
      return;
    }

    if (bs.phase === "dragging") {
      const next = Math.max(0, Math.min(maxHeightPx, bs.startTranslate + delta));
      setDragTranslate(next);
      bs.samples.push({ t: pointerNow(), y: e.clientY });
      if (bs.samples.length > 6) bs.samples.shift();
    }
    // released: let the browser handle native scroll.
  }, [maxHeightPx]);

  const onBodyPointerUp = useCallback((e) => {
    const bs = bodyDragRef.current;
    if (!bs || bs.pointerId !== e.pointerId) return;

    if (bs.phase === "dragging") {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      const finalTranslate = dragTranslate ?? restingTranslate;
      const targetIdx = decideSnap({
        samples: bs.samples,
        currentSnap,
        finalTranslate,
        snapPx,
        maxHeightPx,
        reducedMotion: reducedMotionRef.current,
      });
      if (
        targetIdx !== currentSnap
        && !reducedMotionRef.current
        && typeof navigator !== "undefined"
        && typeof navigator.vibrate === "function"
      ) {
        try { navigator.vibrate(10); } catch { /* not supported */ }
      }
      bodyDragRef.current = null;
      setIsDragging(false);
      setDragTranslate(null);
      settleToSnap(targetIdx);
      return;
    }
    bodyDragRef.current = null;
  }, [dragTranslate, restingTranslate, snapPx, maxHeightPx, settleToSnap, currentSnap]);

  if (!open) return null;

  const transitionDuration = reducedMotionRef.current ? "0ms" : "var(--dur-considered)";
  const transition = isDragging ? "none" : `transform ${transitionDuration} var(--ease-walk)`;

  return (
    <div
      ref={containerRef}
      className={`wf-sheet paper-grain ${className}`.trim()}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: maxHeightPx || "auto",
        transform: `translateY(${translateY}px)`,
        transition,
        borderTop: `1px solid ${WF.ink}`,
        boxShadow: "0 -8px 24px rgba(23,19,16,0.18), 0 -1px 0 rgba(23,19,16,0.05)",
        display: "flex",
        flexDirection: "column",
        zIndex: 20,
        ...style,
      }}
      role="dialog"
      aria-modal="false"
      {...rest}
    >
      <button
        type="button"
        className="wf-sheet-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={handleLabel}
        style={{
          appearance: "none",
          background: "transparent",
          border: "none",
          padding: "10px 0 6px",
          width: "100%",
          cursor: "grab",
          touchAction: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <span aria-hidden="true" style={{
          display: "block",
          width: 44, height: 4,
          background: WF.muteFog,
          borderRadius: 2,
        }} />
        <span aria-hidden="true" style={{
          display: "block",
          height: 1, width: "100%",
          background: WF.ink,
          opacity: 0.85,
        }} />
      </button>
      <div
        className="wf-sheet-body wf-scroll"
        onPointerDown={onBodyPointerDown}
        onPointerMove={onBodyPointerMove}
        onPointerUp={onBodyPointerUp}
        onPointerCancel={onBodyPointerUp}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          padding: "0 16px max(16px, var(--safe-bottom))",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Tunable: a release-velocity above this magnitude (px/ms) is treated as a
// flick — the sheet promotes/demotes one snap in the direction of motion
// rather than settling to the nearest snap. ~0.8 px/ms matches Vaul and
// feels right against Apple/Google Maps on real devices; tweak after
// hands-on testing if it reads sticky or twitchy.
export const SHEET_VELOCITY_THRESHOLD = 0.8;
export const SHEET_VELOCITY_WINDOW_MS = 80;

// Tunable: distance the pointer must travel from its starting Y inside the
// sheet body before we commit to either "drag the sheet" or "let the body
// scroll natively". 8 px matches Vaul's default and keeps a small jitter
// (e.g. user tapping a button) from accidentally hijacking the gesture.
export const BODY_DRAG_DEADZONE_PX = 8;

function pointerNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

// Pick the snap to settle on after a drag release. Velocity above
// SHEET_VELOCITY_THRESHOLD over the trailing SHEET_VELOCITY_WINDOW_MS
// promotes/demotes one snap in the direction of motion; otherwise we
// fall back to the nearest snap. Reduced-motion users always get nearest
// (the velocity feel is itself a motion signal). Exported for tests.
export function decideSnap({ samples, currentSnap, finalTranslate, snapPx, maxHeightPx, reducedMotion }) {
  let nearestIdx = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < snapPx.length; i++) {
    const rest = Math.max(0, maxHeightPx - snapPx[i]);
    const dist = Math.abs(rest - finalTranslate);
    if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }
  }
  if (reducedMotion || !samples || samples.length < 2) return nearestIdx;

  const last = samples[samples.length - 1];
  let firstIdx = samples.length - 1;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (last.t - samples[i].t <= SHEET_VELOCITY_WINDOW_MS) firstIdx = i;
    else break;
  }
  const first = samples[firstIdx];
  const dt = last.t - first.t;
  if (dt <= 0) return nearestIdx;
  const velocity = (last.y - first.y) / dt; // px/ms; negative = upward
  if (Math.abs(velocity) <= SHEET_VELOCITY_THRESHOLD) return nearestIdx;
  // Pointer y decreases as the user drags up, which exposes a *larger*
  // snap (snapPoints is ascending), so an upward fling raises the index.
  const sign = velocity < 0 ? +1 : -1;
  return Math.max(0, Math.min(snapPx.length - 1, currentSnap + sign));
}

// Resolve a snap-point string ("120px" / "50%" / "88dvh") to pixels
// against a parent height. Exported for tests.
export function resolveSnapPx(value, containerHeight) {
  if (typeof value === "number") return value;
  const m = String(value).trim().match(/^(-?\d*\.?\d+)(px|%|dvh|vh)?$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2] || "px";
  if (unit === "px") return n;
  if (unit === "%")  return Math.round((containerHeight || 0) * n / 100);
  if (unit === "dvh" || unit === "vh") {
    const vh = typeof window !== "undefined" ? window.innerHeight : (containerHeight || 0);
    return Math.round(vh * n / 100);
  }
  return n;
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

