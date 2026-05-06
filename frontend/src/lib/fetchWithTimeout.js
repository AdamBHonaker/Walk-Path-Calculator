// Abort-aware fetch wrapper. Composes an external AbortSignal (if any) with
// a fresh timeout-driven controller so callers can cancel either way and the
// fetch always cleans up its timer on settle. Shared between the route-fetch
// in App.jsx and the explore-fetch in lib/exploreApi.js.

export const ROUTE_FETCH_TIMEOUT_MS   = 10_000;
export const EXPLORE_FETCH_TIMEOUT_MS = 12_000;

export function fetchWithTimeout(input, init = {}, timeoutMs = ROUTE_FETCH_TIMEOUT_MS) {
  const externalSignal = init.signal;
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  if (externalSignal) {
    if (externalSignal.aborted) timeoutCtrl.abort();
    else externalSignal.addEventListener("abort", () => timeoutCtrl.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: timeoutCtrl.signal })
    .finally(() => clearTimeout(timer));
}
