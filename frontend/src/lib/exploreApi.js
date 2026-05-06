// API client for the Neighborhood Explorer's `/explore` endpoint.
//
// Mirrors the route-fetch shape over in App.jsx (timeout-aware fetch,
// error-message extraction from the backend's `detail.message` shape) so
// errors reach the UI in the same form.

import { fetchWithTimeout, EXPLORE_FETCH_TIMEOUT_MS } from "./fetchWithTimeout.js";

/**
 * @param {Object}   args
 * @param {string}   args.backendUrl
 * @param {Object}   args.origin           — { kind:"community_area", communityArea } |
 *                                           { kind:"current", lat, lon }
 * @param {number}   args.maxMinutes       — 5..45
 * @param {string[]} [args.categories]     — top-level keys; omit for "all"
 * @param {AbortSignal} [args.signal]
 */
export async function fetchExplore({ backendUrl, origin, maxMinutes, categories, signal }) {
  const body = {
    max_minutes: maxMinutes,
    origin: origin.kind === "community_area"
      ? { community_area: origin.communityArea }
      : { lat: origin.lat, lon: origin.lon },
  };
  if (Array.isArray(categories)) {
    body.categories = categories;
  }

  const res = await fetchWithTimeout(`${backendUrl}/explore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }, EXPLORE_FETCH_TIMEOUT_MS);

  if (!res.ok) {
    let msg = `Service error (${res.status})`;
    try {
      const d = await res.json();
      if (d.detail && typeof d.detail === "object" && d.detail.message) {
        msg = d.detail.message;
      } else if (typeof d.detail === "string") {
        msg = d.detail;
      } else if (res.status === 429) {
        msg = "The explorer is rate-limited — try again in a minute.";
      }
    } catch {
      if (res.status === 429) {
        msg = "The explorer is rate-limited — try again in a minute.";
      }
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  return await res.json();
}
