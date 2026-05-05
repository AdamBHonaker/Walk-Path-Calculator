# Passage

A walking route calculator for Chicago that shows exact step counts alongside turn-by-turn directions — built to encourage walking over transit. Editorial broadsheet voice via the Wayfarer design system.

## Features

- Instant offline routing using a pre-built Chicago street graph (full city coverage, 77 community areas)
- Step count and calorie estimates (personalized by height, or sensible default)
- Turn-by-turn directions with per-segment steps, distance, and time
- Multi-stop routing: 2–8 ordered stops stitched into one continuous walk
- Three route flavors for 2-stop trips: `fastest`, `fewest_turns`, and `greenest` (prefers footways/paths)
- Interactive MapLibre map with the walk route drawn in ink (ember on the share card) and turn markers
- Pick-on-map: click anywhere in Chicago to set an origin/destination
- Shareable route card (PNG export)
- Rideshare cost & CO₂ comparison vs. walking
- Neighborhood/landmark name lookup (offline) with Google Maps geocoding fallback for street addresses

## Project Structure

```
Passage/
├── backend/                  # Python FastAPI
│   ├── main.py               # POST /route, GET /health, GET /reverse-geocode
│   ├── walking.py            # Street network routing
│   ├── geocoding.py          # Neighborhood lookup + Google Maps fallback
│   ├── steps.py              # Step count + calorie calculation
│   ├── utils.py              # Haversine, WALKING_SPEED_MPH, Chicago bounding boxes
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── .env.example
│   └── tests/
│       └── test_main.py
├── docs/                     # Living feature/bug/debt logs
└── frontend/                 # React + Vite + MapLibre GL
    ├── src/
    │   ├── App.jsx                  # Main UI orchestration (form, hero, share modal)
    │   ├── MapView.jsx              # Live map + line-trim-offset draw-in animation
    │   ├── components/              # Extracted UI: Masthead, Footer, DirectionLedger,
    │   │                            #   RouteFlavorTabs, CompareDispatch, ShareDispatch,
    │   │                            #   PersonalizeModal
    │   ├── wayfarer/                # Wayfarer design system (tokens, themes, primitives,
    │   │                            #   forms, icons, walkpath-icons)
    │   ├── compareEstimates.js      # Rideshare cost/CO₂ comparison
    │   ├── mapHelpers.js            # Map config, route paint, GeoJSON helpers
    │   ├── calorieEquiv.js          # Maps calories → food-equivalent strings
    │   ├── lib/
    │   │   ├── storage.js           # Safe localStorage wrappers
    │   │   ├── recentSearches.js    # Persisted recent-routes list
    │   │   ├── stepLog.js           # 7-day step log persistence
    │   │   └── directionFormat.js   # formatStepLabel / formatBlocks / formatSteps
    │   ├── App.css / index.css
    │   ├── main.jsx
    │   ├── test-setup.js
    │   └── *.test.{jsx,js}
    └── public/
        └── fonts/                   # Self-hosted Fraunces, Inter, JetBrains Mono
```

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- The Chicago street graph (`street_graph.graphml`, ~79 MB) — not included in this repo due to size. Copy it from the `CTA-Transit-PWA/backend/` directory. A faster `street_graph_igraph.pkl` is built automatically from the graphml on first run (and during Docker image build).

### Backend

```bash
cd backend
pip install -r requirements.txt
pip install -r requirements-dev.txt   # local dev: adds pytest + test client deps
cp .env.example .env                  # add GOOGLE_MAPS_API_KEY if routing street addresses
```

Place `street_graph.graphml` in the `backend/` directory, then:

```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

## API

### `POST /route`

Use either `stops` (primary, 2–8 entries) or the `origin`/`destination` shorthand.

**Request (multi-stop):**
```json
{
  "stops": ["Wrigleyville", "Bucktown", "Logan Square"],
  "height_inches": 69
}
```

**Request (2-stop shorthand):**
```json
{
  "origin": "Wrigleyville",
  "destination": "Logan Square",
  "height_inches": 69
}
```

`height_inches` is optional. Omitting it uses a 30-inch default step length (`step_length_inches = height_inches × 0.413`).

**Response (2-stop — `routes` contains one entry per available flavor):**
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
      "path": [[41.9476, -87.6553], ["..."]],
      "directions": [ "..." ],
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
  "path": [[41.9476, -87.6553], ["..."]],
  "directions": [ "..." ]
}
```

**Response (multi-stop — `routes` has one `fastest` entry; adds `legs`):**
```json
{
  "stops": ["A", "B", "C"],
  "stop_coords": ["..."],
  "default_flavor": "fastest",
  "available_flavors": ["fastest"],
  "routes": [{ "flavor": "fastest", "legs": ["..."], "...": "..." }],
  "legs": [
    {
      "from_label": "A",
      "to_label": "B",
      "miles": 1.2,
      "minutes": 24.0,
      "steps": 2520,
      "calories_approx": 103,
      "path_slice": [0, 47]
    }
  ]
}
```

**Direction step object:**
```json
{
  "street": "Clark St",
  "path_type": "path",
  "direction": "S",
  "direction_full": "South",
  "blocks": 2.0,
  "block_type": "long",
  "minutes": 3.1,
  "distance_meters": 249.0,
  "distance_miles": 0.155,
  "steps": 325
}
```
Multi-stop direction steps additionally include a `"leg_index"` field.

### `GET /reverse-geocode?lat=41.95&lon=-87.65`

Returns a street address or neighborhood name for the given coordinates. Used by the pick-on-map feature. Coordinates must fall within the Chicago coverage area.

### `GET /health`

Returns `{"status": "ok"}`.

## Notes

- **Chicago only** — routing uses a locally stored street graph for instant results. Expansion to other cities requires adding their graphs and a city picker UI.
- **Walking speed** — 3 mph throughout, consistent with standard pedestrian routing.
- **Route flavors** — only 2-stop routes compute all three flavors. Multi-stop routes always use `fastest`.
- **Geocoding cache** — resolved addresses are written to `backend/geocode_cache.json` (gitignored).
- **Step formula** — `step_length_inches = height_inches × 0.413`. Default: 30 inches (~5'10" male average).
