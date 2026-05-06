import { useEffect, useRef } from "react";

// Bars are darker than the parent card on purpose — they need to read as
// "something will arrive here" placeholders, not as decorative texture.
// Base = mute (#7a6a54). Shimmer peak = paper-bright (#fffbef).
function SkelBar({ w, h }) {
  return (
    <div
      className="loading-skel-bar wf-anim-shimmer"
      style={{ width: w, height: h }}
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
      className="loading-skel wf-anim-page"
    >
      <span className="loading-skel-eyebrow">
        <span className="loading-skel-lamp wf-anim-flicker" aria-hidden="true" />
        Plotting your route…
      </span>
      <SkelBar w="60%" h={64} />
      <SkelBar w="100%" h={14} />
      <SkelBar w="80%" h={14} />
      <SkelBar w="90%" h={14} />
    </div>
  );
}
