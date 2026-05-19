import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, cleanup } from "@testing-library/react";
import { useState } from "react";
import { AddressAutocomplete } from "./AddressAutocomplete.jsx";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const SAMPLE = [
  { label: "Wrigleyville",    lat: 41.9476, lon: -87.6553, source: "neighborhood" },
  { label: "Wrigley Field",   lat: 41.9484, lon: -87.6553, source: "neighborhood" },
  { label: "Wrigley Building", lat: 41.8891, lon: -87.6244, source: "neighborhood" },
];

function Harness({ onSelect, getSuggestions, initial = "" }) {
  const [v, setV] = useState(initial);
  return (
    <AddressAutocomplete
      value={v}
      onChange={setV}
      onSelect={onSelect}
      getSuggestions={getSuggestions}
      ariaLabel="Origin"
      placeholder="type a place"
    />
  );
}

async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("AddressAutocomplete", () => {
  it("debounces fetches: ≥1 keystroke within the debounce window = 1 call", async () => {
    const getSuggestions = vi.fn(async () => SAMPLE);
    render(<Harness getSuggestions={getSuggestions} />);
    const input = screen.getByLabelText("Origin");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "w" } });
    fireEvent.change(input, { target: { value: "wr" } });
    fireEvent.change(input, { target: { value: "wri" } });

    // Less than the debounce window — no fetch yet.
    await advance(100);
    expect(getSuggestions).not.toHaveBeenCalled();

    // After the window — exactly one fetch with the final value.
    await advance(100);
    expect(getSuggestions).toHaveBeenCalledTimes(1);
    expect(getSuggestions).toHaveBeenCalledWith("wri", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("renders suggestions and selects on click", async () => {
    const getSuggestions = vi.fn(async () => SAMPLE);
    const onSelect = vi.fn();
    render(<Harness getSuggestions={getSuggestions} onSelect={onSelect} />);
    const input = screen.getByLabelText("Origin");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "wri" } });
    await advance(200);

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(3);

    fireEvent.mouseDown(options[1]);
    expect(onSelect).toHaveBeenCalledWith(SAMPLE[1]);
    // After selection the listbox closes.
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    // And the input shows the picked label.
    expect(input.value).toBe("Wrigley Field");
  });

  it("keyboard nav: ArrowDown highlights → Enter commits", async () => {
    const getSuggestions = vi.fn(async () => SAMPLE);
    const onSelect = vi.fn();
    render(<Harness getSuggestions={getSuggestions} onSelect={onSelect} />);
    const input = screen.getByLabelText("Origin");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "wri" } });
    await advance(200);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    await waitFor(() => {
      expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
    });
    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toContain("opt-1");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(SAMPLE[1]);
  });

  it("ArrowUp from -1 wraps to the last item", async () => {
    const getSuggestions = vi.fn(async () => SAMPLE);
    render(<Harness getSuggestions={getSuggestions} />);
    const input = screen.getByLabelText("Origin");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "w" } });
    await advance(200);

    fireEvent.keyDown(input, { key: "ArrowUp" });

    await waitFor(() => {
      const id = input.getAttribute("aria-activedescendant");
      expect(id).toContain(`opt-${SAMPLE.length - 1}`);
    });
  });

  it("Escape closes the listbox without committing", async () => {
    const getSuggestions = vi.fn(async () => SAMPLE);
    const onSelect = vi.fn();
    render(<Harness getSuggestions={getSuggestions} onSelect={onSelect} />);
    const input = screen.getByLabelText("Origin");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "w" } });
    await advance(200);
    expect(screen.queryAllByRole("option").length).toBeGreaterThan(0);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Enter with no active highlight does NOT preventDefault (lets form submit)", async () => {
    const getSuggestions = vi.fn(async () => SAMPLE);
    const onSelect = vi.fn();
    render(<Harness getSuggestions={getSuggestions} onSelect={onSelect} />);
    const input = screen.getByLabelText("Origin");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "w" } });
    await advance(200);

    const evt = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(evt);

    expect(onSelect).not.toHaveBeenCalled();
    expect(evt.defaultPrevented).toBe(false);
  });

  it("empty trimmed query short-circuits the fetch", async () => {
    const getSuggestions = vi.fn(async () => SAMPLE);
    render(<Harness getSuggestions={getSuggestions} />);
    const input = screen.getByLabelText("Origin");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "   " } });
    await advance(300);
    expect(getSuggestions).not.toHaveBeenCalled();
  });

  it("blur closes the listbox", async () => {
    const getSuggestions = vi.fn(async () => SAMPLE);
    render(<Harness getSuggestions={getSuggestions} />);
    const input = screen.getByLabelText("Origin");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "w" } });
    await advance(200);
    expect(screen.queryAllByRole("option").length).toBeGreaterThan(0);

    fireEvent.blur(input);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("aborts in-flight fetches when the query changes", async () => {
    const seen = [];
    // Promise that never resolves on its own — only the abort path can
    // settle it. Keeps the "w" fetch in-flight while we trigger "wr".
    const getSuggestions = vi.fn((q, { signal }) => new Promise((_, reject) => {
      signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        seen.push({ q, aborted: true });
        reject(err);
      });
    }));
    render(<Harness getSuggestions={getSuggestions} />);
    const input = screen.getByLabelText("Origin");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "w" } });
    await advance(200);   // fires fetch for "w" — hangs forever pending abort
    fireEvent.change(input, { target: { value: "wr" } });
    await advance(200);   // fires fetch for "wr"; "w" should have aborted

    expect(seen.some(s => s.q === "w" && s.aborted)).toBe(true);
  });

  it("soft-fails on getSuggestions error (no crash, empty list)", async () => {
    const getSuggestions = vi.fn(async () => { throw new Error("nope"); });
    render(<Harness getSuggestions={getSuggestions} />);
    const input = screen.getByLabelText("Origin");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "w" } });
    await advance(200);

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    // Input remains usable.
    fireEvent.change(input, { target: { value: "wr" } });
    expect(input.value).toBe("wr");
  });

  it("renders the source label as a pill on each row", async () => {
    const getSuggestions = vi.fn(async () => [
      { label: "Clark & Belmont", lat: 41.93, lon: -87.65, source: "intersection" },
    ]);
    render(<Harness getSuggestions={getSuggestions} />);
    const input = screen.getByLabelText("Origin");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "clark" } });
    await advance(200);

    expect(await screen.findByText("cross-street")).toBeInTheDocument();
  });

  describe("portal positioning (mobile sheet parity)", () => {
    function PortalHarness(props) {
      const [v, setV] = useState("");
      return (
        <div data-testid="wrapper">
          <AddressAutocomplete
            value={v}
            onChange={setV}
            ariaLabel="Origin"
            placeholder="type a place"
            {...props}
          />
        </div>
      );
    }

    it("by default portals the listbox to document.body, not the wrapper", async () => {
      const getSuggestions = vi.fn(async () => SAMPLE);
      render(<PortalHarness getSuggestions={getSuggestions} />);
      const input = screen.getByLabelText("Origin");
      const wrapper = screen.getByTestId("wrapper");

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "wri" } });
      await advance(200);

      const listbox = screen.getByRole("listbox");
      // Listbox must NOT be inside the harness wrapper — that's the whole
      // point of portaling out of the (transformed, overflow-clipped) sheet.
      expect(wrapper.contains(listbox)).toBe(false);
      expect(listbox.parentElement).toBe(document.body);
      expect(listbox.className).toContain("address-autocomplete-list--portaled");
    });

    it("opt-out via positioning='absolute' keeps the listbox inside the wrapper", async () => {
      const getSuggestions = vi.fn(async () => SAMPLE);
      render(<PortalHarness getSuggestions={getSuggestions} positioning="absolute" />);
      const input = screen.getByLabelText("Origin");
      const wrapper = screen.getByTestId("wrapper");

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "wri" } });
      await advance(200);

      const listbox = screen.getByRole("listbox");
      expect(wrapper.contains(listbox)).toBe(true);
      expect(listbox.className).not.toContain("address-autocomplete-list--portaled");
    });

    it("sets position:fixed on the portaled listbox", async () => {
      const getSuggestions = vi.fn(async () => SAMPLE);
      render(<PortalHarness getSuggestions={getSuggestions} />);
      const input = screen.getByLabelText("Origin");

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "wri" } });
      await advance(200);

      const listbox = screen.getByRole("listbox");
      expect(listbox.style.position).toBe("fixed");
      // top / left / width / maxHeight all populated from
      // getBoundingClientRect(). JSDOM reports zeros for those, but the
      // properties themselves should be set as inline styles.
      expect(listbox.style.top).not.toBe("");
      expect(listbox.style.width).not.toBe("");
      expect(listbox.style.maxHeight).not.toBe("");
    });

    it("re-anchors on a transform-driven ancestor move (WFSheet drag)", async () => {
      // The WFSheet moves itself via CSS `transform: translateY(...)` and
      // dispatches no scroll/resize event during the drag. The portal
      // tracking relies on capture-phase pointermove for the drag, plus a
      // post-pointerup rAF burst for the snap-transition tail. Drive the
      // pointermove path here — getBoundingClientRect of the input is
      // forced to a fresh top so the re-measurement is observable.
      let inputTop = 100;
      let inputBottom = 140;
      const origGetRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        if (this.tagName === "INPUT") {
          return {
            top: inputTop, bottom: inputBottom, left: 0, right: 200,
            width: 200, height: inputBottom - inputTop, x: 0, y: inputTop,
            toJSON() {},
          };
        }
        return origGetRect.call(this);
      };

      try {
        const getSuggestions = vi.fn(async () => SAMPLE);
        render(<PortalHarness getSuggestions={getSuggestions} />);
        const input = screen.getByLabelText("Origin");

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "wri" } });
        await advance(200);

        const listbox = screen.getByRole("listbox");
        const topBefore = listbox.style.top;
        expect(topBefore).toBe(`${inputBottom + 2}px`);

        // Sheet drags up by 80 px — the input's rect now sits higher on
        // screen. Fire a capture-phase pointermove on the window; the
        // component should rAF-schedule an update and reposition.
        inputTop = 20;
        inputBottom = 60;
        await act(async () => {
          window.dispatchEvent(new Event("pointermove"));
          // Flush the rAF that scheduleUpdate enqueued.
          await new Promise(r => setTimeout(r, 50));
        });

        expect(listbox.style.top).toBe(`${inputBottom + 2}px`);
        expect(listbox.style.top).not.toBe(topBefore);
      } finally {
        Element.prototype.getBoundingClientRect = origGetRect;
      }
    });

    it("recomputes position on visualViewport resize (iOS soft-keyboard)", async () => {
      // JSDOM doesn't ship visualViewport, so stub it for this test only.
      // The component's useLayoutEffect must attach a resize listener on it.
      const listeners = new Set();
      const fakeVV = {
        height: 800,
        offsetTop: 0,
        addEventListener: (evt, fn) => evt === "resize" && listeners.add(fn),
        removeEventListener: (evt, fn) => evt === "resize" && listeners.delete(fn),
      };
      const restore = Object.getOwnPropertyDescriptor(window, "visualViewport");
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        get: () => fakeVV,
      });

      try {
        const getSuggestions = vi.fn(async () => SAMPLE);
        render(<PortalHarness getSuggestions={getSuggestions} />);
        const input = screen.getByLabelText("Origin");

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "wri" } });
        await advance(200);

        expect(listeners.size).toBeGreaterThan(0);

        // Simulate the iOS soft keyboard opening: visualViewport.height
        // shrinks and we re-fire resize. The component should respond
        // (we can't assert measured pixels in JSDOM, but the listener
        // existing + firing without error proves the wiring is intact).
        fakeVV.height = 360;
        listeners.forEach(fn => fn());

        expect(screen.getByRole("listbox")).toBeInTheDocument();
      } finally {
        if (restore) Object.defineProperty(window, "visualViewport", restore);
        else delete window.visualViewport;
      }
    });
  });
});
