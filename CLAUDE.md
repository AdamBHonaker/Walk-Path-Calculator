# Passage

A walking route calculator for Chicago that shows exact step counts alongside turn-by-turn directions, encouraging users to walk rather than take other transportation. Editorial broadsheet voice via the Wayfarer design system.

> **Note on naming.** Several internal identifiers (localStorage keys prefixed `walkpath:`, the `WPIcon` component, the `walkpath-icons.jsx` filename, MapLibre `walk-path` source IDs) keep the old prefix to avoid orphaning user data and cascading import churn. The user-facing brand is **Passage**.

> **Wayfarer design-system migration: Phase 1 complete as of 2026-05-05.** All checkpoints landed (foundation, primary components extracted, share card, loading/error states, map paint, project rename, voice rewrites, Cream/Dusk theme toggle, a11y sweep, final verification — 142/142 tests passing). See [`frontend/handoff/HANDOFF.md`](frontend/handoff/HANDOFF.md) "Phase 1 Progress" for completed checkpoints, spec departures, and decisions made outside the original spec.

## Project Structure

```
Passage/
├── backend/              # Python FastAPI
│   ├── main.py           # POST /route, GET /health, GET /reverse-geocode
│   ├── walking.py        # Street network routing (ported from CTA-Transit-PWA)
│   ├── geocoding.py      # Neighborhood lookup + Google Maps fallback
│   ├── steps.py          # Step count + calorie calculation utilities
│   ├── utils.py          # Haversine, WALKING_SPEED_MPH, Chicago bounding boxes
│   ├── requirements.txt
│   ├── .env.example
│   └── tests/
│       └── test_main.py
│
├── docs/                 # Living feature/bug/debt logs
│
└── frontend/             # React + Vite + MapLibre GL
    ├── src/
    │   ├── App.jsx                # Main UI orchestration (form, hero, share modal)
    │   ├── MapView.jsx            # Live map + line-trim-offset draw-in animation
    │   ├── components/            # Masthead, Footer, DirectionLedger, RouteFlavorTabs,
    │   │                          #   CompareDispatch, ShareDispatch, PersonalizeModal
    │   ├── wayfarer/              # Wayfarer design system (tokens, themes, primitives,
    │   │                          #   forms, icons, walkpath-icons)
    │   ├── compareEstimates.js    # Ride-share vs. walk cost/CO2 comparison
    │   ├── mapHelpers.js          # Map config, route paint (ink/ember), GeoJSON helpers
    │   ├── calorieEquiv.js        # Maps calories → food-equivalent strings
    │   ├── lib/
    │   │   ├── storage.js         # Safe localStorage wrappers (try/catch in one place)
    │   │   ├── recentSearches.js  # Persisted recent-routes list
    │   │   ├── stepLog.js         # 7-day step log persistence
    │   │   └── directionFormat.js # formatStepLabel / formatBlocks / formatSteps
    │   ├── App.css / index.css
    │   ├── main.jsx
    │   ├── test-setup.js
    │   └── *.test.{jsx,js}
    └── public/
        └── fonts/                 # Self-hosted Fraunces, Inter, JetBrains Mono
```

## Running Locally

### Backend
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # add GOOGLE_MAPS_API_KEY if needed
uvicorn main:app --reload
```

The street graph (`street_graph.graphml` or `street_graph_igraph.pkl`) must be present in `backend/`. Copy it from `CTA-Transit-PWA/backend/` — it is the same graph.

### Frontend
```bash
cd frontend
npm install
npm run dev             # starts at http://localhost:5173
```

## Key Design Decisions

- **Chicago-only for now.** The street graph is pre-built and stored locally; routing is instant. Coverage spans the full Chicago city limits (77 community areas). Future expansion: add new city graphs and a city picker UI (one city per "game piece").
- **Walking speed:** Routing is computed at 3 mph internally; the API response rescales `total_minutes` and per-direction `minutes` to the user's selected `pace` (`leisurely` 2 mph, `normal` 3 mph, `brisk` 4 mph).
- **Step formula:** `step_length_inches = height_inches × 0.413`. Default (no height): 2.5 ft (30 in). See `steps.py`.
- **Calorie formula:** `kcal = MET × weight_kg × 3.5 / 200 × minutes`. MET varies by pace (2.5/3.5/4.5). Default 70 kg reference body weight when `weight_kg` is unset; the response sets `personalized_calories: true` when the user supplied a weight.
- **Route flavors:** Three alternatives are computed for every 2-stop route — `fastest` (default), `fewest_turns`, and `greenest` (prefers footways/paths). Multi-stop routes always use `fastest`. When `avoid_stairs` or `prefer_pedestrian` is true, the response collapses to a single `custom` flavor.
- **Routing prefs:** `avoid_stairs` adds a large per-edge penalty to OSM `highway=steps` edges. `prefer_pedestrian` routes under the existing `greenest` flavor (footway/path/cycleway discount).
- **Multi-stop routing:** Accepts 2–8 ordered stops. Legs are routed independently and stitched into one continuous path. The `legs` array in the response breaks down per-segment stats.
- **Pick-on-map:** `GET /reverse-geocode?lat=X&lon=Y` resolves a clicked map point to a street address or neighborhood name, used to set origin/destination without typing.
- **No transit data.** This project has zero dependency on GTFS, CTA APIs, or the transit graph. `walking.py`, `utils.py`, and `geocoding.py` are the entire backend surface.
- **Geocoding:** Neighborhood/landmark name lookup is instant and offline. Street addresses fall back to Google Maps Geocoding API (requires key in `.env`). The geocode cache is written to `backend/geocode_cache.json`.

## API

### `GET /health`
Returns `{"status": "ok"}`.

### `GET /reverse-geocode?lat=41.95&lon=-87.65`
Returns a street address or neighborhood name for the given coordinates (must be within the Chicago coverage area).

### `POST /route`

Request — use either `stops` (primary, 2–8 entries) or the `origin`/`destination` shorthand. Personalization fields are all optional:
```json
{
  "stops": ["Wrigleyville", "Bucktown", "Logan Square"],
  "height_inches": 69,
  "weight_kg": 70,
  "pace": "brisk",
  "daily_goal": 12000,
  "avoid_stairs": false,
  "prefer_pedestrian": false
}
```
```json
{
  "origin": "Wrigleyville",
  "destination": "Logan Square",
  "height_inches": 69
}
```

| Field               | Type                          | Default       | Notes                                            |
| ------------------- | ----------------------------- | ------------- | ------------------------------------------------ |
| `height_inches`     | number, 36–108                | unset         | Drives personalized stride length.               |
| `weight_kg`         | number, 30–300                | 70 (default)  | Sets `personalized_calories: true` when present. |
| `pace`              | `"leisurely"`/`"normal"`/`"brisk"` | `"normal"` | Rescales `total_minutes` + per-direction `minutes`; affects MET-based calories. |
| `daily_goal`        | int, 1 000–100 000            | 10 000        | Drives `daily_goal_pct`.                         |
| `avoid_stairs`      | bool                          | `false`       | Penalizes `highway=steps` edges; collapses to a `custom` flavor. |
| `prefer_pedestrian` | bool                          | `false`       | Routes under `greenest` flavor; collapses to a `custom` flavor. |

Response (2-stop — `routes` array contains one entry per flavor):
```json
{
  "stops": ["Wrigleyville", "Logan Square"],
  "stop_coords": [[41.9476, -87.6553], [41.9290, -87.7000]],
  "origin_coords": [41.9476, -87.6553],
  "dest_coords": [41.9290, -87.7000],
  "step_length_inches": 28.5,
  "personalized": true,
  "personalized_calories": true,
  "pace": "normal",
  "default_flavor": "fastest",
  "available_flavors": ["fastest", "fewest_turns", "greenest"],
  "routes": [
    {
      "flavor": "fastest",
      "path": [[lat, lon], ...],
      "directions": [...],
      "total_miles": 2.8,
      "total_minutes": 56.0,
      "total_steps": 5880,
      "calories_approx": 241,
      "daily_goal_pct": 59
    }
  ],
  "total_miles": 2.8,
  "total_minutes": 56.0,
  "total_steps": 5880,
  "calories_approx": 241,
  "daily_goal_pct": 59,
  "path": [[lat, lon], ...],
  "directions": [...]
}
```

Response (multi-stop — `routes` has exactly one entry; adds `legs`):
```json
{
  "stops": ["A", "B", "C"],
  "stop_coords": [...],
  "default_flavor": "fastest",
  "available_flavors": ["fastest"],
  "routes": [{ "flavor": "fastest", "legs": [...], ... }],
  "legs": [
    { "from_label": "A", "to_label": "B", "miles": 1.2, "minutes": 24.0,
      "steps": 2520, "calories_approx": 103, "path_slice": [0, 47] }
  ],
  ...
}
```

Direction step object (present in all route types):
```json
{ "street": "Clark St", "path_type": "path", "direction": "S",
  "direction_full": "South", "blocks": 2.0, "block_type": "long",
  "minutes": 3.1, "distance_meters": 249.0,
  "distance_miles": 0.155, "steps": 325 }
```
Multi-stop direction steps additionally include `"leg_index": 0`.

## Porting Notes

`walking.py` and `utils.py` are direct ports from `CTA-Transit-PWA/backend/` with minor additions:
- `walking.py` adds `distance_meters` to each direction step (passed through to the response; `main.py` computes `distance_miles` from `minutes` independently)
- `utils.py` defines `WALKING_SPEED_MPH`; `walking.py` imports it from there (single source of truth)
- `utils.py` removes the CTA-specific `TRANSFER_PENALTY_MINUTES` constant

`geocoding.py` extracts only the geocoding logic from `CTA-Transit-PWA/backend/gtfs_loader.py` (NEIGHBORHOOD_COORDS, fuzzy matching, Google Maps geocoding). None of the GTFS/stop-loading code is included.
