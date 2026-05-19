"""Tests for the graph eviction daemon in walking.py.

These tests exercise _evict_graph() and _last_graph_access bookkeeping
without loading a real street graph — they inject a tiny synthetic cache
state directly into the module-level globals via monkeypatch.
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import walking  # noqa: E402


@pytest.fixture(autouse=True)
def _restore_cache_state(monkeypatch):
    """Snapshot and restore walking module globals after every test so a
    failed eviction test cannot poison subsequent tests."""
    saved_cache       = walking._graph_cache
    saved_failed      = walking._graph_load_failed
    saved_access      = walking._last_graph_access
    saved_canopy      = walking._edge_tree_canopy
    saved_park        = walking._edge_park_proximity
    saved_sources     = walking._edge_sources
    saved_targets     = walking._edge_targets
    saved_names       = walking._edge_names
    saved_highways    = walking._edge_highways
    saved_footways    = walking._edge_footways
    saved_lengths     = walking._edge_lengths
    saved_geometries  = walking._edge_geometries
    saved_kdtree      = walking._coord_kdtree
    saved_lats        = walking._vertex_lats
    saved_lons        = walking._vertex_lons
    saved_kdtree_map  = walking._kdtree_to_vertex
    yield
    walking._graph_cache       = saved_cache
    walking._graph_load_failed = saved_failed
    walking._last_graph_access = saved_access
    walking._edge_tree_canopy  = saved_canopy
    walking._edge_park_proximity = saved_park
    walking._edge_sources      = saved_sources
    walking._edge_targets      = saved_targets
    walking._edge_names        = saved_names
    walking._edge_highways     = saved_highways
    walking._edge_footways     = saved_footways
    walking._edge_lengths      = saved_lengths
    walking._edge_geometries   = saved_geometries
    walking._coord_kdtree      = saved_kdtree
    walking._vertex_lats       = saved_lats
    walking._vertex_lons       = saved_lons
    walking._kdtree_to_vertex  = saved_kdtree_map
    walking._flavor_weights.clear()
    walking._combined_weights.clear()


def _inject_fake_graph():
    """Inject a non-None sentinel so _evict_graph() has something to clear."""
    fake = MagicMock()
    walking._graph_cache       = fake
    walking._coord_kdtree      = MagicMock()
    walking._vertex_lats       = []
    walking._vertex_lons       = []
    walking._kdtree_to_vertex  = []
    walking._edge_names        = []
    walking._edge_highways     = []
    walking._edge_footways     = []
    walking._edge_lengths      = []
    walking._edge_geometries   = []
    walking._edge_sources      = []
    walking._edge_targets      = []
    walking._edge_tree_canopy  = None
    walking._edge_park_proximity = None
    walking._graph_load_failed = False
    return fake


class TestEvictGraph:
    def test_evict_clears_graph_cache(self, monkeypatch):
        """_evict_graph() must set _graph_cache to None."""
        _inject_fake_graph()
        # Set last-access far enough in the past that idle > TTL
        monkeypatch.setattr(walking, "_EVICTION_TTL_SECONDS", 1.0)
        walking._last_graph_access = walking._time.monotonic() - 5.0

        walking._evict_graph()

        assert walking._graph_cache is None

    def test_evict_resets_load_failed_flag(self, monkeypatch):
        """Deliberate eviction must clear _graph_load_failed so the graph
        can reload on the next request."""
        _inject_fake_graph()
        walking._graph_load_failed = True  # would normally be False before evict
        monkeypatch.setattr(walking, "_EVICTION_TTL_SECONDS", 1.0)
        walking._last_graph_access = walking._time.monotonic() - 5.0

        walking._evict_graph()

        assert walking._graph_load_failed is False

    def test_evict_skips_when_recently_accessed(self, monkeypatch):
        """If a request arrives just before the lock, _evict_graph must
        detect it via the second idle check and abort the eviction."""
        fake = _inject_fake_graph()
        monkeypatch.setattr(walking, "_EVICTION_TTL_SECONDS", 1.0)
        # Last access is only 0.01 s ago — well within the TTL.
        walking._last_graph_access = walking._time.monotonic() - 0.01

        walking._evict_graph()

        # Cache must still be intact.
        assert walking._graph_cache is fake

    def test_evict_noop_when_cache_already_none(self, monkeypatch):
        """If the cache is already None, _evict_graph must return without error."""
        walking._graph_cache = None
        monkeypatch.setattr(walking, "_EVICTION_TTL_SECONDS", 1.0)
        # Should not raise.
        walking._evict_graph()
        assert walking._graph_cache is None

    def test_evict_clears_all_edge_caches(self, monkeypatch):
        """Eviction must zero out all per-edge cache columns, not just the graph."""
        _inject_fake_graph()
        walking._edge_names      = ["Clark St"]
        walking._edge_highways   = ["residential"]
        walking._edge_footways   = ["sidewalk"]
        walking._edge_lengths    = [100.0]
        walking._edge_sources    = [0]
        walking._edge_targets    = [1]

        monkeypatch.setattr(walking, "_EVICTION_TTL_SECONDS", 1.0)
        walking._last_graph_access = walking._time.monotonic() - 5.0
        walking._evict_graph()

        assert walking._edge_names      is None
        assert walking._edge_highways   is None
        assert walking._edge_footways   is None
        assert walking._edge_lengths    is None
        assert walking._edge_sources    is None
        assert walking._edge_targets    is None

    def test_last_graph_access_updated_on_cache_hit(self, monkeypatch):
        """_load_graph() must refresh _last_graph_access every time a cached
        graph is returned — the TTL idle clock resets on each request."""
        fake = MagicMock()
        walking._graph_cache    = fake
        walking._graph_load_failed = False
        # Set access far in the past so we can detect the update.
        walking._last_graph_access = 0.0

        before = walking._time.monotonic()
        walking._load_graph()
        after = walking._time.monotonic()

        assert walking._last_graph_access >= before
        assert walking._last_graph_access <= after + 1e-3

    def test_daemon_disabled_when_ttl_zero(self, monkeypatch, caplog):
        """_start_eviction_daemon must be a no-op when TTL is 0 (eviction disabled)."""
        monkeypatch.setattr(walking, "_EVICTION_TTL_SECONDS", 0.0)
        threads_before = threading.active_count()
        walking._start_eviction_daemon()
        # Give any thread a moment to start (should not happen).
        time.sleep(0.05)
        threads_after = threading.active_count()
        assert threads_after == threads_before, "daemon thread must not start when TTL=0"
