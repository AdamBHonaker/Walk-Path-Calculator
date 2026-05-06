import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from community_areas import (
    COMMUNITY_AREA_CENTROIDS,
    community_area_names,
    lookup_centroid,
)
from utils import (
    CHICAGO_EAST,
    CHICAGO_NORTH,
    CHICAGO_SOUTH,
    CHICAGO_WEST,
)


class TestCommunityAreaCentroids:
    def test_has_77_entries(self):
        assert len(COMMUNITY_AREA_CENTROIDS) == 77

    def test_all_centroids_inside_chicago_bbox(self):
        # CHICAGO_* bbox in utils.py covers the full city. Every community-area
        # centroid should fall inside it; if one drifts outside, the source
        # data has changed and the table needs rebuild. (The narrower
        # STREET_GRAPH_* bbox isn't a hard requirement — south-side areas like
        # Archer Heights legitimately fall outside the current street-graph
        # extent.)
        for name, (lat, lon) in COMMUNITY_AREA_CENTROIDS.items():
            assert CHICAGO_SOUTH <= lat <= CHICAGO_NORTH, name
            assert CHICAGO_WEST <= lon <= CHICAGO_EAST, name

    def test_punctuation_restored(self):
        # The City dataset ships these uppercased and stripped of punctuation
        # ("OHARE", "MCKINLEY PARK"). The build script restores conventional
        # spelling — make sure the static table reflects that.
        assert "O'Hare" in COMMUNITY_AREA_CENTROIDS
        assert "McKinley Park" in COMMUNITY_AREA_CENTROIDS

    def test_lookup_is_case_insensitive(self):
        canonical = COMMUNITY_AREA_CENTROIDS["Logan Square"]
        assert lookup_centroid("Logan Square") == canonical
        assert lookup_centroid("logan square") == canonical
        assert lookup_centroid("LOGAN SQUARE") == canonical
        assert lookup_centroid("  Logan Square  ") == canonical

    def test_lookup_unknown_returns_none(self):
        assert lookup_centroid("Atlantis") is None
        assert lookup_centroid("") is None

    def test_names_helper_returns_all_77(self):
        names = community_area_names()
        assert len(names) == 77
        assert len(set(names)) == 77

    def test_json_artifact_matches_module(self):
        json_path = Path(__file__).resolve().parent.parent / "data" / "community_area_centroids.json"
        if not json_path.exists():
            return  # JSON is optional; the Python table is the source of truth.
        data = json.loads(json_path.read_text(encoding="utf-8"))
        assert len(data) == 77
        for name, coords in data.items():
            assert name in COMMUNITY_AREA_CENTROIDS
            module_lat, module_lon = COMMUNITY_AREA_CENTROIDS[name]
            json_lat, json_lon = coords
            assert abs(module_lat - json_lat) < 1e-6, name
            assert abs(module_lon - json_lon) < 1e-6, name
