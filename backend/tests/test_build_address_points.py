"""Tests for the partial-fetch guard in build_address_points.py (BUG-001).

These exercise main()'s response to per-chunk Overpass failures: by
default a single failed chunk must abort with exit 1 (no DELETE on the
addresses table); --allow-partial restores the legacy overwrite behavior
for the operator who genuinely wants a partial dataset.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

# Same sys.path dance as test_cdp_client.py so the script is importable.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR))
sys.path.insert(0, str(_BACKEND_DIR / "scripts"))

import _geocode_db  # noqa: E402
import build_address_points as bap  # noqa: E402


def _fake_element(housenumber: str, street: str, lat: float, lon: float) -> dict:
    return {
        "type": "node",
        "lat": lat,
        "lon": lon,
        "tags": {"addr:housenumber": housenumber, "addr:street": street},
    }


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """Route every connect() in build_address_points to a tmp_path sqlite."""
    db_path = tmp_path / "chicago_geocode.db"
    real_connect = _geocode_db.connect

    def fake_connect():
        return real_connect(db_path)

    monkeypatch.setattr(bap, "connect", fake_connect)
    return db_path


def _run_main(monkeypatch, argv_tail: list[str]) -> int:
    monkeypatch.setattr(sys, "argv", ["build_address_points.py", *argv_tail])
    return bap.main()


class TestPartialFetchGuard:
    def test_clean_run_writes_rows(self, monkeypatch, tmp_db):
        # All chunks succeed → exit 0, table populated.
        monkeypatch.setattr(
            bap, "_fetch_chunk",
            lambda bbox: [_fake_element("100", "W Madison St", 41.881, -87.628)],
        )
        exit_code = _run_main(monkeypatch, ["--grid", "1", "--sleep", "0"])
        assert exit_code == 0

        with sqlite3.connect(tmp_db) as conn:
            (count,) = conn.execute("SELECT COUNT(*) FROM addresses").fetchone()
        assert count == 1

    def test_failed_chunk_aborts_without_writing(self, monkeypatch, tmp_db):
        # Default: any chunk failure aborts before DELETE/INSERT runs.
        seed_calls: list[str] = []

        def fake_fetch(_bbox):
            seed_calls.append("called")
            raise RuntimeError("transient 504")

        monkeypatch.setattr(bap, "_fetch_chunk", fake_fetch)

        connect_calls: list[str] = []
        original_connect = bap.connect

        def tracking_connect():
            connect_calls.append("opened")
            return original_connect()

        monkeypatch.setattr(bap, "connect", tracking_connect)

        exit_code = _run_main(monkeypatch, ["--grid", "1", "--sleep", "0"])
        assert exit_code == 1
        assert seed_calls == ["called"]
        # Critical invariant: the SQLite connection must never be opened on
        # the failure path, so the DELETE FROM addresses block is unreachable.
        assert connect_calls == []

    def test_allow_partial_writes_partial_rows(self, monkeypatch, tmp_db):
        # Half the chunks fail, but --allow-partial opts in to the overwrite.
        call_count = {"n": 0}

        def fake_fetch(_bbox):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("transient 504")
            return [_fake_element("200", "N Clark St", 41.91, -87.63)]

        monkeypatch.setattr(bap, "_fetch_chunk", fake_fetch)

        exit_code = _run_main(
            monkeypatch, ["--grid", "2", "--sleep", "0", "--allow-partial"],
        )
        assert exit_code == 0

        with sqlite3.connect(tmp_db) as conn:
            (count,) = conn.execute("SELECT COUNT(*) FROM addresses").fetchone()
        # 4 chunks total (2x2 grid), 1 failed, 3 successful → 3 raw rows,
        # dedup leaves the unique normalized address (same fake row each time).
        assert count == 1
