import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from steps import (
    step_length_from_height,
    steps_from_miles,
    calories_from_minutes,
    daily_goal_pct,
    DEFAULT_STEP_LENGTH_FT,
)


class TestStepLengthFromHeight:
    def test_average_height(self):
        # 69 inches × 0.413 / 12 = 2.375 ft
        result = step_length_from_height(69)
        assert abs(result - (69 * 0.413 / 12)) < 1e-9

    def test_short_person(self):
        result = step_length_from_height(60)
        assert abs(result - (60 * 0.413 / 12)) < 1e-9

    def test_tall_person(self):
        result = step_length_from_height(78)
        assert abs(result - (78 * 0.413 / 12)) < 1e-9

    def test_returns_float(self):
        assert isinstance(step_length_from_height(70), float)


class TestStepsFromMiles:
    def test_zero_distance(self):
        assert steps_from_miles(0.0, DEFAULT_STEP_LENGTH_FT) == 0

    def test_zero_step_length_returns_zero(self):
        assert steps_from_miles(1.0, 0.0) == 0

    def test_negative_step_length_returns_zero(self):
        assert steps_from_miles(1.0, -1.0) == 0

    def test_one_mile_default_step(self):
        # 1 mile = 5280 ft; default step = 2.5 ft → 2112 steps
        assert steps_from_miles(1.0, DEFAULT_STEP_LENGTH_FT) == 2112

    def test_returns_int(self):
        assert isinstance(steps_from_miles(1.0, 2.5), int)

    def test_rounding(self):
        # 5280 / 2.5 = 2112.0 exactly
        assert steps_from_miles(1.0, 2.5) == 2112

    def test_personalized_step_length(self):
        step_ft = step_length_from_height(69)  # ≈ 2.375 ft
        result = steps_from_miles(1.0, step_ft)
        assert result == round(5280.0 / step_ft)


class TestCaloriesFromMinutes:
    def test_zero_minutes(self):
        assert calories_from_minutes(0) == 0

    def test_thirty_minutes(self):
        # MET 3.5 (normal) × 70 kg × 3.5 / 200 × 30 ≈ 128.6 → rounds to 129
        assert calories_from_minutes(30) == 129

    def test_returns_int(self):
        assert isinstance(calories_from_minutes(20), int)

    def test_non_negative(self):
        assert calories_from_minutes(-5) == 0

    def test_brisk_pace_burns_more_than_normal(self):
        assert calories_from_minutes(30, pace="brisk") > calories_from_minutes(30, pace="normal")

    def test_leisurely_pace_burns_less_than_normal(self):
        assert calories_from_minutes(30, pace="leisurely") < calories_from_minutes(30, pace="normal")

    def test_heavier_weight_burns_more(self):
        assert calories_from_minutes(30, weight_kg=100) > calories_from_minutes(30, weight_kg=60)

    def test_unknown_pace_falls_back_to_normal(self):
        assert calories_from_minutes(30, pace="sprint") == calories_from_minutes(30, pace="normal")


class TestDailyGoalPct:
    def test_half_goal(self):
        assert daily_goal_pct(5000) == 50

    def test_full_goal(self):
        assert daily_goal_pct(10_000) == 100

    def test_over_goal(self):
        assert daily_goal_pct(15_000) == 150

    def test_zero_steps(self):
        assert daily_goal_pct(0) == 0

    def test_returns_int(self):
        assert isinstance(daily_goal_pct(5000), int)
