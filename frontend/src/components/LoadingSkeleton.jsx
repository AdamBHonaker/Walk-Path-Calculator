import React, { useEffect, useRef } from "react";

// Bars are darker than the parent card on purpose — they need to read as
// "something will arrive here" placeholders, not as decorative texture.
// Base = mute (#7a6a54). Shimmer peak = paper-bright (#fffbef).
function SkelBar({ w, h }) {
  return (
    <div
      className="wf-anim-shimmer"
      style={{
        width: w,
        height: h,
        background:
          "linear-gradient(90deg, var(--mute) 0%, var(--paper-bright) 50%, var(--mute) 100%)",
        backgroundSize: "200% 100%",
        border: "1px solid var(--ink-soft)",
      }}
    />
  );
}

export function LoadingSkeleton() {
  const ref = useRef(null);

  // The form panel has its own scroll container; if the form is taller than
  // the viewport, the skeleton mounts below the scroll fold and the user
  // never sees it. Scroll itself into view on mount so it's always visible
  // while the request is in flight. `block: "nearest"` is a no-op when the
  // skeleton is already on screen.
  //
  // jsdom (and very old browsers) don't implement scrollIntoView — guard so
  // tests don't blow up.
  useEffect(() => {
    if (typeof ref.current?.scrollIntoView === "function") {
      ref.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, []);

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      aria-label="Plotting your route"
      className="wf-anim-page"
      style={{
        border: "2px solid var(--ink)",
        background: "var(--paper-bright)",
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--wf-sans)",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "var(--ember)",
        }}
      >
        <span
          className="wf-anim-flicker"
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--ember)",
            boxShadow: "0 0 0 2px var(--paper-bright), 0 0 6px var(--ember)",
          }}
        />
        Plotting your route…
      </span>
      <SkelBar w="60%" h={64} />
      <SkelBar w="100%" h={14} />
      <SkelBar w="80%" h={14} />
      <SkelBar w="90%" h={14} />
    </div>
  );
}
