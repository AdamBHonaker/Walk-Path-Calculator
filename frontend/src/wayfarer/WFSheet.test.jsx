import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WFSheet, resolveSnapPx, decideSnap, SHEET_VELOCITY_THRESHOLD, BODY_DRAG_DEADZONE_PX } from "./primitives.jsx";

describe("resolveSnapPx", () => {
  it("returns numeric input unchanged", () => {
    expect(resolveSnapPx(120, 800)).toBe(120);
  });

  it("parses px values", () => {
    expect(resolveSnapPx("140px", 800)).toBe(140);
  });

  it("parses bare-number values as px", () => {
    expect(resolveSnapPx("88", 800)).toBe(88);
  });

  it("resolves % against the container", () => {
    expect(resolveSnapPx("50%", 800)).toBe(400);
    expect(resolveSnapPx("12.5%", 800)).toBe(100);
  });

  it("resolves dvh / vh against window.innerHeight", () => {
    const original = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    expect(resolveSnapPx("88dvh", 800)).toBe(792);
    expect(resolveSnapPx("50vh", 800)).toBe(450);
    Object.defineProperty(window, "innerHeight", { value: original, configurable: true });
  });

  it("returns 0 for nonsense input rather than NaN", () => {
    expect(resolveSnapPx("not-a-snap", 800)).toBe(0);
  });
});

describe("decideSnap (velocity-aware)", () => {
  // Three snaps sized 100/300/500 px tall against a 500 px container.
  // Resting translate per snap: [400, 200, 0].
  const snapPx = [100, 300, 500];
  const maxHeightPx = 500;

  it("falls back to nearest when velocity is below threshold", () => {
    // Slow drag from y=400 to y=200 over 800 ms → 0.25 px/ms upward.
    const samples = [
      { t: 0, y: 400 },
      { t: 800, y: 200 },
    ];
    const idx = decideSnap({
      samples, currentSnap: 0, finalTranslate: 200, snapPx, maxHeightPx,
      reducedMotion: false,
    });
    // finalTranslate=200 is exactly at snap 1's resting translate.
    expect(idx).toBe(1);
  });

  it("promotes one snap on a fast upward fling, even when nearest would be lower", () => {
    // Fast drag from y=400 to y=200 over 80 ms → 2.5 px/ms upward.
    // Released at translate=350 (closer to snap 0's rest=400 than snap 1's 200).
    const samples = [
      { t: 0, y: 400 },
      { t: 80, y: 200 },
    ];
    const idx = decideSnap({
      samples, currentSnap: 0, finalTranslate: 350, snapPx, maxHeightPx,
      reducedMotion: false,
    });
    expect(idx).toBe(1);
  });

  it("settles higher than a slow drag with the same release y", () => {
    // Release at translate=320 — closer to snap 0 (rest=400) than snap 1
    // (rest=200), so nearest=0. The fast trajectory's velocity (~1.0 px/ms
    // upward) crosses the threshold and promotes to snap 1; the slow
    // trajectory (~0.1 px/ms) stays at the nearest.
    const slow = decideSnap({
      samples: [{ t: 0, y: 400 }, { t: 800, y: 320 }],
      currentSnap: 0, finalTranslate: 320,
      snapPx, maxHeightPx, reducedMotion: false,
    });
    const fast = decideSnap({
      samples: [{ t: 0, y: 400 }, { t: 80, y: 320 }],
      currentSnap: 0, finalTranslate: 320,
      snapPx, maxHeightPx, reducedMotion: false,
    });
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBe(0);
    expect(fast).toBe(1);
  });

  it("demotes one snap on a fast downward fling", () => {
    // Fast drag from y=100 to y=300 over 80 ms → 2.5 px/ms downward.
    const samples = [{ t: 0, y: 100 }, { t: 80, y: 300 }];
    const idx = decideSnap({
      samples, currentSnap: 2, finalTranslate: 50, snapPx, maxHeightPx,
      reducedMotion: false,
    });
    expect(idx).toBe(1);
  });

  it("clamps at the top snap on an upward fling already at the top", () => {
    const samples = [{ t: 0, y: 200 }, { t: 80, y: 0 }];
    const idx = decideSnap({
      samples, currentSnap: 2, finalTranslate: 0, snapPx, maxHeightPx,
      reducedMotion: false,
    });
    expect(idx).toBe(2);
  });

  it("uses nearest under prefers-reduced-motion regardless of velocity", () => {
    const samples = [{ t: 0, y: 400 }, { t: 80, y: 200 }];
    const idx = decideSnap({
      samples, currentSnap: 0, finalTranslate: 350, snapPx, maxHeightPx,
      reducedMotion: true,
    });
    expect(idx).toBe(0);
  });

  it("ignores stale samples outside the trailing window", () => {
    // Long slow tail then a sharp last-frame jump — but that final jump
    // is the only sample inside the 80 ms window, so dt=0 and the helper
    // bails to nearest.
    const samples = [
      { t: 0, y: 400 },
      { t: 500, y: 350 },
      { t: 600, y: 300 }, // 600 ms before the last sample → outside window
    ];
    const idx = decideSnap({
      samples, currentSnap: 0, finalTranslate: 300, snapPx, maxHeightPx,
      reducedMotion: false,
    });
    // finalTranslate=300 is closer to snap 0 (rest=400, dist 100) than
    // snap 1 (rest=200, dist 100) — tie goes to first-wins (snap 0).
    expect(idx).toBe(0);
  });

  it("threshold constant is the documented value", () => {
    expect(SHEET_VELOCITY_THRESHOLD).toBeCloseTo(0.8);
  });
});

describe("WFSheet", () => {
  it("renders children inside the sheet body", () => {
    render(
      <WFSheet snapPoints={["120px", "300px"]}>
        <p>Sheet contents</p>
      </WFSheet>,
    );
    expect(screen.getByText("Sheet contents")).toBeInTheDocument();
  });

  it("renders a draggable handle button with an accessible label", () => {
    render(
      <WFSheet snapPoints={["120px", "300px"]} handleLabel="Drag the sheet">
        <p>body</p>
      </WFSheet>,
    );
    const handle = screen.getByRole("button", { name: "Drag the sheet" });
    expect(handle).toBeInTheDocument();
    expect(handle.className).toContain("wf-sheet-handle");
  });

  it("returns null when open=false", () => {
    const { container } = render(
      <WFSheet open={false} snapPoints={["120px", "300px"]}>
        <p>hidden</p>
      </WFSheet>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("respects controlled snap prop without invoking onSnapChange on render", () => {
    let calls = 0;
    render(
      <WFSheet
        snapPoints={["120px", "300px", "500px"]}
        snap={2}
        onSnapChange={() => { calls += 1; }}
      >
        <p>controlled</p>
      </WFSheet>,
    );
    // onSnapChange only fires from a settle (drag release), not from props.
    expect(calls).toBe(0);
    expect(screen.getByText("controlled")).toBeInTheDocument();
  });
});

// Body-drag with scroll handoff. JSDOM has no real layout, so these tests
// stub `scrollTop` and exercise the gesture state machine via fireEvent.
// The observable side-effect: when the gesture commits to "drag the sheet",
// onSnapChange fires on pointerup with the new snap index. When it commits
// to "let the body scroll", onSnapChange does not fire.
describe("WFSheet — body-drag scroll handoff", () => {
  const SNAP_POINTS = ["120px", "300px", "500px"];

  function renderSheet(props = {}) {
    const calls = [];
    const utils = render(
      <WFSheet
        snapPoints={SNAP_POINTS}
        defaultSnap={2}
        onSnapChange={(idx) => calls.push(idx)}
        {...props}
      >
        <p>body content</p>
      </WFSheet>,
    );
    const body = utils.container.querySelector(".wf-sheet-body");
    return { ...utils, body, calls };
  }

  it("intercepts a downward drag-from-body when scrollTop is 0 and demotes one snap", () => {
    const { body, calls } = renderSheet();
    Object.defineProperty(body, "scrollTop", { value: 0, configurable: true });

    fireEvent.pointerDown(body, { clientY: 100, pointerId: 1, button: 0 });
    // First move past the 8 px deadzone → commits to dragging the sheet.
    fireEvent.pointerMove(body, { clientY: 100 + BODY_DRAG_DEADZONE_PX + 4, pointerId: 1 });
    // A clear downward drag of ~250 px (well past snap 1's 200 px rest).
    fireEvent.pointerMove(body, { clientY: 350, pointerId: 1 });
    fireEvent.pointerUp(body, { clientY: 350, pointerId: 1 });

    // Started at snap 2 (full); a downward drag releases at a lower snap.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1]).toBeLessThan(2);
  });

  it("releases the gesture (no snap change) when the body has been scrolled", () => {
    const { body, calls } = renderSheet();
    // Mid-scroll: scrollTop > 0 means the user is scrolling the body content,
    // not trying to drag the sheet — even on a downward gesture.
    Object.defineProperty(body, "scrollTop", { value: 80, configurable: true });

    fireEvent.pointerDown(body, { clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(body, { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(body, { clientY: 200, pointerId: 1 });

    expect(calls).toEqual([]);
  });

  it("releases the gesture on an upward drag (criterion #4: body scrolls instead)", () => {
    const { body, calls } = renderSheet();
    Object.defineProperty(body, "scrollTop", { value: 0, configurable: true });

    fireEvent.pointerDown(body, { clientY: 300, pointerId: 1, button: 0 });
    // Upward gesture past the deadzone — should release to native scroll.
    fireEvent.pointerMove(body, { clientY: 300 - BODY_DRAG_DEADZONE_PX - 4, pointerId: 1 });
    fireEvent.pointerMove(body, { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(body, { clientY: 100, pointerId: 1 });

    expect(calls).toEqual([]);
  });

  it("does not commit inside the deadzone — small jitter is ignored", () => {
    const { body, calls } = renderSheet();
    Object.defineProperty(body, "scrollTop", { value: 0, configurable: true });

    fireEvent.pointerDown(body, { clientY: 100, pointerId: 1, button: 0 });
    // Tiny downward jitter under the deadzone — no commit, no settle.
    fireEvent.pointerMove(body, { clientY: 100 + (BODY_DRAG_DEADZONE_PX - 2), pointerId: 1 });
    fireEvent.pointerUp(body, { clientY: 100 + (BODY_DRAG_DEADZONE_PX - 2), pointerId: 1 });

    expect(calls).toEqual([]);
  });
});
