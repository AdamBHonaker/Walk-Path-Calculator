// Thin client over `GET /autocomplete`. Returns the backend's `suggestions`
// list verbatim (each entry: `{label, lat, lon, source}`) plus a normalized
// error path that matches the rest of the API helpers in this folder.
//
// Reuses `fetchWithTimeout` so a stalled request can't pin the typeahead
// open, and the consumer-supplied AbortSignal so a fresh keystroke can
// cancel an in-flight call.

import { BACKEND_URL } from "./backendUrl.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

// Tighter than the route/explore timeouts — typeahead requests must not
// linger past the next keystroke. 5 s is generous given the local-first
// cascade resolves nearly every query in < 10 ms.
const AUTOCOMPLETE_FETCH_TIMEOUT_MS = 5_000;

/**
 * @param {string}      query
 * @param {Object}      [opts]
 * @param {number}      [opts.limit]   1..20 (backend cap)
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Array<{label: string, lat: number, lon: number, source: string}>>}
 */
export async function fetchAutocomplete(query, { limit = 8, signal } = {}) {
  const trimmed = (query || "").trim();
  if (!trimmed) return [];
  const url = new URL(`${BACKEND_URL}/autocomplete`);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("limit", String(limit));

  const res = await fetchWithTimeout(
    url.toString(),
    { method: "GET", signal },
    AUTOCOMPLETE_FETCH_TIMEOUT_MS,
  );
  if (!res.ok) {
    const err = new Error(`Autocomplete failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return Array.isArray(data?.suggestions) ? data.suggestions : [];
}
