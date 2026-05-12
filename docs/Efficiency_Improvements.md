# Efficiency Improvements

Known efficiency improvements catalogued for future improvement. Impact: 🔴 High · 🟡 Medium · 🟢 Low.

> **Process:** When an efficiency in this file is implemented, **delete its entry from this file** and add a corresponding entry to the **Efficiency Improvements Implemented** section of [`RESOLVED_HISTORY.md`](archive/RESOLVED_HISTORY.md) documenting what was changed and how. This file should only ever contain improvements that have not yet been implemented.

---

## Efficiency Scan — 2026-05-05 (backend)

> Scanned: `backend/main.py`, `backend/walking.py`, `backend/geocoding.py`, `backend/utils.py`, `backend/steps.py`
> Found: 6 opportunities (1 High, 3 Medium, 2 Low)

---

### OPT-006 · Geocode cache rewritten in full every 50 entries
- **File**: [backend/geocoding.py](backend/geocoding.py)
- **Line(s)**: 142–166 (`_save_geocode_cache`, `_flush_geocode_if_needed`)
- **Category**: Inefficient I/O
- **Impact**: 🟢 Low
- **Description**: Each flush serialises the *entire* cache to JSON, writes a tmp file, and atomically renames over the canonical file. As the cache grows over the lifetime of a deployment (forward + reverse entries combined), each flush gets steadily more expensive, even though only ~50 entries actually changed. For a cache of a few thousand entries this is still fast, but the cost grows unboundedly and the `tmp.write_text` blocks the calling request thread.
- **Suggested Improvement**: Either (a) keep the current scheme but offload the write to a background thread (`threading.Thread(target=_save_geocode_cache, args=(snapshot,), daemon=True).start()`) so request latency isn't dominated by JSON serialisation when the cache is large; or (b) switch to an append-only log of `{key: value}` JSON lines and reconcile/compact on startup or once per N flushes. Option (a) is the smaller change and adequate at expected cache sizes.

---


