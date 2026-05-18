// Catalog for the Neighborhood Explorer's category panel + map symbology.
//
// Mirrors the table in docs/FEATURE_PLANS.md FEAT #1: five top-level groups,
// each containing one or more categories, with optional subcategories nested
// under a parent. Each category carries:
//
//   key:        stable identifier matching backend `places.category`
//   label:      user-facing display name (Cream / Dusk theme-agnostic)
//   color:      Wayfarer token used for the map pin fill + checkbox accent
//   glyph:      single character drawn inside the pin (text-based so we
//               don't ship per-category SVGs in the bundle)
//   subs:       optional list of { key, label } for nested checkboxes —
//               keys match backend `places.subcategory` exactly.
//
// Order within each group matches the FEATURE_PLANS table exactly. Places
// of Worship subcategories are alphabetized per spec.

export const EXPLORE_GROUPS = [
  {
    key: "daily_life",
    label: "Daily life",
    categories: [
      {
        key: "grocery",
        label: "Grocery stores",
        color: "var(--field)",
        glyph: "G",
        subs: [
          { key: "farmers_market", label: "Farmers markets" },
        ],
      },
      {
        key: "medical",
        label: "Medical",
        color: "var(--ember)",
        glyph: "+",
        subs: [
          { key: "pharmacy",    label: "Pharmacies" },
          { key: "urgent_care", label: "Urgent care / clinics" },
          { key: "hospital",    label: "Hospitals" },
        ],
      },
      {
        key: "train_stations",
        label: "Train stations",
        color: "var(--ink)",
        glyph: "T",
      },
      {
        key: "gyms_fitness",
        label: "Gyms & fitness studios",
        color: "var(--harbor)",
        glyph: "F",
      },
    ],
  },
  {
    key: "food_drink",
    label: "Food & drink",
    categories: [
      {
        key: "coffee_bakery",
        label: "Coffee shops / bakeries",
        color: "var(--gilt)",
        glyph: "C",
      },
      {
        key: "restaurants",
        label: "Restaurants",
        color: "var(--ember)",
        glyph: "R",
      },
      {
        key: "bars_nightlife",
        // Editorial framing per FEATURE_PLANS — reinforces the
        // walk-instead-of-drive mission of the project.
        label: "Bars & nightlife",
        color: "var(--ink)",
        glyph: "B",
      },
    ],
  },
  {
    key: "outdoors",
    label: "Outdoors",
    categories: [
      {
        key: "parks",
        label: "Public parks",
        color: "var(--field)",
        glyph: "P",
        subs: [
          { key: "dog_park",   label: "Dog parks / off-leash areas" },
          { key: "playground", label: "Playgrounds" },
        ],
      },
      // CPD park footprints — a heatmap fill alongside the parks pins.
      // Pins answer "there is a park here"; the footprint heatmap shows
      // how much of the walkshed is parkland.
      {
        key: "parks_heatmap",
        label: "Park footprints (heatmap)",
        color: "var(--field)",
        glyph: null,
        heatmapOnly: true,
        heatmapKey: "parks_heatmap",
      },
      // OSM-derived non-CPD green space — cemeteries, golf courses,
      // Forest Preserves / nature reserves, and recreation grounds.
      // Complements the CPD layer so the explorer reflects the full
      // green footprint of the walkshed.
      {
        key: "green_space_heatmap",
        label: "Other green space (heatmap)",
        color: "var(--moss-500)",
        glyph: null,
        heatmapOnly: true,
        heatmapKey: "green_space",
      },
      // Tree-canopy density from OSM natural=tree nodes, baked into a
      // 50 m KDE grid and rendered as three opacity bands (low/mid/high).
      // Answers "where is it pleasant to walk on a hot day?"
      {
        key: "tree_canopy_heatmap",
        label: "Tree canopy (heatmap)",
        color: "var(--moss)",
        glyph: null,
        heatmapOnly: true,
        heatmapKey: "tree_canopy",
      },
    ],
  },
  {
    key: "culture",
    label: "Culture",
    categories: [
      {
        key: "art_museums",
        label: "Public art / museums",
        color: "var(--gilt)",
        glyph: "A",
      },
      {
        key: "theaters",
        label: "Theaters",
        color: "var(--ember)",
        glyph: "T",
        subs: [
          { key: "movie", label: "Movie theaters" },
          { key: "live",  label: "Live theater" },
        ],
      },
      {
        key: "bookstores",
        label: "Bookstores",
        color: "var(--harbor)",
        glyph: "B",
      },
    ],
  },
  {
    key: "living",
    label: "Living",
    categories: [
      // Residential Area is rendered as a heatmap fill, not pins —
      // it has its own checkbox here but skips the pin layer in the map.
      {
        key: "residential",
        label: "Residential areas (heatmap)",
        color: "var(--moss)",
        glyph: null,
        heatmapOnly: true,
        heatmapKey: "residential",
      },
      {
        key: "schools",
        label: "Schools / universities",
        color: "var(--harbor)",
        glyph: "S",
      },
      {
        key: "places_of_worship",
        label: "Places of worship",
        color: "var(--ink)",
        glyph: "W",
        // Alphabetical per the FEATURE_PLANS UX rule.
        subs: [
          { key: "buddhism",     label: "Buddhism" },
          { key: "christianity", label: "Christianity" },
          { key: "hinduism",     label: "Hinduism" },
          { key: "islam",        label: "Islam" },
          { key: "judaism",      label: "Judaism" },
        ],
      },
    ],
  },
  {
    key: "public_services",
    label: "Public services",
    categories: [
      {
        key: "libraries",
        label: "Chicago Public Libraries",
        color: "var(--harbor)",
        glyph: "L",
      },
      {
        key: "police_stations",
        label: "Police stations",
        color: "var(--harbor)",
        glyph: "P",
      },
      {
        key: "fire_stations",
        label: "Fire stations",
        color: "var(--ember)",
        glyph: "F",
      },
    ],
  },
];

// Flat lookup helpers — used at runtime where a list of categories is more
// useful than the nested groups (place rendering, checkbox state, etc.).
export const ALL_CATEGORIES = EXPLORE_GROUPS.flatMap(g => g.categories);

export const CATEGORY_BY_KEY = Object.fromEntries(
  ALL_CATEGORIES.map(c => [c.key, c]),
);

// Categories that contribute pins to the map. Heatmap-only categories
// (currently just `residential`) drive a fill layer instead.
export const PIN_CATEGORIES = ALL_CATEGORIES.filter(c => !c.heatmapOnly);

// Selectable category keys for the request — the backend doesn't know
// about `residential` (it's served via the residential_heatmap field, not
// `places`), so it's filtered out of the categories param at request time.
export const REQUESTABLE_CATEGORY_KEYS = PIN_CATEGORIES.map(c => c.key);
