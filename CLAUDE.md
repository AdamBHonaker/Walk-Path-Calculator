# Walk-Path-Calculator

A walking route calculator for Chicago that shows exact step counts alongside turn-by-turn directions, encouraging users to walk rather than take other transportation.

## Project Structure

```
Walk-Path-Calculator/
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
    │   ├── App.jsx            # Main UI (form, step hero, directions)
    │   ├── MapView.jsx        # Walk path + turn markers rendering
    │   ├── RouteCard.jsx      # Shareable route card (PNG export)
    │   ├── compareEstimates.js  # Ride-share vs. walk cost/CO2 comparison
    │   ├── mapHelpers.js      # Turn point dedup, GeoJSON helpers
    │   ├── App.css / index.css
    │   ├── main.jsx
    │   ├── test-setup.js
    │   ├── *.test.{jsx,js}
    │   └── wayfarer/          # Internal design system (primitives, forms, icons, tokens, themes)
    └── public/
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
- **Walking speed: 3 mph.** Consistent with CTA-Transit-PWA. Used to convert segment minutes ↔ distances.
- **Step formula:** `step_length_inches = height_inches × 0.413`. Default (no height): 2.5 ft (30 in). See `steps.py`.
- **Route flavors:** Three alternatives are computed for every 2-stop route — `fastest` (default), `fewest_turns`, and `greenest` (prefers footways/paths). Multi-stop routes always use `fastest`.
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

Request — use either `stops` (primary, 2–8 entries) or the `origin`/`destination` shorthand:
```json
{
  "stops": ["Wrigleyville", "Bucktown", "Logan Square"],
  "height_inches": 69
}
```
```json
{
  "origin": "Wrigleyville",
  "destination": "Logan Square",
  "height_inches": 69
}
```

Response (2-stop — `routes` array contains one entry per flavor):
```json
{
  "stops": ["Wrigleyville", "Logan Square"],
  "stop_coords": [[41.9476, -87.6553], [41.9290, -87.7000]],
  "origin_coords": [41.9476, -87.6553],
  "dest_coords": [41.9290, -87.7000],
  "step_length_inches": 28.5,
  "personalized": true,
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
