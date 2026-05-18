// ============================================================
// WAYFARER — Primitives (production subset)
// ------------------------------------------------------------
// Editorial UI building blocks actually reached by the app.
//
// Provides:
//   WF              — JS access to the design tokens
//   <WFFromMark>    — silcrow square (origin / "from")
//   <WFToMark>      — surveyor's target (destination / "to")
//   <WFColophon>    — single source of truth for the masthead colophon
//   COLOPHON_TEXT   — the colophon string itself
//   <WFSheet>       — draggable bottom sheet (mobile-first)
//   decideSnap, resolveSnapPx,
//   SHEET_VELOCITY_THRESHOLD, BODY_DRAG_DEADZONE_PX
//                    — exported for sheet-snap unit tests
//
// Earlier versions of this file shipped a much larger primitive
// catalogue (WFCaps, WFLamp, WFRule, WFDispatch, WFButton, WFPill,
// WFCard, WFMasthead, WFFooter, WFGrain, WFDropNumber,
// WFCompassMark) plus the extras.jsx / extra-plates.jsx specimen
// files. Phase 1 of the design-system migration finished without
// any production caller picking them up, so they were trimmed in
// May 2026 to keep this file aligned with what's actually used.
// Restore from git history if a future surface needs one.
// ============================================================

import { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from "react";

// ── Token mirror (for inline-style access) ──────────────────
// Resolves to CSS custom properties so inline styles cascade
// with theme overrides (theme-dusk) the same way className-based
// styles do. forms.jsx and the map endpoint marks read from here.
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
  moss100:     "var(--moss-100)",
  moss300:     "var(--moss-300)",
  moss500:     "var(--moss-500)",
  serif: '"Fraunces","GT Sectra","Playfair Display", Georgia, serif',
  sans:  '"Inter", -apple-system, system-ui, sans-serif',
  mono:  '"JetBrains Mono","IBM Plex Mono", ui-monospace, monospace',
};

// ── <WFColophon> — single source of truth for the masthead colophon ──
// "⟡ Printed in Chicago, on foot ⟡". Used by the page footer and by the
// share-card footer so a copy edit in one place can't drift from the other.
export const COLOPHON_TEXT = "⟡ Printed in Chicago, on foot ⟡";
export function WFColophon({ as: Tag = "span", className = "", style = {} }) {
  return <Tag className={className} style={style}>{COLOPHON_TEXT}</Tag>;
}

// ── <WFAttribution> — small subline crediting upstream data sources ──
// Renders the editorial-style "Data: …" subline that sits under the
// colophon (page footer) and under the share-card colophon. Default copy
// covers the project's current upstream data (CDP / OSM / LocationIQ);
// callers can override `sources` for surface-specific lists.
export const DEFAULT_ATTRIBUTION_SOURCES = [
  "City of Chicago Open Data Portal",
  "OpenStreetMap",
  "LocationIQ",
];
export function WFAttribution({
  as: Tag = "span",
  className = "",
  style = {},
  prefix = "Data:",
  sources = DEFAULT_ATTRIBUTION_SOURCES,
}) {
  return (
    <Tag className={className} style={style}>
      {prefix} {sources.join(" · ")}
    </Tag>
  );
}

// ── Map marks ──────────────────────────────────────────────
// Two orthogonal silhouettes: square (from), ring (to). Each takes
// a `size` (px on each side). Backgrounds default to paper so they
// read against any map fill.

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
