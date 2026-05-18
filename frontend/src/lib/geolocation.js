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

// Must stay in sync with CHICAGO_* in backend/utils.py — JS can't import the
// Python source, so this is a hand-maintained mirror. Update both together.
const CHICAGO_SOUTH = 41.64;
const CHICAGO_NORTH = 42.02;
const CHICAGO_WEST  = -87.94;
const CHICAGO_EAST  = -87.52;

const DEFAULT_TIMEOUT_MS = 10_000;

function inChicagoBbox(lat, lon) {
  return lat >= CHICAGO_SOUTH && lat <= CHICAGO_NORTH
      && lon >= CHICAGO_WEST  && lon <= CHICAGO_EAST;
}

// Continuous variant for "follow my location" — wraps `watchPosition` and
// streams fixes to `onFix({ lat, lon, accuracy })`. Out-of-bbox fixes and
// permission/availability failures go to `onError({ error })` using the same
// error vocabulary as `resolveCurrentLocation`. Returns a teardown function.
//
// Uses high-accuracy + `maximumAge: 0` because the caller is actively walking
// and stale fixes would defeat the purpose.
export function watchCurrentLocation({
  onFix,
  onError,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    if (typeof onError === "function") onError({ error: "unavailable" });
    return () => {};
  }
  const watchId = navigator.geolocation.watchPosition(
    pos => {
      const lat = pos.coords?.latitude;
      const lon = pos.coords?.longitude;
      const accuracy = pos.coords?.accuracy;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        if (typeof onError === "function") onError({ error: "unavailable" });
        return;
      }
      if (!inChicagoBbox(lat, lon)) {
        if (typeof onError === "function") onError({ error: "outside_coverage" });
        return;
      }
      if (typeof onFix === "function") {
        onFix({ lat, lon, accuracy: Number.isFinite(accuracy) ? accuracy : null });
      }
    },
    err => {
      if (typeof onError !== "function") return;
      if (err?.code === 1) onError({ error: "denied" });
      else                 onError({ error: "unavailable" });
    },
    { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
  );
  return () => {
    try { navigator.geolocation.clearWatch(watchId); } catch { /* noop */ }
  };
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
