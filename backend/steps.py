"""
Step count calculation utilities.

Step length formula: step_length_inches = height_inches * 0.413
(a widely-used biomechanical approximation for average adult walking gait).

Default assumes a 2.5 ft (30 inch) step length — the midpoint of the
typical adult range — when no height is provided.

Approximate calories use a MET of 3.5 for 3 mph walking on a 70 kg (155 lb)
reference body weight. The value is displayed as approximate; weight is not
collected.
"""

DEFAULT_STEP_LENGTH_FT: float = 2.5        # 30 inches — average adult
_HEIGHT_TO_STEP_FACTOR: float = 0.413      # step_length_inches = height_inches × this
_CALORIES_PER_MINUTE: float = 4.3         # ≈ MET 3.5 × 70 kg × 3.5 / 200


def step_length_from_height(height_inches: float) -> float:
    """Return personalized step length in feet from height in inches."""
    return (height_inches * _HEIGHT_TO_STEP_FACTOR) / 12.0


def steps_from_miles(distance_miles: float, step_length_ft: float) -> int:
    """Return step count for a given distance and step length."""
    if step_length_ft <= 0:
        return 0
    return max(0, round(distance_miles * 5280.0 / step_length_ft))


def calories_from_minutes(minutes: float) -> int:
    """Return approximate calories burned walking at 3 mph for the given duration."""
    return max(0, round(minutes * _CALORIES_PER_MINUTE))


def daily_goal_pct(steps: int, daily_goal: int = 10_000) -> int:
    """Return steps as an integer percentage of the daily goal."""
    if daily_goal <= 0:
        return 0
    return max(0, round(steps / daily_goal * 100))
