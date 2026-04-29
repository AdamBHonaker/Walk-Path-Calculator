import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from utils import haversine_miles, WALKING_SPEED_MPH


class TestHaversineMiles:
    def test_same_point_is_zero(self):
        assert haversine_miles(41.9476, -87.6553, 41.9476, -87.6553) == 0.0

    def test_wrigleyville_to_logan_square(self):
        # Wrigleyville (41.9476, -87.6553) to Logan Square (41.9290, -87.7000)
        # Straight-line distance is roughly 2.5–3.0 miles
        dist = haversine_miles(41.9476, -87.6553, 41.9290, -87.7000)
        assert 2.0 < dist < 3.5

    def test_symmetry(self):
        a = haversine_miles(41.9476, -87.6553, 41.8827, -87.6324)
        b = haversine_miles(41.8827, -87.6324, 41.9476, -87.6553)
        assert abs(a - b) < 1e-9

    def test_returns_float(self):
        assert isinstance(haversine_miles(41.9, -87.6, 41.95, -87.65), float)

    def test_north_to_south_chicago(self):
        # Howard St (far north ~42.019) to 50th St (~41.802) is ~15 miles N-S
        dist = haversine_miles(42.019, -87.669, 41.802, -87.669)
        assert 14.0 < dist < 16.0


class TestWalkingSpeedConstant:
    def test_is_3_mph(self):
        assert WALKING_SPEED_MPH == 3.0

    def test_is_float(self):
        assert isinstance(WALKING_SPEED_MPH, float)
