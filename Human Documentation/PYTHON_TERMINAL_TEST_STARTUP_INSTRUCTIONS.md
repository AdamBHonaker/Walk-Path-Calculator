# Walk-Path-Calculator — Local Test Startup Instructions

You need **two terminal windows open at the same time**: one for the backend (Python), one for the frontend (Node). Both must be running simultaneously for the app to work.

All `cd` commands below assume you start from the repo root (`Walk-Path-Calculator/`).

---

## Prerequisites (first-time setup only)

### Backend
1. Make sure Python 3.12 is installed.
2. From the `backend/` folder, install dependencies:
   ```
   pip install -r requirements.txt
   ```
3. Create `backend/.env` by copying the example:
   ```
   cp backend/.env.example backend/.env
   ```
   Then fill in:
   ```
   GOOGLE_MAPS_API_KEY=your_key_here
   ```
   > `GOOGLE_MAPS_API_KEY` is required for geocoding street addresses (e.g., "1060 W Addison St"). Neighborhood and landmark names work offline without it. See the README for instructions on obtaining a key.

### Frontend
1. Make sure Node.js is installed.
2. From the `frontend/` folder, install dependencies (only needed once, or after pulling new changes):
   ```
   npm install
   ```

### Data files (first-time only)
The street graph is large and gitignored — it lives only on your local machine. The backend will not start without it.

You have two options to get it into `backend/`:

**Option A — copy from CTA-Transit-PWA (fastest if you already have that repo):**
The graph is identical between the two projects. Copy either file:
```
cp ../CTA-Transit-PWA/backend/street_graph.graphml backend/
cp ../CTA-Transit-PWA/backend/street_graph_igraph.pkl backend/
```

**Option B — rebuild from OpenStreetMap (takes several minutes):**
From the `backend/` folder, run:
```
python fetch_street_graph.py
```

Either file (`street_graph.graphml` or `street_graph_igraph.pkl`) is sufficient — the backend prefers the pickle if present.

---

## Starting the Backend (Terminal 1 — Python)

Open a terminal at the repo root, then run:

```
cd backend
python -m uvicorn main:app --reload
```

**What to expect:**
- First startup takes 10–30 seconds — the server loads the street graph into memory.
- You will see log lines like `Application startup complete.` when it is ready.
- The server runs at: `http://localhost:8000`
- Health check: open `http://localhost:8000/health` in your browser — it should return `{"status":"ok"}`.
- `--reload` means the server restarts automatically whenever you save a change to a Python file.

---

## Starting the Frontend (Terminal 2 — Node)

Open a **second** terminal at the repo root, then run:

```
cd frontend
npm run dev
```

> **Note:** The `npm run dev` script runs `node ./node_modules/vite/bin/vite.js` internally.
> This is intentional — it is a workaround for the `&` character in the Windows username path.
> Do not change the `package.json` scripts.

**What to expect:**
- Starts in a few seconds.
- The app runs at: `http://localhost:5173`
- Open that URL in your browser to use the app locally.
- Vite hot-reloads the frontend automatically when you save changes to `.jsx` or `.css` files.

---

## Summary — Quick Reference

| Terminal | Command | URL |
|----------|---------|-----|
| Backend (Python) | `python -m uvicorn main:app --reload` | http://localhost:8000 |
| Frontend (Node) | `npm run dev` | http://localhost:5173 |

---

## Stopping the Servers

Press `Ctrl + C` in each terminal window to stop the server running in that window.

---

## Rebuilding the Street Graph (rare)

The street graph only needs to be regenerated if you want to change the bounding box (e.g., expand coverage beyond Chicago) or pull fresher OpenStreetMap data. Stop the backend, then from the `backend/` folder run:

```
python fetch_street_graph.py --force
```

Then restart the backend normally.
