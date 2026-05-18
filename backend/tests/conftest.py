"""
Shared pytest fixtures for the backend suite.

The session-level fixture clears `LOCATIONIQ_API_KEY` for the entire test
run. Without it, a developer with a real key in `backend/.env` would see
otherwise-passing tests turn into real LocationIQ requests — sometimes
returning a "best effort" coordinate for queries the suite expects to
miss (e.g. `test_unknown_origin_rejected`). Individual breaker tests opt
back in with their own `monkeypatch.setattr(geocoding, "_LOCATIONIQ_API_KEY", "test-key")`.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Disable the per-IP rate limiter for the whole suite. Must be set before
# `main` is imported anywhere — TestClient shares a single host string so the
# explore tests (15 calls in one module) would otherwise burn through the
# 10/min /explore limit on the 11th call and 429 the remaining tests.
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")


@pytest.fixture(autouse=True, scope="session")
def _clear_external_geocoder_key():
    """Force LOCATIONIQ_API_KEY="" so geocode_external never actually calls
    the network during the test session."""
    import geocoding
    saved = geocoding._LOCATIONIQ_API_KEY
    geocoding._LOCATIONIQ_API_KEY = ""
    os.environ.pop("LOCATIONIQ_API_KEY", None)
    yield
    geocoding._LOCATIONIQ_API_KEY = saved
