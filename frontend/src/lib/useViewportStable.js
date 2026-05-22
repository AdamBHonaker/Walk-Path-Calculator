import { useEffect } from "react";

// Keep an iOS standalone-PWA layout stable against the software keyboard.
//
// The mobile root (`.mobile-shell`) is `position: fixed; inset: 0`. When a
// text input inside it is focused, iOS Safari scrolls the *layout* viewport
// to reveal the input — even though the shell is fixed — and frequently
// leaves it scrolled after the keyboard dismisses, shifting the whole shell
// out of alignment (masthead under the notch, blank strip at the bottom).
// `window.innerHeight` / `100dvh` don't change for the keyboard, so a media
// query or `resize` listener can't see it; `window.visualViewport` is the
// only signal iOS emits.
//
// While `active`, on every visualViewport resize/scroll this hook:
//   1. snaps the layout viewport back to 0,0 — the document has nothing
//      legitimately scrollable (html/body/#root are height:100%, `.app` and
//      `.mobile-shell` are overflow:hidden), so any non-zero scroll is the
//      iOS keyboard shift and resetting it is safe. `scrollTo` moves only the
//      layout viewport, so a pinch-zoom pan (visualViewport.offset*) is
//      untouched.
//   2. publishes the visible height as the `--app-vh` custom property, so the
//      shell can size to what's actually on screen while the keyboard is up.
//
// No-ops where `visualViewport` is unavailable (older browsers, jsdom) — the
// layout falls back to the static `100dvh`.
export function useViewportStable(active) {
  useEffect(() => {
    if (!active) return;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const root = document.documentElement;
    const sync = () => {
      root.style.setProperty("--app-vh", `${vv.height}px`);
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      root.style.removeProperty("--app-vh");
    };
  }, [active]);
}
