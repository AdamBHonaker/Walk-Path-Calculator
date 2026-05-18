"""
Shared SQLite schema + helpers for backend/data/chicago_geocode.db.

The database holds four tables used by the local-first geocoder cascade:

  addresses        Every Chicago street address from OSM Overpass.
                   Searched via addresses_fts (FTS5) for autocomplete.

  intersections    Cross-streets derived from street_graph_igraph.pkl.
                   One row per node where two or more named streets meet.
                   Searched via intersections_fts (FTS5).

  cached_forward   Runtime LocationIQ hits (positive + negative). Initially
                   seeded from the legacy `backend/geocode_cache.json` by a
                   one-shot run of `migrate_geocode_cache.py`; that JSON
                   file is now `.deprecated` and read by nothing.

  cached_reverse   Runtime LocationIQ reverse hits. Same one-shot seed
                   path as cached_forward (legacy `rev:LAT,LON` entries
                   migrated, then ignored).

Each ingestion script (`build_intersections.py`, `build_address_points.py`,
`migrate_geocode_cache.py`) imports `connect()` from this module, which
opens the DB and applies the schema idempotently. Scripts can run in any
order, independently.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Re-exported so existing build scripts can keep importing the normalize
# helpers from `scripts._geocode_db`.
from geocode_text import normalize_address, normalize_street_name  # noqa: F401, E402

DB_PATH: Path = Path(__file__).resolve().parent.parent / "data" / "chicago_geocode.db"

# Plain (non-content-linked) FTS5 tables so each ingestion script can write
# to its base table and the FTS shadow in a single transaction without
# trigger maintenance. The duplicated `normalized` text adds a few MB but
# keeps the build scripts trivially correct.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS addresses (
    id          INTEGER PRIMARY KEY,
    normalized  TEXT    NOT NULL,
    raw         TEXT    NOT NULL,
    lat         REAL    NOT NULL,
    lon         REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_addresses_normalized ON addresses(normalized);

CREATE VIRTUAL TABLE IF NOT EXISTS addresses_fts USING fts5(
    normalized, tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS intersections (
    id      INTEGER PRIMARY KEY,
    name_a  TEXT    NOT NULL,
    name_b  TEXT    NOT NULL,
    raw_a   TEXT    NOT NULL,
    raw_b   TEXT    NOT NULL,
    lat     REAL    NOT NULL,
    lon     REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intersections_ab ON intersections(name_a, name_b);

CREATE VIRTUAL TABLE IF NOT EXISTS intersections_fts USING fts5(
    name_a, name_b, tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS cached_forward (
    query       TEXT    PRIMARY KEY,
    lat         REAL,
    lon         REAL,
    source      TEXT    NOT NULL,
    fetched_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cached_reverse (
    lat_q       INTEGER NOT NULL,
    lon_q       INTEGER NOT NULL,
    label       TEXT    NOT NULL,
    source      TEXT    NOT NULL,
    fetched_at  INTEGER NOT NULL,
    PRIMARY KEY (lat_q, lon_q)
);
"""


def connect(db_path: Path = DB_PATH) -> sqlite3.Connection:
    """Open the geocode DB, apply the schema if missing, and return the connection."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(_SCHEMA)
    conn.commit()
    return conn


