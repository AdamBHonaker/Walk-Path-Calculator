# Walk-Path-Calculator

A walking route calculator for Chicago that shows exact step counts alongside turn-by-turn directions, encouraging users to walk rather than take other transportation.

## Project Structure

```
Walk-Path-Calculator/
├── backend/              # Python FastAPI
│   ├── main.py           # POST /route endpoint, GET /health
│   ├── walking.py        # Street network routing (ported from CTA-Transit-PWA)
│   ├── geocoding.py      # Neighborhood lookup + Google Maps fallback
│   ├── steps.py          # Step count + calorie calculation utilities
│   ├── utils.py          # Haversine, SpatialGrid, Chicago bounding boxes
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/             # React + Vite + MapLibre GL
    ├── src/
    │   ├── App.jsx       # Main UI (form, step hero, directions)
    │   ├── MapView.jsx   # Walk path rendering (green line)
    │   ├── App.css       # Green health-themed dark UI
    │   └── main.jsx
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

- **Chicago-only for now.** The street graph is pre-built and stored locally; routing is instant. Future expansion: add new city graphs and a city picker UI (one city per "game piece").
- **Walking speed: 3 mph.** Consistent with CTA-Transit-PWA. Used to convert segment minutes ↔ distances.
- **Step formula:** `step_length_inches = height_inches × 0.413`. Default (no height): 2.5 ft (30 in). See `steps.py`.
- **No transit data.** This project has zero dependency on GTFS, CTA APIs, or the transit graph. `walking.py`, `utils.py`, and `geocoding.py` are the entire backend surface.
- **Geocoding:** Neighborhood/landmark name lookup is instant and offline. Street addresses fall back to Google Maps Geocoding API (requires key in `.env`). The geocode cache is written to `backend/geocode_cache.json`.

## API

### `POST /route`
```json
{
  "origin": "Wrigleyville",
  "destination": "Logan Square",
  "height_inches": 69
}
```
Returns:
```json
{
  "origin_coords": [41.9476, -87.6553],
  "dest_coords": [41.9290, -87.7000],
  "total_miles": 2.8,
  "total_minutes": 56.0,
  "total_steps": 5880,
  "calories_approx": 241,
  "daily_goal_pct": 59,
  "step_length_inches": 28.5,
  "personalized": true,
  "path": [[lat, lon], ...],
  "directions": [
    { "street": "Clark St", "direction": "S", "direction_full": "South",
      "blocks": 2.0, "block_type": "long", "minutes": 3.1,
      "distance_miles": 0.155, "steps": 325 }
  ]
}
```

## Porting Notes

`walking.py` and `utils.py` are direct ports from `CTA-Transit-PWA/backend/` with minor additions:
- `walking.py` adds `distance_meters` to each direction step (used to compute `distance_miles` per segment in `main.py`)
- `walking.py` exports `WALKING_SPEED_MPH` constant
- `utils.py` removes the CTA-specific `TRANSFER_PENALTY_MINUTES` constant

`geocoding.py` extracts only the geocoding logic from `CTA-Transit-PWA/backend/gtfs_loader.py` (NEIGHBORHOOD_COORDS, fuzzy matching, Google Maps geocoding). None of the GTFS/stop-loading code is included.
