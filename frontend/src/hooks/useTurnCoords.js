import { useMemo } from "react";
import { haversineMeters } from "../mapHelpers.js";

// Walks the polyline path with the directions list, materializing the
// (lat, lon) coordinate where each turn arrow should land. Used by the
// MapView to draw turn dots and by App to flyTo on direction-step click.
//
// Two-phase array build (F-36):
//   Phase 1 — single forward walk over the path segments. Each iteration
//             may "absorb" zero, one, or many thresholds (when several
//             directions share a long straight segment), assigning the
//             interpolated coord at `turnCoords[tIdx]` for each.
//   Phase 2 — fill any leftover `turnCoords[i]` slots with the last
//             polyline point. Slots stay empty when rounding leaves the
//             last threshold a few cm beyond the path's accumulated
//             length; anchoring to the path's terminus is safer than
//             dropping the turn or extrapolating off the line.
// Sparse intermediate writes (assignment by index, not push) make the
// rounding-leftover handling possible — phase 1 doesn't know in advance
// whether a threshold will land inside the last segment or just past it.
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
