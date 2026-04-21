# Walk Path Calculator

A walking route calculator for Chicago that shows exact step counts alongside turn-by-turn directions — built to encourage walking over transit.

## Features

- Instant offline routing using a pre-built Chicago street graph
- Step count and calorie estimates (personalized by height, or sensible default)
- Turn-by-turn directions with per-segment steps, distance, and time
- Interactive map with the walk path drawn in green
- Neighborhood/landmark name lookup (offline) with Google Maps geocoding fallback for street addresses

## Project Structure

```
Walk-Path-Calculator/
├── backend/              # Python FastAPI
│   ├── main.py           # POST /route, GET /health
│   ├── walking.py        # Street network routing
│   ├── geocoding.py      # Neighborhood lookup + Google Maps fallback
│   ├── steps.py          # Step count + calorie calculation
│   ├── utils.py          # Haversine distance, SpatialGrid, bounding boxes
│   ├── requirements.txt
│   └── .env.example
└── frontend/             # React + Vite + MapLibre GL
    ├── src/
    │   ├── App.jsx       # Main UI (form, step hero, directions panel)
    │   ├── MapView.jsx   # Walk path rendering
    │   └── App.css       # Green health-themed dark UI
    └── public/
```

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- The Chicago street graph file (`street_graph.graphml`, ~79 MB) — not included in this repo due to size. Copy it from the `CTA-Transit-PWA/backend/` directory.

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env          # add GOOGLE_MAPS_API_KEY if routing street addresses
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

**Request:**
```json
{
  "origin": "Wrigleyville",
  "destination": "Logan Square",
  "height_inches": 69
}
```

**Response:**
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
  "path": [[41.9476, -87.6553], ["..."]],
  "directions": [
    {
      "street": "Clark St",
      "direction": "S",
      "direction_full": "South",
      "blocks": 2.0,
      "block_type": "long",
      "minutes": 3.1,
      "distance_miles": 0.155,
      "steps": 325
    }
  ]
}
```

`height_inches` is optional. Omitting it uses a 30-inch default step length.

### `GET /health`

Returns `{"status": "ok"}`.

## Notes

- **Chicago only** — routing uses a locally stored street graph for instant results. Expansion to other cities requires adding their graphs and a city picker UI.
- **Walking speed** — 3 mph throughout, consistent with standard pedestrian routing.
- **Geocoding cache** — resolved addresses are written to `backend/geocode_cache.json` (gitignored).
- **Step formula** — `step_length_inches = height_inches × 0.413`. Default: 30 inches.
