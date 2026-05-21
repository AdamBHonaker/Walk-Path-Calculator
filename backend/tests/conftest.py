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
# `main` is imported anywhere — TestClient shares a single host string, so the
# explore-heavy modules would otherwise burn through the per-minute /explore
# limit and 429 the remaining tests.
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


import os as _os


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "requires_artifact(name): mark test as requiring a runtime artifact; "
        "skips locally when absent, fails in CI (CI=true).",
    )


def pytest_runtest_setup(item):
    for marker in item.iter_markers("requires_artifact"):
        artifact_name = marker.args[0] if marker.args else None
        if not artifact_name:
            continue
        path = Path(__file__).resolve().parent.parent / artifact_name
        if not path.exists():
            in_ci = _os.getenv("CI", "").lower() in ("true", "1", "yes")
            if in_ci:
                pytest.fail(
                    f"Required artifact '{artifact_name}' not found at {path}. "
                    "Fetch it before running in CI.",
                    pytrace=False,
                )
            else:
                pytest.skip(f"Artifact '{artifact_name}' not present — skipping locally.")
