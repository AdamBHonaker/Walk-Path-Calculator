// Abort-aware fetch wrapper. Composes an external AbortSignal (if any) with
// a fresh timeout-driven controller so callers can cancel either way and the
// fetch always cleans up its timer on settle. Shared between the route-fetch
// in App.jsx and the explore-fetch in lib/exploreApi.js.

// TD-066 / F-27: the three different fetch budgets reflect three different
// user-visible failure modes. Documented here so a future tuning pass
// doesn't homogenize them without thinking through the trade-offs.
//
//   /route        — 10 s. The largest backend latency component is the
//                   greenest-flavor Dijkstra over the full city graph
//                   (~200k vertices). p95 measured locally is ~600 ms;
//                   the 10 s budget covers cold-cache misses on Railway
//                   plus a generous slack for the user's network. Below
//                   ~6 s the timeout starts to fire on legitimately-slow
//                   networks; above ~15 s the user has already given up.
//   /explore      — 12 s. Adds shapely heatmap clip work on top of the
//                   isochrone Dijkstra. The 8-thread pool absorbs most of
//                   the four heatmaps in parallel, but a 45-min isochrone
//                   on a slow connection can push the wire-time piece up.
//                   Same network slack as /route, plus 2 s for the
//                   heatmap fan-in.
//   /autocomplete — 5 s. Single FTS5 lookup; p95 ~30 ms server-side. The
//                   short budget kills stalled typeahead requests before
//                   the user's next keystroke arrives (debounce is 150
//                   ms, so 5 s is ~33 keystroke generations of tolerance
//                   — plenty for any real network blip but not so long
//                   that a stuck request blocks the active query).
export const ROUTE_FETCH_TIMEOUT_MS   = 10_000;
export const EXPLORE_FETCH_TIMEOUT_MS = 12_000;

// Distinct error class for timeout-induced aborts so callers can tell them
// apart from a user-initiated AbortError. Without this, the timeout's abort
// surfaces as a generic AbortError — indistinguishable from the external
// signal's abort — and catch blocks that silently return on AbortError swallow
// the timeout, leaving the user with a cleared loading state and no message.
export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function fetchWithTimeout(input, init = {}, timeoutMs = ROUTE_FETCH_TIMEOUT_MS) {
  const externalSignal = init.signal;
  const timeoutCtrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutCtrl.abort();
  }, timeoutMs);
  const onAbort = () => timeoutCtrl.abort();
  if (externalSignal) {
    if (externalSignal.aborted) timeoutCtrl.abort();
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }
  return fetch(input, { ...init, signal: timeoutCtrl.signal })
    .catch(err => {
      // Reclassify a timeout-induced AbortError so callers can surface a real
      // error message instead of treating it as a user cancellation. Genuine
      // user aborts (external signal) and other failures pass through.
      if (err?.name === "AbortError" && timedOut && !externalSignal?.aborted) {
        throw new TimeoutError(`Request timed out after ${timeoutMs} ms`);
      }
      throw err;
    })
    .finally(() => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
    });
}
