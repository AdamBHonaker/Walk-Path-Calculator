"""
Step count and calorie calculation utilities.

Step length formula: step_length_inches = height_inches * 0.413
(a widely-used biomechanical approximation for average adult walking gait).

Default assumes a 2.5 ft (30 inch) step length — the midpoint of the
typical adult range — when no height is provided.

Calorie formula: kcal = MET × weight_kg × 3.5 / 200 × minutes
The 3.5 / 200 factor is the standard ml-O₂-per-kg-per-min → kcal conversion.
MET varies by pace; default 70 kg reference body weight when unset.
"""

DEFAULT_STEP_LENGTH_FT: float = 2.5        # 30 inches — average adult
_HEIGHT_TO_STEP_FACTOR: float = 0.413      # step_length_inches = height_inches × this

# Reference body weight when the user has not supplied one. 70 kg ≈ 154 lb,
# the standard textbook reference for MET-based energy expenditure.
DEFAULT_WEIGHT_KG: float = 70.0

# MET (metabolic equivalent) by walking pace. Sourced from the Compendium of
# Physical Activities (2 mph ≈ 2.5, 3 mph ≈ 3.5, 4 mph ≈ 4.5).
PACE_TO_MET: dict[str, float] = {
    "leisurely": 2.5,
    "normal":    3.5,
    "brisk":     4.5,
}
DEFAULT_PACE: str = "normal"
_DEFAULT_MET: float = PACE_TO_MET[DEFAULT_PACE]


def step_length_from_height(height_inches: float) -> float:
    """Return personalized step length in feet from height in inches."""
    return (height_inches * _HEIGHT_TO_STEP_FACTOR) / 12.0


def steps_from_miles(distance_miles: float, step_length_ft: float) -> int:
    """Return step count for a given distance and step length."""
    if step_length_ft <= 0:
        return 0
    return max(0, round(distance_miles * 5280.0 / step_length_ft))


def calories_from_minutes(
    minutes: float,
    weight_kg: float | None = None,
    pace: str = DEFAULT_PACE,
) -> int:
    """
    Approximate calories burned walking for the given duration.

    Uses the standard MET formula `kcal = MET × weight_kg × 3.5 / 200 × minutes`.
    With the defaults (MET 3.5, 70 kg), this yields ≈ 4.29 kcal/min — matching
    the previous fixed coefficient to the nearest integer.
    """
    met = PACE_TO_MET.get(pace, _DEFAULT_MET)
    kg  = weight_kg if (weight_kg is not None and weight_kg > 0) else DEFAULT_WEIGHT_KG
    return max(0, round(met * kg * 3.5 / 200.0 * minutes))


def daily_goal_pct(steps: int, daily_goal: int = 10_000) -> int:
    """Return steps as an integer percentage of the daily goal."""
    if daily_goal <= 0:
        return 0
    return max(0, round(steps / daily_goal * 100))
