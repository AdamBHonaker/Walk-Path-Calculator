// Typeahead address combobox shared across the route form (App.jsx) and
// the Neighborhood Explorer's community-area picker (ExploreForm.jsx).
//
// Data source is pluggable: pass a `getSuggestions(query, { signal })` async
// function and the component handles debounce, in-flight cancellation,
// keyboard navigation, and pointer + touch selection. The route form points
// at `fetchAutocomplete` (POST /autocomplete); the explorer points at a
// local filter over the 77 community-area names. The component itself
// makes no assumptions about coords or source labels.
//
// Suggestion shape (minimum):
//   { label: string, source?: string, lat?: number, lon?: number }
// Anything else on the object is passed through to `onSelect` untouched.
//
// Implements the WAI-ARIA combobox pattern (1.1 inline variant): the input
// owns the listbox via `aria-controls`, `aria-expanded` reflects open state,
// and the highlighted option is announced via `aria-activedescendant` so a
// screen reader follows the arrow-key cursor without focus moving off the
// input.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DEFAULT_DEBOUNCE_MS = 150;
const MIN_QUERY_CHARS = 1;
// Breathing room between the listbox and the viewport edge / soft keyboard. 16
// keeps the bottom row legible above iOS Safari's keyboard accessory bar and
// gives the WFSheet's bottom safe-area inset a little air.
const VIEWPORT_MARGIN_PX = 16;
const DEFAULT_MAX_HEIGHT_PX = 320;

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  getSuggestions,
  placeholder = "",
  ariaLabel,
  className = "",
  inputClassName = "",
  disabled = false,
  autoFocus = false,
  autoComplete = "off",
  enterKeyHint,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  // "portal" (default) renders the listbox into document.body with
  // position: fixed so it can escape `overflow: hidden` ancestors and the
  // WFSheet's `transform: translateY(...)` clipping context. "absolute"
  // keeps the listbox inside the wrapper for callers that need it inline
  // (test fixtures, or any host that already provides a non-clipping shell).
  positioning = "portal",
  // Allow callers (mainly tests) to pin the listbox id so they can read
  // `aria-activedescendant` deterministically.
  listboxId: listboxIdProp,
  inputRef: inputRefProp,
}) {
  const reactId = useId();
  const listboxId = listboxIdProp || `address-ac-${reactId}`;
  const inputRefLocal = useRef(null);
  const inputRef = inputRefProp || inputRefLocal;
  const wrapperRef = useRef(null);
  const abortRef = useRef(null);
  const debounceRef = useRef(null);
  const lastQueryRef = useRef("");

  // `suggestions` holds the dropdown rows; `open` gates whether the
  // dropdown is rendered; `active` is the highlighted index for keyboard
  // navigation (-1 = nothing highlighted, Enter is a no-op).
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);

  // Reset highlight whenever the dropdown closes or the suggestion list
  // changes — keeps Enter predictable.
  useEffect(() => {
    if (!open) setActive(-1);
  }, [open]);

  const abortInFlight = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const fetchFor = useCallback(async (q) => {
    if (!getSuggestions) return;
    const trimmed = (q || "").trim();
    if (trimmed.length < MIN_QUERY_CHARS) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    abortInFlight();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    lastQueryRef.current = trimmed;
    setLoading(true);
    try {
      const result = await getSuggestions(trimmed, { signal: ctrl.signal });
      // Drop out-of-order responses: only commit if the query that fired
      // this fetch is still the most recent one. Without this guard, slow
      // network + fast typing renders an obviously-stale list.
      if (lastQueryRef.current !== trimmed) return;
      setSuggestions(Array.isArray(result) ? result : []);
    } catch (err) {
      if (err?.name === "AbortError") return;
      // Soft-fail: an autocomplete error must never break typing. Surface
      // an empty list instead so the input remains usable.
      setSuggestions([]);
    } finally {
      // Only the current (non-superseded) fetch may flip loading off.
      // Otherwise an aborted fetch's settle would briefly clear the
      // "Searching…" SR announcement while a fresher fetch is still in
      // flight, producing a `true → false → true` flicker for screen
      // readers and any consumer hooked on `loading`.
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, [getSuggestions, abortInFlight]);

  // Debounced effect: every value change schedules a fetch; a fresh
  // keystroke clears the prior timer so we only call once per quiet window.
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!open) return;
    const t = setTimeout(() => fetchFor(value), debounceMs);
    debounceRef.current = t;
    return () => clearTimeout(t);
  }, [value, open, debounceMs, fetchFor]);

  // Cleanup on unmount: cancel any pending timer + in-flight fetch.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortInFlight();
  }, [abortInFlight]);

  function commitSelection(suggestion) {
    if (!suggestion) return;
    onChange?.(suggestion.label);
    onSelect?.(suggestion);
    setOpen(false);
    setActive(-1);
    abortInFlight();
  }

  function handleChange(e) {
    const next = e.target.value;
    onChange?.(next);
    if (!open) setOpen(true);
  }

  function handleFocus() {
    if (value && value.trim().length >= MIN_QUERY_CHARS) {
      setOpen(true);
    }
  }

  function handleBlur(e) {
    // If focus moves into one of our suggestion items, don't close — they
    // intentionally use `onMouseDown`/`onTouchStart` to preempt blur, but
    // a screen-reader user navigating with VoiceOver focuses items too.
    // In portal mode the listbox lives in document.body, so it is NOT a
    // descendant of `wrapperRef`; match it by id as well.
    const next = e.relatedTarget;
    if (next) {
      if (wrapperRef.current?.contains(next)) return;
      const escaped = typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(listboxId)
        : listboxId.replace(/"/g, '\\"');
      if (next.closest?.(`#${escaped}`)) return;
    }
    setOpen(false);
  }

  function handleKeyDown(e) {
    // Open the listbox on first arrow press even when closed — matches
    // every browser-native combobox's behavior.
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open && value) {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setActive(i => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setActive(i => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      // Only swallow Enter when there's an active highlight to commit.
      // Otherwise let the form's default submit fire — matches the prior
      // raw-input behavior where Enter submitted the route form.
      if (active >= 0 && active < suggestions.length) {
        e.preventDefault();
        commitSelection(suggestions[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    } else if (e.key === "Home" && suggestions.length) {
      setActive(0);
    } else if (e.key === "End" && suggestions.length) {
      setActive(suggestions.length - 1);
    }
  }

  const activeId = useMemo(
    () => (active >= 0 && suggestions[active] ? `${listboxId}-opt-${active}` : undefined),
    [active, suggestions, listboxId],
  );

  // Portal mode: track the input's bounding rect + visualViewport size so
  // the fixed-position listbox stays anchored under the input through:
  //   * page scroll (any ancestor)
  //   * window resize
  //   * iOS soft-keyboard open/close (visualViewport.resize)
  //   * page scroll under the visual viewport (visualViewport.scroll)
  //   * WFSheet drag (the sheet uses transform, so the input's
  //     getBoundingClientRect() picks up the new position immediately)
  // The listbox is hidden via display:none until the first measurement
  // lands, otherwise it'd flash at (0,0) for one frame.
  const [pos, setPos] = useState(null);
  const renderedListboxOpen = open && suggestions.length > 0;
  const portalEnabled = positioning === "portal" && typeof window !== "undefined";

  useLayoutEffect(() => {
    if (!portalEnabled || !renderedListboxOpen) {
      setPos(null);
      return;
    }
    function update() {
      const el = inputRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Prefer visualViewport.height — on iOS Safari it shrinks when the
      // soft keyboard opens, which is exactly the bound we want for the
      // dropdown's `max-height` so the bottom row stays above the keyboard.
      const vv = window.visualViewport;
      const viewportH = vv ? vv.height : window.innerHeight;
      const viewportTop = vv ? vv.offsetTop : 0;
      const spaceBelow = viewportTop + viewportH - rect.bottom - VIEWPORT_MARGIN_PX;
      const spaceAbove = rect.top - viewportTop - VIEWPORT_MARGIN_PX;
      // Flip above only when there is meaningfully more room there AND not
      // enough below for even three rows. 132 px ≈ 3 × 44 px rows.
      const flip = spaceBelow < 132 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(
        88,
        Math.min(DEFAULT_MAX_HEIGHT_PX, flip ? spaceAbove : spaceBelow),
      );
      const next = {
        top: flip ? rect.top - maxHeight - 2 : rect.bottom + 2,
        left: rect.left,
        width: rect.width,
        maxHeight,
      };
      // Skip the state churn when nothing moved. The rAF poll below runs
      // update() every frame, so without this guard we'd re-render the
      // listbox at 60 Hz even when sitting still.
      setPos(prev => (
        prev
        && prev.top === next.top
        && prev.left === next.left
        && prev.width === next.width
        && prev.maxHeight === next.maxHeight
          ? prev
          : next
      ));
    }
    update();
    // High-frequency scroll/resize events (capture-phase ancestor scroll,
    // iOS visualViewport keyboard transitions) can fire 60+ times per
    // second. Coalesce through requestAnimationFrame so the measurement +
    // setPos round trip runs at most once per frame regardless of event
    // density.
    let rafId = 0;
    const scheduleUpdate = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        update();
      });
    };
    // Capture-phase scroll listener so we catch scroll on ANY ancestor (the
    // WFSheet body's overflow:auto, the page itself, etc.) without each
    // container having to opt in.
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", scheduleUpdate);
    vv?.addEventListener("scroll", scheduleUpdate);
    // The WFSheet drag mutates `transform: translateY(...)` on its
    // container — no scroll/resize event fires, so the listeners above
    // can't catch it. Capture-phase pointermove on window does: pointer
    // capture redirects events to the captured element but they still
    // bubble through document. After release, the sheet animates to its
    // settled snap via a CSS transition on the same transform; that
    // animation fires no DOM events during its run, so we kick off a
    // bounded rAF burst on pointerup to track its tail. Burst is
    // ~400 ms — slightly longer than --dur-considered (320 ms).
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const onPointerMove = () => scheduleUpdate();
    let burstRafId = 0;
    let burstUntilMs = 0;
    const burstTick = () => {
      burstRafId = 0;
      if (now() >= burstUntilMs) return;
      update();
      burstRafId = requestAnimationFrame(burstTick);
    };
    const onPointerEnd = () => {
      burstUntilMs = now() + 400;
      if (!burstRafId) burstRafId = requestAnimationFrame(burstTick);
    };
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerEnd, true);
    window.addEventListener("pointercancel", onPointerEnd, true);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (burstRafId) cancelAnimationFrame(burstRafId);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
      vv?.removeEventListener("resize", scheduleUpdate);
      vv?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerEnd, true);
      window.removeEventListener("pointercancel", onPointerEnd, true);
    };
  }, [portalEnabled, renderedListboxOpen, suggestions.length, inputRef]);

  // Position the listbox: portal mode uses the measured rect; absolute mode
  // (the test-fixture / inline opt-out) keeps the original CSS-driven flow.
  const listboxStyle = portalEnabled
    ? (pos
        ? {
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
          }
        : { display: "none" })
    : undefined;

  const listbox = renderedListboxOpen ? (
    <ul
      id={listboxId}
      className={
        "address-autocomplete-list" +
        (portalEnabled ? " address-autocomplete-list--portaled" : "")
      }
      role="listbox"
      style={listboxStyle}
    >
      {suggestions.map((s, i) => (
        <li
          key={`${s.source || "x"}-${s.label}-${s.lat ?? "x"}-${i}`}
          id={`${listboxId}-opt-${i}`}
          role="option"
          aria-selected={i === active}
          className={
            "address-autocomplete-item" +
            (i === active ? " address-autocomplete-item--active" : "")
          }
          // mousedown + touchstart so the selection fires *before* the
          // input's blur — otherwise blur closes the listbox before
          // click ever lands. Both events also preventDefault to stop
          // the touch from also re-focusing the underlying scroll layer.
          onMouseDown={(e) => {
            e.preventDefault();
            commitSelection(s);
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            commitSelection(s);
          }}
          onMouseEnter={() => setActive(i)}
        >
          <span className="address-autocomplete-item-label">{s.label}</span>
          {s.source && (
            <span
              className={`address-autocomplete-item-source address-autocomplete-item-source--${s.source}`}
              aria-hidden="true"
            >
              {SOURCE_LABELS[s.source] || s.source}
            </span>
          )}
        </li>
      ))}
    </ul>
  ) : null;

  return (
    <div
      className={`address-autocomplete${className ? ` ${className}` : ""}`}
      ref={wrapperRef}
    >
      <input
        ref={inputRef}
        type="search"
        className={inputClassName || "address-autocomplete-input"}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck={false}
        enterKeyHint={enterKeyHint}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open && suggestions.length > 0}
        aria-activedescendant={activeId}
      />
      {portalEnabled
        ? listbox && createPortal(listbox, document.body)
        : listbox}
      {/* Status region kept visually hidden so screen readers announce the
          result count without crowding the visual layout. The aria-live
          region updates only when results land, not on every keystroke. */}
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
      >
        {loading ? "Searching…" : suggestions.length > 0 && open
          ? `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"}`
          : ""}
      </span>
    </div>
  );
}

// Compact display labels for the source pill on the right of each row.
// Falls back to the raw source string for any new source the backend ships.
const SOURCE_LABELS = Object.freeze({
  neighborhood:   "neighborhood",
  intersection:   "cross-street",
  address:        "address",
  place:          "place",
  community_area: "community area",
  locationiq:     "external",
});
