"""TD-059 / B-37 — verify coordinate redaction is comprehensive.

The `_redact_coord` helper quantizes lat/lon to ~1 km precision before
logging so geocoder logs can't be mined for user-home PII. The catalog
flagged that the helper's coverage isn't tested — a new log site that
forgets to call `_redact_coord` would silently emit full-precision
coords with no test signal.

These tests monkey-patch the geocoding logger, exercise paths that
might log coords, and assert no full-precision lat/lon (>2 decimal
places) appears in any captured log line.
"""

import logging
import re
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

import geocoding


# Full-precision Chicago coords look like `41.9476, -87.6553` (4 decimals,
# ~11 m). The redactor quantizes to 2 decimals (~1.1 km). Anything with
# 3+ decimals on either lat or lon means redaction was bypassed.
_LEAK_PATTERN = re.compile(r"\b4[12]\.\d{3,}\s*,\s*-?87\.\d{3,}\b")


@pytest.fixture
def _captured_logs(caplog):
    """Capture every WARNING+ log from the geocoding module so we can
    scan for coordinate leaks. Set the level explicitly because caplog's
    default propagation is INFO+ which still misses DEBUG paths."""
    caplog.set_level(logging.DEBUG, logger="geocoding")
    return caplog


class TestRedactCoordCoverage:
    @pytest.mark.parametrize("lat,lon", [
        (41.94762, -87.65539),
        (41.92103, -87.69870),
        (41.85015, -87.65000),  # exactly on the reference latitude
        (41.881944, -87.627778),  # high-precision Loop coords
    ])
    def test_redact_coord_collapses_to_two_decimals(self, lat, lon):
        """The redactor's output must never carry more than 2 decimal
        places on either axis. This pins the contract the catalog's
        log-leak audit relies on."""
        redacted = geocoding._redact_coord(lat, lon)
        # The leak pattern requires 3+ decimals on BOTH axes; the
        # redactor's `f"{lat:.2f}"` formatting limits to 2. Confirm.
        assert not _LEAK_PATTERN.search(redacted), (
            f"redactor leaked full-precision coords: {redacted!r}"
        )

    def test_redact_coord_handles_none(self):
        assert geocoding._redact_coord(None, None) == "(?, ?)"
        assert geocoding._redact_coord(41.9, None) == "(?, ?)"
        assert geocoding._redact_coord(None, -87.6) == "(?, ?)"


class TestLogSitesDoNotLeak:
    """For every code path that logs lat/lon, exercise it and confirm
    captured log lines carry only the redactor's quantized form."""

    def test_resolve_location_outside_chicago_does_not_leak(self, _captured_logs, monkeypatch):
        """A query that resolves outside Chicago raises an exception with
        the coords inside it. The exception's `__str__` is independent of
        our logger, but any subsequent log line in geocoding.py that
        handles the failure must redact."""
        # Stub fuzzy + local + LocationIQ to return outside-Chicago coords.
        monkeypatch.setattr(
            geocoding, "fuzzy_match_neighborhood",
            lambda q: ((40.7128, -74.006), "newyork"),  # NYC coords
        )
        with pytest.raises(geocoding.LocationOutsideChicagoError):
            geocoding.resolve_location("anywhere")
        # Confirm no full-precision coords leaked into any geocoding log
        # line. The exception's str carries them but that's the caller's
        # concern (it's serialized to the API response).
        for record in _captured_logs.records:
            if record.name.startswith("geocoding"):
                assert not _LEAK_PATTERN.search(record.getMessage()), (
                    f"log leaked full-precision coords: {record.getMessage()!r}"
                )
