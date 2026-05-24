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

// OPT-065: tiny LRU cache for identical (query, limit) pairs. A user
// who types, deletes, and re-types — or the same prefix typed into both
// stop inputs — would otherwise hit the backend twice for the same
// answer. Map preserves insertion order, so delete-on-get-then-re-set
// promotes a recently-read key to the most-recent slot; the oldest
// entry is evicted when size > MAX. Cache stores resolved suggestion
// arrays only; cancellations + errors do not populate the cache.
const _AC_CACHE_MAX = 20;
const _acCache = new Map();

function _acKey(q, limit) { return `${limit}|${q}`; }

function _acGet(key) {
  if (!_acCache.has(key)) return undefined;
  const val = _acCache.get(key);
  // Promote to MRU slot.
  _acCache.delete(key);
  _acCache.set(key, val);
  return val;
}

function _acSet(key, val) {
  if (_acCache.has(key)) _acCache.delete(key);
  _acCache.set(key, val);
  if (_acCache.size > _AC_CACHE_MAX) {
    // Map preserves insertion order, so the first key is the LRU.
    const oldest = _acCache.keys().next().value;
    _acCache.delete(oldest);
  }
}

// Exposed for unit tests; production callers don't need this.
export function _clearAutocompleteCache() { _acCache.clear(); }

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

  const key = _acKey(trimmed, limit);
  const cached = _acGet(key);
  if (cached) return cached;

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
  const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
  // Only cache successful responses. Aborted / errored requests never
  // reach here. Empty-suggestions arrays cache too — a repeat of the
  // same useless query stays useless without a round-trip.
  _acSet(key, suggestions);
  return suggestions;
}
