// Persist the user's most-recent manual sheet snap so the bottom sheet opens
// at their preferred height across sessions. Only manual settles (drag
// release) write here — programmatic auto-promotes (route arrival) are
// deliberately not persisted, see App.jsx.

import { safeGet, safeSet } from "./storage.js";

const SHEET_SNAP_KEY = "walkpath:sheetSnap";
const VALID_SNAPS = [0, 1, 2];

// Returns the stored snap index, or null if absent / out of range / parse-fail.
// Out-of-range values (e.g. a future schema bumps to 4 snaps and downgrades)
// are silently treated as absent rather than thrown.
export function loadSheetSnap() {
  const raw = safeGet(SHEET_SNAP_KEY);
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return VALID_SNAPS.includes(n) ? n : null;
}

export function saveSheetSnap(idx) {
  if (!VALID_SNAPS.includes(idx)) return false;
  return safeSet(SHEET_SNAP_KEY, String(idx));
}
