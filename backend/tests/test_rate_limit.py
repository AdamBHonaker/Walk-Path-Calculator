"""TD-056 / B-35 — the rate limiter has been historically untested because
conftest.py globally disables it (so endpoint tests don't get throttled
under a single-host TestClient). This module deliberately re-enables the
limiter via env var + module reload and drives a 429.

Kept in a dedicated file so the module-reload trick stays scoped — the
rest of the suite continues to run with the limiter disabled per
conftest's default.
"""

import importlib
import os
import sys

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def _rate_limited_app():
    """Reload main with `RATE_LIMIT_ENABLED=true`, hand back a TestClient.

    Note: the per-endpoint @limiter.limit decorators are applied at
    module-import time, so we reimport main to rebuild the app with the
    limiter actually wired. Restoring the prior env var + reverting the
    module-level cached app happens in teardown so subsequent test
    modules don't inherit the rate-limited state.
    """
    prior_env = os.environ.get("RATE_LIMIT_ENABLED")
    prior_main = sys.modules.pop("main", None)
    os.environ["RATE_LIMIT_ENABLED"] = "true"
    try:
        main = importlib.import_module("main")
        yield TestClient(main.app)
    finally:
        # Restore env first so the next reload sees the original value.
        if prior_env is None:
            os.environ.pop("RATE_LIMIT_ENABLED", None)
        else:
            os.environ["RATE_LIMIT_ENABLED"] = prior_env
        # Drop the rate-limited main; re-import on the next test pickup.
        sys.modules.pop("main", None)
        if prior_main is not None:
            sys.modules["main"] = prior_main


class TestRateLimitFires:
    """The limiter exists; conftest disables it for general tests; this
    test confirms the wiring works when enabled (B-35 — limiter was
    historically untested)."""

    def test_health_unlimited_does_not_429(self, _rate_limited_app):
        """The /health endpoint has no @limiter.limit decorator. Hit it
        20 times to confirm un-limited endpoints don't trip the limiter
        from an adjacent test's bucket pollution."""
        for _ in range(20):
            resp = _rate_limited_app.get("/health")
            assert resp.status_code == 200

    def test_route_limit_returns_429_after_burst(self, _rate_limited_app):
        """POST /route has a 30/minute rate limit. A 31-request burst from
        the same TestClient peer should produce at least one 429 before
        the minute window resets."""
        seen_429 = False
        # Send 35 requests to leave room for slop in slowapi's window
        # bookkeeping. Each call is intentionally a known-bad payload
        # (no resolved stops in Chicago) so we don't spin up real routes
        # — the rate limiter fires before the handler logic anyway.
        bad_body = {"origin": "zzz_nope_xyzzy", "destination": "Logan Square"}
        for _ in range(35):
            resp = _rate_limited_app.post("/route", json=bad_body)
            if resp.status_code == 429:
                seen_429 = True
                break
        assert seen_429, "rate limiter should have fired within 35 requests against the 30/min budget"
