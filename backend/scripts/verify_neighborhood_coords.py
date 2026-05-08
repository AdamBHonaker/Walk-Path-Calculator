"""
Verify each entry in `NEIGHBORHOOD_COORDS` against Google's geocoder.

Catches the kind of silent drift that produced the May-2026 batch of bad
coordinates (Green Mill, Morse, Steppenwolf, etc.): hand-entered points that
end up several blocks — or, in the worst cases, miles — from the named
landmark, and that the routing engine then faithfully delivers the user to.

Usage:
    cd backend
    python scripts/verify_neighborhood_coords.py
    python scripts/verify_neighborhood_coords.py --threshold 150  # tighter
    python scripts/verify_neighborhood_coords.py --all            # show every row
    python scripts/verify_neighborhood_coords.py --apply          # auto-fix bad entries
    python scripts/verify_neighborhood_coords.py --no-cache       # force re-verify all

Caching:
    Successfully-verified entries are recorded in
    `backend/data/verified_coords.json` (checked into git). On subsequent runs,
    an entry is skipped entirely — no network call — when its (name, lat, lon)
    triple matches the cache. Any edit to a coord, or any newly-added name,
    automatically invalidates that entry and forces a fresh geocode.

    The cache only stores entries that came back clean (within --threshold) or
    are known area centroids. Bad entries are never cached, so the hook keeps
    flagging them on every run until they're fixed.

Requires GOOGLE_MAPS_API_KEY in env (or backend/.env). The script does NOT
write to backend/geocode_cache.json — it makes its own throwaway HTTP calls so
it can't poison the production cache.

Exit code:
    0 — every entry within --threshold (or --apply rewrote them all)
    1 — at least one entry over --threshold and --apply was not passed
    2 — configuration problem (no API key, etc.)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import date
from pathlib import Path

import requests
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from geocoding import NEIGHBORHOOD_COORDS  # noqa: E402
from utils import (  # noqa: E402
    CHICAGO_BBOX_GOOGLE,
    METERS_PER_MILE,
    chicago_bbox_contains,
    haversine_miles,
)

GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"

BACKEND_ROOT = Path(__file__).resolve().parent.parent
GEOCODING_PY_PATH = BACKEND_ROOT / "geocoding.py"
VERIFIED_CACHE_PATH = BACKEND_ROOT / "data" / "verified_coords.json"

# Some entries are deliberately neighborhood / corridor centroids, not single
# addresses, so Google's reply will reasonably differ. Listing them here keeps
# the noise floor down without hiding real drift — they still appear in the
# report under their own header, just don't fail the build.
# Landmarks whose name is ambiguous within the Chicago bbox: Google's geocoder
# legitimately returns a *different* place that also matches the name. The
# stored coord is the right one for our routing graph (typically a CTA Red
# Line stop or a lakefront landmark), so we accept the drift and document the
# specific other-place Google hits below. Treated identically to area
# centroids — drift accepted, cached, no commit-block.
#   bryn mawr           — Edgewater Red Line stop; Google → "Bryn Mawr Ave"
#                         near O'Hare (still inside CHICAGO_WEST=-87.94)
#   foster avenue beach — Foster + Lake Michigan; Google → an interior stretch
#                         of Foster Ave well west of the lakefront
#   berwyn              — Andersonville Red Line stop; Google → Berwyn IL,
#                         the suburb (still inside the Chicago bbox)
KNOWN_AMBIGUOUS_NAMES: frozenset[str] = frozenset({
    "bryn mawr", "foster avenue beach", "berwyn",
})

KNOWN_AREA_CENTROIDS: frozenset[str] = frozenset({
    "rogers park", "edgewater", "andersonville", "uptown", "lincoln square",
    "ravenswood", "wrigleyville", "lakeview", "east lakeview", "boystown",
    "southport corridor", "lincoln park", "old town", "gold coast",
    "river north", "near north", "streeterville", "magnificent mile",
    "mag mile", "loop", "the loop", "downtown", "downtown chicago",
    "theater district", "south loop", "near west side", "greektown",
    "little italy", "uic", "university village", "medical district",
    "west town", "ukrainian village", "wicker park", "bucktown",
    "noble square", "east village", "logan square", "humboldt park",
    "palmer square", "avondale", "hermosa", "irving park", "mayfair",
    "north park", "west ridge", "east garfield park", "north lawndale",
    "little village", "south lawndale", "pilsen", "back of the yards",
    "mckinley park", "brighton park", "bronzeville", "douglas",
    "grand boulevard", "armour square", "bridgeport", "chinatown",
    "gallery district", "michigan avenue", "state street", "wells street",
    "chicago avenue", "printers row", "printer's row", "depaul",
    "depaul university", "loyola university",
})


# ── verified-clean cache ──────────────────────────────────────────────────

def load_verified_cache() -> dict:
    """Load the verified-coords cache. Returns {} if missing or unreadable."""
    if not VERIFIED_CACHE_PATH.exists():
        return {}
    try:
        return json.loads(VERIFIED_CACHE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"warning: could not read {VERIFIED_CACHE_PATH.name}: {exc} — "
              "starting empty", file=sys.stderr)
        return {}


def save_verified_cache(cache: dict) -> None:
    """Persist the cache. Sort keys for stable diffs in version control."""
    VERIFIED_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    VERIFIED_CACHE_PATH.write_text(
        json.dumps(cache, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def is_cached_clean(cache: dict, name: str, stored: tuple[float, float]) -> bool:
    """True if (name, stored) was verified clean on a prior run.

    The cache key is implicitly (name, stored_lat, stored_lon): any drift in
    the stored coord — even down to the 5th decimal — invalidates the entry
    and forces a fresh geocode. That way edits to NEIGHBORHOOD_COORDS are
    always re-checked while untouched rows skip the network call.
    """
    entry = cache.get(name)
    if not entry:
        return False
    return (
        abs(entry.get("lat", 0.0) - stored[0]) < 1e-6
        and abs(entry.get("lon", 0.0) - stored[1]) < 1e-6
    )


# ── Google geocoder (no caching to disk) ──────────────────────────────────

def geocode(query: str, api_key: str) -> "tuple[float, float] | str | None":
    """Direct Google geocode with the same bias the production code uses,
    but no caching to backend/geocode_cache.json. Returns a (lat, lon) tuple,
    the sentinel string "rate_limited" on 429/OVER_QUERY_LIMIT, or None on
    any other failure (including a result that lands outside the Chicago
    bbox — Google's `bounds=` is a soft bias and ambiguous queries like
    "Argyle" can return Argyle WI, which would corrupt --apply's writeback).
    """
    address = query if "chicago" in query.lower() else f"{query}, Chicago, IL"
    try:
        resp = requests.get(
            GOOGLE_GEOCODE_URL,
            params={
                "address": address,
                "key": api_key,
                "components": "country:US",
                "bounds": CHICAGO_BBOX_GOOGLE,
            },
            timeout=10,
        )
    except requests.RequestException as exc:
        print(f"  ! network error for {query!r}: {exc}", file=sys.stderr)
        return None
    if resp.status_code == 429:
        return "rate_limited"
    data = resp.json() if resp.content else {}
    status = data.get("status")
    if status == "OVER_QUERY_LIMIT":
        return "rate_limited"
    if status != "OK" or not data.get("results"):
        return None
    loc = data["results"][0]["geometry"]["location"]
    lat, lon = float(loc["lat"]), float(loc["lng"])
    if not chicago_bbox_contains(lat, lon):
        # Treat out-of-bbox replies as unresolved so --apply cannot promote
        # a wrong-city result into source code.
        print(f"  ! {query!r}: Google returned out-of-bbox coord "
              f"({lat:.4f}, {lon:.4f}) — treating as unresolved",
              file=sys.stderr)
        return None
    return lat, lon


# ── --apply: rewrite geocoding.py with Google's coords ────────────────────

def apply_fixes(
    fixes: list[tuple[str, tuple[float, float], tuple[float, float]]],
) -> int:
    """Rewrite the matching `"name": (lat, lon)` lines in geocoding.py.

    `fixes` is a list of (name, old_coord, new_coord). Returns the number of
    lines actually replaced. Logs a warning for any name that didn't match —
    that means the source line wasn't in the expected `"name": (lat, lon),`
    form and the user has to fix it by hand.
    """
    text = GEOCODING_PY_PATH.read_text(encoding="utf-8")
    replaced_total = 0
    for name, _old, new in fixes:
        # Anchor on `^\s*"name":\s*` so we don't accidentally substitute a
        # row whose name is a prefix of another (e.g., "loop" vs "the loop").
        pattern = re.compile(
            rf'(^[ \t]*"{re.escape(name)}":\s*)\([^)]+\)',
            re.MULTILINE,
        )
        new_lat, new_lon = new
        replacement = rf'\g<1>({new_lat:.4f}, {new_lon:.4f})'
        text, n = pattern.subn(replacement, text)
        if n == 0:
            print(f"  warn: --apply did not match {name!r} in geocoding.py "
                  "(unexpected formatting?)", file=sys.stderr)
        replaced_total += n
    if replaced_total > 0:
        GEOCODING_PY_PATH.write_text(text, encoding="utf-8")
    return replaced_total


# ── main ──────────────────────────────────────────────────────────────────

def main() -> int:
    # The report uses box-drawing glyphs (U+2500) and arrows; Windows
    # consoles default to cp1252 and would crash on the first non-ASCII
    # write. Reconfigure stdout/stderr to UTF-8 up-front so the pre-commit
    # hook output renders identically across platforms.
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--threshold", type=float, default=250.0,
        help="Flag entries off by more than N meters (default: 250).",
    )
    parser.add_argument(
        "--all", action="store_true",
        help="Show every entry, not just ones over the threshold.",
    )
    parser.add_argument(
        "--sleep", type=float, default=0.05,
        help="Seconds to sleep between requests (default: 0.05).",
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Rewrite geocoding.py with Google's coords for over-threshold "
             "landmark entries. Does NOT touch entries in the area-centroid "
             "list (they are intentionally hand-picked).",
    )
    parser.add_argument(
        "--no-cache", action="store_true",
        help="Re-verify every entry, ignoring backend/data/verified_coords.json.",
    )
    args = parser.parse_args()

    # Refuse --apply when invoked from a pre-commit hook. `--apply` rewrites
    # source code and any silent writeback during commit creation is the
    # exact mechanism that produced the May-2026 wrong-coords incident.
    # A human running --apply at the terminal will not have PRE_COMMIT set.
    if args.apply and os.getenv("PRE_COMMIT"):
        print("--apply is disabled inside pre-commit hooks. Run the script "
              "manually if you intend to rewrite geocoding.py.",
              file=sys.stderr)
        return 2

    load_dotenv(BACKEND_ROOT / ".env")
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
    if not api_key:
        print("GOOGLE_MAPS_API_KEY not set — set it in backend/.env or env.",
              file=sys.stderr)
        return 2

    threshold_mi = args.threshold / METERS_PER_MILE
    cache = {} if args.no_cache else load_verified_cache()
    cache_hits = 0

    over: list[tuple[str, float, tuple[float, float], tuple[float, float]]] = []
    centroid_drift: list[tuple[str, float, tuple[float, float], tuple[float, float]]] = []
    ok: list[tuple[str, float]] = []
    unresolved: list[str] = []

    total = len(NEIGHBORHOOD_COORDS)
    print(f"Verifying {total} entries against Google geocoder "
          f"(threshold: {args.threshold:.0f} m, "
          f"cache: {'off' if args.no_cache else VERIFIED_CACHE_PATH.name})\n")

    try:
        for i, (name, stored) in enumerate(NEIGHBORHOOD_COORDS.items(), 1):
            if is_cached_clean(cache, name, stored):
                cache_hits += 1
                continue

            result = geocode(name, api_key)
            if result == "rate_limited":
                print("Rate limited by Google — saving partial cache and "
                      "stopping. Re-run later or raise --sleep.",
                      file=sys.stderr)
                break
            if result is None:
                unresolved.append(name)
                print(f"[{i:3d}/{total}] {name:<35s}  no Google result")
                time.sleep(args.sleep)
                continue
            gmaps = result  # (lat, lon)
            miles = haversine_miles(stored[0], stored[1], gmaps[0], gmaps[1])
            meters = miles * METERS_PER_MILE
            marker = "  "
            if miles > threshold_mi:
                if name in KNOWN_AREA_CENTROIDS:
                    centroid_drift.append((name, miles, stored, gmaps))
                    marker = "~ "
                    # Centroid drift is acceptable — cache so we skip next time.
                    cache[name] = {
                        "lat": stored[0], "lon": stored[1],
                        "verified": str(date.today()),
                        "note": "area centroid (drift accepted)",
                    }
                elif name in KNOWN_AMBIGUOUS_NAMES:
                    centroid_drift.append((name, miles, stored, gmaps))
                    marker = "~ "
                    # Same disposition as area centroids: cache and accept.
                    # See KNOWN_AMBIGUOUS_NAMES at the top for the per-name
                    # explanation of which other location Google matches.
                    cache[name] = {
                        "lat": stored[0], "lon": stored[1],
                        "verified": str(date.today()),
                        "note": "ambiguous name (drift accepted)",
                    }
                else:
                    over.append((name, miles, stored, gmaps))
                    marker = "X "
                    # Don't cache: we want the hook to keep flagging until fixed.
            else:
                ok.append((name, miles))
                cache[name] = {
                    "lat": stored[0], "lon": stored[1],
                    "verified": str(date.today()),
                }
            if args.all or marker != "  ":
                print(f"[{i:3d}/{total}] {marker}{name:<35s}  "
                      f"stored={stored[0]:.4f},{stored[1]:.4f}  "
                      f"google={gmaps[0]:.4f},{gmaps[1]:.4f}  "
                      f"off={meters:6.0f} m")
            time.sleep(args.sleep)
    except KeyboardInterrupt:
        print("\nInterrupted — saving partial cache before exit.", file=sys.stderr)
        save_verified_cache(cache)
        return 130

    # Persist whatever we learned this run.
    save_verified_cache(cache)

    print()
    print("─" * 72)
    print(f"OK (within {args.threshold:.0f} m):     {len(ok)}")
    print(f"Cache hits (skipped):       {cache_hits}")
    print(f"Drift on area centroids:    {len(centroid_drift)} (accepted)")
    print(f"Likely-bad entries:         {len(over)}")
    print(f"No Google result:           {len(unresolved)}")
    print("─" * 72)

    if over:
        print("\nLikely-bad entries (sorted by offset, worst first):")
        over.sort(key=lambda r: -r[1])
        for name, miles, stored, gmaps in over:
            print(f"  {name:<35s}  off={miles*METERS_PER_MILE:6.0f} m  "
                  f"stored=({stored[0]:.4f}, {stored[1]:.4f})  "
                  f"google=({gmaps[0]:.4f}, {gmaps[1]:.4f})")

    if centroid_drift and args.all:
        print("\nArea-centroid entries with drift (expected — neighborhoods "
              "aren't points):")
        centroid_drift.sort(key=lambda r: -r[1])
        for name, miles, stored, gmaps in centroid_drift:
            print(f"  {name:<35s}  off={miles*METERS_PER_MILE:6.0f} m")

    if unresolved:
        print("\nUnresolved (Google returned no result — usually fine for "
              "obscure landmarks, but worth a sanity check):")
        for name in unresolved:
            print(f"  {name}")

    # --apply: rewrite the bad rows and update the cache so the next run is clean.
    if args.apply and over:
        print()
        print(f"--apply: rewriting {len(over)} entries in {GEOCODING_PY_PATH.name}...")
        fixes = [(name, stored, gmaps) for name, _miles, stored, gmaps in over]
        n_replaced = apply_fixes(fixes)
        print(f"Rewrote {n_replaced} line(s).")
        if n_replaced > 0:
            # Cache the corrected coords so they don't get re-verified next run.
            for name, _stored, gmaps in fixes[:n_replaced]:
                cache[name] = {
                    "lat": round(gmaps[0], 4),
                    "lon": round(gmaps[1], 4),
                    "verified": str(date.today()),
                    "note": "auto-applied via --apply",
                }
            save_verified_cache(cache)
            print("Cache updated. Re-stage geocoding.py and re-run the commit.")
        return 0 if n_replaced == len(over) else 1

    return 1 if over else 0


if __name__ == "__main__":
    raise SystemExit(main())
