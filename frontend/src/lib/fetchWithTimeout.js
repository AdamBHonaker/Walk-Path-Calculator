// Abort-aware fetch wrapper. Composes an external AbortSignal (if any) with
// a fresh timeout-driven controller so callers can cancel either way and the
// fetch always cleans up its timer on settle. Shared between the route-fetch
// in App.jsx and the explore-fetch in lib/exploreApi.js.

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
