import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepHero } from "./StepHero.jsx";

const baseResult = {
  total_steps: 5880,
  total_miles: 2.8,
  total_minutes: 56,
  calories_approx: 241,
  daily_goal_pct: 59,
  step_length_inches: 30,
  personalized: false,
  personalized_calories: false,
};

describe("StepHero metric reframing", () => {
  it("renders step count and calorie chip by default", () => {
    render(<StepHero result={baseResult} dailyGoal={10000} />);
    // The big number is steps (with comma formatting)
    expect(screen.getByText("5,880")).toBeInTheDocument();
    expect(screen.getByText("steps")).toBeInTheDocument();
    expect(screen.getByText(/~241 cal/)).toBeInTheDocument();
  });

  it("renders miles + minutes and hides the calorie chip in distance mode", () => {
    render(<StepHero result={baseResult} dailyGoal={10000} metricMode="distance" />);
    // Big number is total_miles
    expect(screen.getByText("2.8")).toBeInTheDocument();
    expect(screen.getByText("miles")).toBeInTheDocument();
    expect(screen.getByText(/56 min/)).toBeInTheDocument();
    expect(screen.queryByText(/cal/)).not.toBeInTheDocument();
  });

  it("hides the daily-measure goal bar in distance mode", () => {
    render(<StepHero result={baseResult} dailyGoal={10000} metricMode="distance" />);
    expect(screen.queryByText(/Daily measure/)).not.toBeInTheDocument();
  });
});
