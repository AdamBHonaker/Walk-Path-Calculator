# CTA Transit PWA — Local Test Startup Instructions

You need **two terminal windows open at the same time**: one for the backend (Python), one for the frontend (Node). Both must be running simultaneously for the app to work.

---

## Prerequisites (first-time setup only)

### Backend
1. Make sure Python 3.12 is installed.
2. From the `backend/` folder, install dependencies:
   ```
   pip install -r requirements.txt
   ```
3. Make sure `backend/.env` exists with your API keys:
   ```
   CTA_TRAIN_API_KEY=your_key_here
   CTA_BUS_API_KEY=your_key_here
   ANTHROPIC_API_KEY=your_key_here
   GOOGLE_MAPS_API_KEY=your_key_here
   ```
   > `GOOGLE_MAPS_API_KEY` is required for geocoding addresses and landmarks. See `HUMAN_TODO.md` for instructions on obtaining it.

### Frontend
1. Make sure Node.js is installed.
2. From the `frontend/` folder, install dependencies (only needed once, or after pulling new changes):
   ```
   npm install
   ```

### Data files (first-time or after re-downloading)
The GTFS data is large and gitignored — it lives only on your local machine. If it is missing, run this **from the `backend/` folder** before starting the server:

```
python fetch_gtfs.py
```

- `fetch_gtfs.py` downloads CTA GTFS static data (~354 MB) to `backend/gtfs_data/`
- The OSMnx street graph (`backend/street_graph.graphml`) is **pre-built and committed to the repo via Git LFS** — it downloads automatically with `git pull` and does **not** need to be regenerated. Only run `python fetch_street_graph.py` if you need to rebuild it with a different bounding box.
- GTFS download takes a few minutes. Run it once; re-run only when you want fresh CTA schedule data.

---

## Starting the Backend (Terminal 1 — Python)

Open a terminal, navigate to the `backend/` folder, and run:

```
cd "C:\Users\Adam & Serena\OneDrive\Documents\GitHub\CTA-Transit-PWA\backend"
python -m uvicorn main:app --reload
```

**What to expect:**
- First startup takes 30–90 seconds — the server loads GTFS data and the street graph into memory.
- You will see log lines like `Application startup complete.` when it is ready.
- The server runs at: `http://localhost:8000`
- Health check: open `http://localhost:8000/health` in your browser — it should return `{"status":"ok"}`.
- `--reload` means the server restarts automatically whenever you save a change to a Python file.

---

## Starting the Frontend (Terminal 2 — Node)

Open a **second** terminal, navigate to the `frontend/` folder, and run:

```
cd "C:\Users\Adam & Serena\OneDrive\Documents\GitHub\CTA-Transit-PWA\frontend"
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

## Updating CTA Data (as needed)

If CTA publishes a new GTFS feed or you want fresh schedule data, stop the backend and run:

```
cd "C:\Users\Adam & Serena\OneDrive\Documents\GitHub\CTA-Transit-PWA\backend"
python fetch_gtfs.py
```

Then restart the backend normally. The street graph does **not** need to be re-downloaded — it is stored in Git LFS.
