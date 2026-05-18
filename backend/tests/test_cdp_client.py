"""Tests for the shared Chicago Data Portal client used by curated build scripts."""

from __future__ import annotations

import base64
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

# Same sys.path dance as the other tests so `scripts._cdp_client` is importable.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR))
sys.path.insert(0, str(_BACKEND_DIR / "scripts"))

import _cdp_client  # noqa: E402


class TestCredentials:
    def test_missing_key_id_raises(self, monkeypatch):
        monkeypatch.setenv("CHICAGO_DATA_PORTAL_API_KEY_ID", "")
        monkeypatch.setenv("CHICAGO_DATA_PORTAL_API_KEY_SECRET", "secret")
        monkeypatch.setenv("CDP_API_ENDPOINT_LIBRARIES", "https://example/resource/abc.json")
        with pytest.raises(RuntimeError, match="CHICAGO_DATA_PORTAL_API_KEY_ID"):
            _cdp_client.fetch_rows("CDP_API_ENDPOINT_LIBRARIES")

    def test_missing_key_secret_raises(self, monkeypatch):
        monkeypatch.setenv("CHICAGO_DATA_PORTAL_API_KEY_ID", "id")
        monkeypatch.setenv("CHICAGO_DATA_PORTAL_API_KEY_SECRET", "")
        monkeypatch.setenv("CDP_API_ENDPOINT_LIBRARIES", "https://example/resource/abc.json")
        with pytest.raises(RuntimeError, match="CHICAGO_DATA_PORTAL_API_KEY_SECRET"):
            _cdp_client.fetch_rows("CDP_API_ENDPOINT_LIBRARIES")


class TestEndpoint:
    def test_missing_endpoint_env_raises(self, monkeypatch):
        monkeypatch.setenv("CHICAGO_DATA_PORTAL_API_KEY_ID", "id")
        monkeypatch.setenv("CHICAGO_DATA_PORTAL_API_KEY_SECRET", "secret")
        monkeypatch.delenv("CDP_API_ENDPOINT_LIBRARIES", raising=False)
        with pytest.raises(RuntimeError, match="CDP_API_ENDPOINT_LIBRARIES"):
            _cdp_client.fetch_rows("CDP_API_ENDPOINT_LIBRARIES")

    def test_blank_endpoint_env_raises(self, monkeypatch):
        monkeypatch.setenv("CHICAGO_DATA_PORTAL_API_KEY_ID", "id")
        monkeypatch.setenv("CHICAGO_DATA_PORTAL_API_KEY_SECRET", "secret")
        monkeypatch.setenv("CDP_API_ENDPOINT_LIBRARIES", "   ")
        with pytest.raises(RuntimeError, match="CDP_API_ENDPOINT_LIBRARIES"):
            _cdp_client.fetch_rows("CDP_API_ENDPOINT_LIBRARIES")


class TestFetchRows:
    def test_sends_basic_auth_and_limit(self, monkeypatch):
        monkeypatch.setenv("CHICAGO_DATA_PORTAL_API_KEY_ID", "id123")
        monkeypatch.setenv("CHICAGO_DATA_PORTAL_API_KEY_SECRET", "shh")
        monkeypatch.setenv(
            "CDP_API_ENDPOINT_LIBRARIES",
            "https://data.cityofchicago.org/resource/x8fc-8rcq.json",
        )
        captured: dict = {}

        def fake_get(url, params=None, headers=None, timeout=None):
            captured["url"] = url
            captured["params"] = params
            captured["headers"] = headers
            captured["timeout"] = timeout
            resp = Mock()
            resp.status_code = 200
            resp.raise_for_status = lambda: None
            resp.json = lambda: [{"id": 1}, {"id": 2}]
            return resp

        monkeypatch.setattr(_cdp_client.requests, "get", fake_get)

        rows = _cdp_client.fetch_rows("CDP_API_ENDPOINT_LIBRARIES", limit=42)
        assert rows == [{"id": 1}, {"id": 2}]
        assert captured["url"] == "https://data.cityofchicago.org/resource/x8fc-8rcq.json"
        assert captured["params"] == {"$limit": 42}

        expected_token = base64.b64encode(b"id123:shh").decode("ascii")
        assert captured["headers"]["Authorization"] == f"Basic {expected_token}"

    def test_passes_where_clause_when_set(self, monkeypatch):
        monkeypatch.setenv("CHICAGO_DATA_PORTAL_API_KEY_ID", "id")
        monkeypatch.setenv("CHICAGO_DATA_PORTAL_API_KEY_SECRET", "secret")
        monkeypatch.setenv("CDP_API_ENDPOINT_LIBRARIES", "https://example/resource/abc.json")
        captured: dict = {}

        def fake_get(url, params=None, headers=None, timeout=None):
            captured["params"] = params
            resp = Mock()
            resp.raise_for_status = lambda: None
            resp.json = lambda: []
            return resp

        monkeypatch.setattr(_cdp_client.requests, "get", fake_get)
        _cdp_client.fetch_rows("CDP_API_ENDPOINT_LIBRARIES", limit=10, where="district='1'")
        assert captured["params"] == {"$limit": 10, "$where": "district='1'"}
