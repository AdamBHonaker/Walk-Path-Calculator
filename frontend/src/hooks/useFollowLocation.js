import { useCallback, useEffect, useRef, useState } from "react";
import { watchCurrentLocation } from "../lib/geolocation.js";

// Owns the watchPosition subscription for "follow my location" mode.
// Activated via `toggle()`; auto-stops when `enabled` flips false (e.g. the
// caller switches modes or clears the route). Position resets to null when
// follow is stopped so the user-location pin disappears from the map.
export function useFollowLocation({ enabled = true } = {}) {
  const [following, setFollowing] = useState(false);
  const [position, setPosition]   = useState(null);
  const [error, setError]         = useState(null);
  const cleanupRef = useRef(null);

  const stop = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    setFollowing(false);
    setPosition(null);
  }, []);

  const start = useCallback(() => {
    if (cleanupRef.current) return;
    setError(null);
    const teardown = watchCurrentLocation({
      onFix: fix => {
        setPosition(fix);
        setError(null);
      },
      onError: err => {
        setError(err?.error ?? "unavailable");
        if (cleanupRef.current) {
          cleanupRef.current();
          cleanupRef.current = null;
        }
        setFollowing(false);
        setPosition(null);
      },
    });
    cleanupRef.current = teardown;
    setFollowing(true);
  }, []);

  const toggle = useCallback(() => {
    if (cleanupRef.current) stop();
    else                    start();
  }, [start, stop]);

  useEffect(() => {
    if (!enabled && cleanupRef.current) stop();
  }, [enabled, stop]);

  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  return { following, position, error, toggle, stop };
}
