// Single source of truth for the public API contract values the frontend
// renders. Centralized here so a backend rename or addition shows up as one
// edit, not a scavenger hunt across feature components.
//
// The values must stay in sync with `backend/models.py` — that file is the
// canonical contract (TD-052). When a new flavor / pace / place source /
// autocomplete source ships from the backend, add it here first, then
// update the consumer.

// ── Route flavors ──────────────────────────────────────────────────────
// Mirrors `models.Flavor` in backend/models.py. The `custom` value collapses
// any 2-stop or multi-stop route that sets `avoid_stairs` or `prefer_pedestrian`
// (the alternative-routes pipeline is skipped for accessibility-routed
// requests; backend always returns one flavor labeled `"custom"`).
export const FLAVORS = Object.freeze([
  "fastest",
  "fewest_turns",
  "greenest",
  "custom",
]);

// ── Pace labels ────────────────────────────────────────────────────────
// Mirrors `models.PaceLabel`. The user-visible copy ("Strolling" / "Steady" /
// "Earnest") lives on the PaceSelector component; this is just the wire
// vocabulary so a future-renamed pace surfaces here first and lints loud.
export const PACES = Object.freeze(["leisurely", "normal", "brisk"]);

// ── Place sources (from /explore `places[].source`) ────────────────────
// Mirrors `models.PlaceSource`. Each value names an upstream data feed.
// The Explorer doesn't render this field directly today, but the catalog
// (TD-060) called out the implicit contract as worth pinning.
export const PLACE_SOURCES = Object.freeze([
  "osm",
  "cpl_locations",
  "farmers_markets_2013",
  "cps_schools",
  "cpd_stations",
  "cfd_stations",
  "cdp_divvy",
  "cdp_landmarks",
]);

// ── Autocomplete sources (from /autocomplete `suggestions[].source`) ──
// Mirrors `models.AutocompleteSource`. The dropdown's right-aligned source
// chip uses this set to pick a label; LocationIQ also gets a visual tweak
// in App.css to make the "external" provenance scannable at a glance (C-17).
export const AUTOCOMPLETE_SOURCES = Object.freeze([
  "neighborhood",
  "intersection",
  "address",
  "place",
  "locationiq",
]);
