import { useMemo } from "react";
import { haversineMeters } from "../mapHelpers.js";

// Walks the polyline path with the directions list, materializing the
// (lat, lon) coordinate where each turn arrow should land. Used by the
// MapView to draw turn dots and by App to flyTo on direction-step click.
export function useTurnCoords(path, directions) {
  return useMemo(() => {
    if (!path?.length || !directions?.length) return [];

    // thresholds[i] = cumulative meters from the start to the turn at direction segment i
    const thresholds = [];
    let cum = 0;
    for (const dir of directions) {
      thresholds.push(cum);
      cum += dir.distance_meters ?? 0;
    }

    const turnCoords = [];
    let pathCum = 0;
    let tIdx = 0;

    for (let pi = 0; pi < path.length - 1 && tIdx < thresholds.length; pi++) {
      const segLen = haversineMeters(path[pi], path[pi + 1]);

      // Absorb all thresholds that fall within this segment (±10 m tolerance)
      while (tIdx < thresholds.length && thresholds[tIdx] <= pathCum + segLen + 10) {
        if (segLen > 0) {
          const t = Math.max(0, Math.min(1, (thresholds[tIdx] - pathCum) / segLen));
          turnCoords[tIdx] = [
            path[pi][0] + t * (path[pi + 1][0] - path[pi][0]),
            path[pi][1] + t * (path[pi + 1][1] - path[pi][1]),
          ];
        } else {
          turnCoords[tIdx] = [...path[pi]];
        }
        tIdx++;
      }
      pathCum += segLen;
    }

    // Anchor any rounding-leftover turns to the last polyline point
    const last = path[path.length - 1];
    for (let i = 0; i < thresholds.length; i++) {
      if (!turnCoords[i]) turnCoords[i] = last;
    }

    return turnCoords;
  }, [path, directions]);
}
