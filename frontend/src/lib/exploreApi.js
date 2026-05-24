// API client for the Neighborhood Explorer's `/explore` endpoint.
//
// Mirrors the route-fetch shape over in App.jsx (timeout-aware fetch,
// error-message extraction from the backend's `detail.message` shape) so
// errors reach the UI in the same form.

import { BACKEND_URL } from "./backendUrl.js";
import { fetchWithTimeout, EXPLORE_FETCH_TIMEOUT_MS } from "./fetchWithTimeout.js";
import { parseApiErrorMessage } from "./apiErrorMessage.js";

/**
 * @param {Object}   args
 * @param {Object}   args.origin           — { kind:"community_area", communityArea } |
 *                                           { kind:"current", lat, lon }
 * @param {number}   args.maxMinutes       — 5..45
 * @param {string[]} [args.categories]     — top-level keys; omit for "all"
 * @param {string[]} [args.withHeatmaps]   — subset of {"residential","parks",
 *                                           "green_space","tree_canopy"}.
 *                                           Omit to compute every heatmap
 *                                           (legacy behavior); pass an array
 *                                           to skip the clip work for layers
 *                                           the user has toggled off.
 * @param {AbortSignal} [args.signal]
 */
export async function fetchExplore({ origin, maxMinutes, categories, withHeatmaps, signal }) {
  const body = {
    max_minutes: maxMinutes,
    origin: origin.kind === "community_area"
      ? { community_area: origin.communityArea }
      : { lat: origin.lat, lon: origin.lon },
  };
  if (Array.isArray(categories)) {
    body.categories = categories;
  }
  if (Array.isArray(withHeatmaps)) {
    body.with_heatmaps = withHeatmaps;
  }

  const res = await fetchWithTimeout(`${BACKEND_URL}/explore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }, EXPLORE_FETCH_TIMEOUT_MS);

  if (!res.ok) {
    const err = new Error(await parseApiErrorMessage(res));
    err.status = res.status;
    throw err;
  }

  return await res.json();
}
