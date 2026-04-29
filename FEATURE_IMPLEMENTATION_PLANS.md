# Feature Plans & Future Enhancements

Chunked plans for upcoming major features, followed by ideas deferred until post-launch. For chunked features, work through each chunk in order, one chunk per session or per commit. Do not start a chunk until all previous chunks are complete.

> **Process:** When a feature here is fully implemented, **delete its entry from this file** and add a corresponding entry to [`FEATURES_IMPLEMENTED_HISTORY.md`](FEATURES_IMPLEMENTED_HISTORY.md) summarizing what was built. This file should only ever contain features that have not yet been implemented.

---

## Feature Index

**Bolt-On** = self-contained, no dependencies on other planned features.
**Structural** = depends on one or more other features before it can be fully built or realized.

**Chunked Implementation Plans** (in document order):

| # | Feature | Type | Effort |
|---|---------|------|--------|
| 1 | Swap Origin / Destination Button | Bolt-On | Low |
| 2 | URL-Encoded Route Sharing | Bolt-On | Low |
| 3 | Custom Daily Step Goal | Bolt-On | Low |
| 4 | Weight Input for Calories | Bolt-On | Low |
| 5 | Pace Customization | Bolt-On | Low |
| 6 | Recent Searches | Bolt-On | Low |
| 7 | Calorie Equivalents | Bolt-On | Low |
| 8 | Animated Route Drawing | Bolt-On | Low–Medium |
| 9 | Highlighted Turn Points on Map | Bolt-On | Medium |
| 10 | Copy Directions as Plain Text | Bolt-On | Low |
| 11 | Shareable Route Card | Bolt-On | Medium |
| 12 | Click Map to Set Origin / Destination | Structural | Medium |
| 13 | Multi-Day Step Accumulator | Bolt-On | Medium |
| 14 | Neighborhood Explorer (Isochrone) | Structural | High |
| 15 | Alternative Routes | Structural | High |
| 16 | Waypoints / Multi-Stop Routes | Structural | High |
| 17 | Multi-City Support | Structural | Very High |

---

# Chunked Implementation Plans

---

## 1. Swap Origin / Destination Button
**Type:** Bolt-On | **Effort:** Low | **Area:** Frontend

A single button between the From/To inputs that swaps the values of `origin` and `destination` in component state. No backend changes needed.

**Chunks:**
1. Add a swap button element (↕ icon) between the two `<label>` inputs in [frontend/src/App.jsx](frontend/src/App.jsx).
2. Wire an `onClick` handler that calls `setOrigin(destination)` and `setDestination(origin)` in one update cycle.
3. Style the button to sit flush between the two fields without disrupting the form layout.

---

## 2. URL-Encoded Route Sharing
**Type:** Bolt-On | **Effort:** Low | **Area:** Frontend

Encode `origin`, `destination`, and optionally `heightFt`/`heightIn` as URL query params so routes are bookmarkable and shareable. When the page loads with these params present, pre-populate the form and auto-submit.

**Chunks:**
1. On successful route fetch, call `history.replaceState` (or React Router's equivalent) to write `?from=…&to=…` into the URL.
2. On mount, read `URLSearchParams` and pre-fill `origin`, `destination`, and height state from them.
3. If all required params are present on mount, auto-submit the form after a brief tick so the map populates immediately.

---

## 3. Custom Daily Step Goal
**Type:** Bolt-On | **Effort:** Low | **Area:** Frontend + Backend

Replace the hardcoded `10_000` daily goal with a user-configurable value stored in `localStorage`. The goal is sent to the backend as an optional field so `daily_goal_pct` is computed correctly.

**Chunks:**
1. Add an optional `daily_goal` integer field to `RouteRequest` in [backend/main.py](backend/main.py); default to `10_000` if omitted.
2. Pass `daily_goal` through to `daily_goal_pct()` in [backend/steps.py](backend/steps.py) (the parameter already exists there).
3. Add a "Set goal" UI element (collapsed by default, similar to the height section) in the frontend that reads/writes to `localStorage` and includes the value in the fetch body.

---

## 4. Weight Input for Calories
**Type:** Bolt-On | **Effort:** Low | **Area:** Frontend + Backend

The calorie formula in [backend/steps.py](backend/steps.py) uses a fixed 70 kg reference weight. Expose an optional weight field so the output is as personalized as the step count.

**Chunks:**
1. Add `weight_kg: float | None` (with a sane validation range, e.g. 30–300 kg) to `RouteRequest` in [backend/main.py](backend/main.py).
2. Update `calories_from_minutes()` in [backend/steps.py](backend/steps.py) to accept an optional weight parameter and scale the MET calculation accordingly.
3. Add a weight input to the frontend's optional-fields section (alongside height). Support lb → kg conversion on the frontend before sending.
4. Display "personalized" wording next to the calorie stat when a weight was provided.

---

## 5. Pace Customization
**Type:** Bolt-On | **Effort:** Low | **Area:** Frontend + Backend

`WALKING_SPEED_MPH` is already a named constant in [backend/walking.py](backend/walking.py). Expose "Leisurely (2 mph) / Normal (3 mph) / Brisk (4 mph)" as a frontend option; pass the chosen speed as a request field and let the pipeline recalculate distance, steps, calories, and minutes.

**Chunks:**
1. Add `pace: str | None` (values: `"leisurely"`, `"normal"`, `"brisk"`) to `RouteRequest`; map to mph values in [backend/main.py](backend/main.py).
2. Thread the chosen speed through `walk_minutes`, `walk_path`, and `walk_directions` calls (or recalculate from the raw graph distances).
3. Add a three-button pace selector to the frontend form. Persist the selection to `localStorage`.

---

## 6. Recent Searches
**Type:** Bolt-On | **Effort:** Low | **Area:** Frontend

Persist the last 5–10 successful searches (origin + destination pairs) to `localStorage`. Show them as quick-pick chips below the form so repeat routes are one tap.

**Chunks:**
1. After a successful fetch, write `{ origin, destination, timestamp }` to a `localStorage` array (capped at 10 entries, newest first).
2. Render a "Recent routes" list below the form inputs; each entry fills origin/destination and submits on click.
3. Add a "Clear history" affordance.

---

## 7. Calorie Equivalents
**Type:** Bolt-On | **Effort:** Low | **Area:** Frontend

Below the calorie stat in `StepHero`, surface a friendly food comparison such as "≈ 1 banana" or "≈ half a slice of pizza". Pure frontend — no backend changes needed.

**Chunks:**
1. Define a static lookup table of food items with approximate calorie counts (banana ≈ 90 cal, slice of pizza ≈ 300 cal, etc.) in [frontend/src/App.jsx](frontend/src/App.jsx).
2. Write a `calorieEquivalent(calories)` helper that picks the closest single-item or fractional comparison.
3. Render the result as a small caption line beneath the `🔥 ~{calories} cal` chip in `StepHero`.

---

## 8. Animated Route Drawing
**Type:** Bolt-On | **Effort:** Low–Medium | **Area:** Frontend

When a new route result loads, draw the green path progressively from origin to destination instead of rendering it all at once. MapLibre supports line-dasharray animation natively.

**Chunks:**
1. After adding the `walk-path-line` layer, compute the total path length and animate a moving `line-dasharray` offset using `requestAnimationFrame`.
2. Cancel any in-progress animation when a new result arrives or the component unmounts.
3. Ensure the animation does not block the map from being interactable (markers should appear immediately; only the line animates).

---

## 9. Highlighted Turn Points on Map
**Type:** Bolt-On | **Effort:** Medium | **Area:** Frontend

Place a small circle marker at each turn from the directions list. Clicking a direction item in the list pans/zooms the map to that turn.

**Chunks:**
1. Collect the coordinates of each turn from the `path` array using cumulative distance matching against `directions[].distance_miles`.
2. Add a GeoJSON source + symbol/circle layer for turn markers in [frontend/src/MapView.jsx](frontend/src/MapView.jsx), accepting the enriched directions as a prop.
3. In `DirectionList`, fire a callback prop (e.g. `onStepClick(index)`) when a direction item is clicked; `MapView` reacts by flying to that coordinate.

---

## 10. Copy Directions as Plain Text
**Type:** Bolt-On | **Effort:** Low | **Area:** Frontend

A single "Copy" button in the directions section that writes a formatted plain-text directions list to the clipboard — useful for pasting into a message or notes app.

**Chunks:**
1. Write a `formatDirectionsText(directions, result)` function that produces a header line (miles, minutes, steps) followed by numbered turn-by-turn steps.
2. Add a "Copy directions" button to `DirectionList` that calls `navigator.clipboard.writeText(...)` and briefly shows "Copied!" confirmation.

---

## 11. Shareable Route Card
**Type:** Bolt-On | **Effort:** Medium | **Area:** Frontend

A styled summary card (key stats + mini-map thumbnail) that the user can screenshot or share. Could be a dedicated `/share` route that renders a stripped-down card view.

**Chunks:**
1. Create a `RouteCard` component that displays origin → destination, miles, minutes, steps, calories, and a static map snapshot.
2. Add a `/share` route (or modal overlay) that renders `RouteCard` in isolation so it screenshots cleanly.
3. Add a "Share / Save image" button to `StepHero` that opens the card view or uses `html2canvas` to generate a PNG for download.

---

## 12. Click Map to Set Origin / Destination
**Type:** Structural | **Effort:** Medium | **Area:** Frontend + Backend

Allow the user to click anywhere on the map to drop a pin, which is then reverse-geocoded and placed into the From or To field. Requires a reverse-geocoding endpoint.

**Chunks:**
1. Add a `GET /reverse-geocode?lat=…&lon=…` endpoint to [backend/main.py](backend/main.py) that calls Google's reverse geocoding API and returns a human-readable address.
2. Enable map click events in [frontend/src/MapView.jsx](frontend/src/MapView.jsx) when not in locked mode; emit the clicked `[lat, lon]` via a callback prop.
3. Add UI to indicate which field (From or To) the next map click will populate (e.g., a toggle button "Set origin" / "Set destination").
4. Call the reverse-geocode endpoint on click and fill the appropriate field; show the raw coordinates as a fallback if reverse-geocoding fails.

---

## 13. Multi-Day Step Accumulator
**Type:** Bolt-On | **Effort:** Medium | **Area:** Frontend

Let users log completed routes to `localStorage` and show a running weekly step total against their daily goal. No backend required.

**Chunks:**
1. Add a "Log this walk" button that appears after a successful route fetch; it saves `{ date, steps, miles, origin, destination }` to a `localStorage` log array.
2. Build a weekly summary panel (collapsible) that reads the log and shows total steps, total miles, and a progress bar toward `7 × daily_goal`.
3. Auto-expire log entries older than 7 days on mount.

---

## 14. Neighborhood Explorer (Isochrone)
**Type:** Structural | **Effort:** High | **Area:** Backend + Frontend

Given a start location and a time budget, return all destinations reachable on foot within that time. Useful for "where can I walk in 20 minutes from here?"

**Chunks:**
1. Add a `POST /explore` endpoint that accepts `{ origin, max_minutes, height_inches? }` and runs a Dijkstra expansion from the origin node up to `max_minutes` of walk time.
2. Return a GeoJSON polygon (convex hull or concave hull) of the reachable area, plus a list of named neighborhoods within it.
3. Add an "Explore from here" mode to the frontend — replaces the To field with a time slider; renders the reachable zone as a shaded polygon on the map.
4. List the reachable named neighborhoods from `NEIGHBORHOOD_COORDS` inside the shaded area as clickable chips that auto-fill the destination.

---

## 15. Alternative Routes
**Type:** Structural | **Effort:** High | **Area:** Backend + Frontend

Return 2–3 route options (e.g., fastest, most park-adjacent, fewest turns) so users can choose a preferred path.

**Chunks:**
1. Research and implement a k-shortest-paths algorithm (e.g., Yen's algorithm) on top of the existing igraph/NetworkX graph in [backend/walking.py](backend/walking.py).
2. Define route "flavors" (shortest time, fewest turns, greenest streets) and implement scoring/filtering logic.
3. Update `POST /route` to return an array of route options, each with its own `path`, `directions`, and summary stats.
4. Add a route-picker UI to the frontend — tabs or cards showing each alternative; selecting one swaps the active path on the map.

---

## 16. Waypoints / Multi-Stop Routes
**Type:** Structural (depends on Alternative Routes infrastructure) | **Effort:** High | **Area:** Backend + Frontend

Chain multiple legs together — e.g., home → coffee shop → park — summing steps and calories across all stops.

**Chunks:**
1. Update `RouteRequest` to accept an array of stops (`stops: list[str]`, min 2) in addition to or replacing `origin`/`destination`.
2. Resolve each stop, compute legs sequentially with `walk_path` / `walk_directions`, and concatenate paths and directions.
3. Return per-leg breakdowns plus totals in the response.
4. Add "Add stop" / "Remove stop" controls to the frontend form, rendering each stop as a draggable chip for reordering.
5. Show leg boundaries (start-of-leg markers and sub-totals) in both the directions list and on the map.

---

## 17. Multi-City Support
**Type:** Structural | **Effort:** Very High | **Area:** Backend + Frontend

The CLAUDE.md explicitly flags this as the stated long-term goal ("one city per game piece"). Each city has its own pre-built street graph; the user picks a city and all routing runs against that graph.

**Chunks:**
1. Refactor [backend/walking.py](backend/walking.py) and [backend/main.py](backend/main.py) to support loading multiple named graphs (keyed by city slug, e.g. `"chicago"`, `"nyc"`).
2. Build or source a second city street graph (OSMnx, same pipeline used for Chicago).
3. Create a city-specific `NEIGHBORHOOD_COORDS` dict and geocoding config for the new city.
4. Add a `city: str` field to `RouteRequest`; route the request to the correct graph and geocoder.
5. Add a city-picker UI to the frontend header (replacing or extending the static "📍 Chicago, IL" pill). Persist the selection to `localStorage`.
6. Generalize the map default center/zoom to match the selected city.

---