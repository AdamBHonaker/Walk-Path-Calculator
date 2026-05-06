// Browser geolocation helper. Wraps `navigator.geolocation.getCurrentPosition`
// in a promise and classifies the outcome into the small set of error shapes
// the UI cares about. Resolves to:
//   { lat, lon }
// or { error: "denied" | "outside_coverage" | "unavailable" }
//
// Coverage gating happens here too — the backend `/reverse-geocode` endpoint
// returns 422 outside the Chicago bbox, but we'd rather not pay that round trip
// when we can decide locally.
//
// FEAT #1 (Neighborhood Explorer) will reuse this helper for its "current
// location" mode (chunk 8). Keep the return shape stable.

const CHICAGO_SOUTH = 41.64;
const CHICAGO_NORTH = 42.02;
const CHICAGO_WEST  = -87.94;
const CHICAGO_EAST  = -87.52;

const DEFAULT_TIMEOUT_MS = 10_000;

function inChicagoBbox(lat, lon) {
  return lat >= CHICAGO_SOUTH && lat <= CHICAGO_NORTH
      && lon >= CHICAGO_WEST  && lon <= CHICAGO_EAST;
}

export function resolveCurrentLocation({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ error: "unavailable" });
  }
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords?.latitude;
        const lon = pos.coords?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          resolve({ error: "unavailable" });
          return;
        }
        if (!inChicagoBbox(lat, lon)) {
          resolve({ error: "outside_coverage" });
          return;
        }
        resolve({ lat, lon });
      },
      err => {
        // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3
        if (err?.code === 1) resolve({ error: "denied" });
        else                 resolve({ error: "unavailable" });
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
