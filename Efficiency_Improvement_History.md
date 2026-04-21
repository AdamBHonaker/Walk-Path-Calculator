# Efficiency Improvement History

A log of efficiency opportunities that have been identified and implemented. Entries are moved here from `EFFICIENCY_IMPROVEMENTS.md` when resolved.

Impact: 🔴 High · 🟡 Medium · 🟢 Low.

Categories: Redundant Computation · Inefficient Data Structure · Inefficient I/O · Memory Footprint · Algorithmic Complexity.

---

<!--
Entry template — copy this block when moving an item from EFFICIENCY_IMPROVEMENTS.md:

# YYYY-MM-DD <Short title summarizing the change>

---

## <impact emoji> <OPT-ID> · <Opportunity title> — IMPLEMENTED

**File:** `path/to/file.py` (and any others touched)

**Category:** <e.g. Redundant Computation / Inefficient I/O>

**What was inefficient:** <Describe the prior behavior: what was being recomputed, what memory was held unnecessarily, what I/O was redundant, etc. Include scale — "~20k Haversine calls per request", "rewrote full 3MB JSON every 30s", "held all 1.2M shape points in memory" — so future readers can judge whether a similar pattern elsewhere is worth revisiting.>

**Implemented in:** <Describe the fix concretely: what data structure / caching / indexing / reordering was introduced, where it lives (module-level vs per-request, startup vs first-call), and what behavior is preserved unchanged. Note any measured or estimated before/after numbers if available. Mention any callers or adjacent code that had to change to accommodate the new shape, and any follow-ups deliberately deferred.>

-->

