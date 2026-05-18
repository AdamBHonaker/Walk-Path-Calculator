// Pure helpers for formatting route metadata. Lives here (not in App.jsx) so
// non-App consumers (e.g. ShareDispatch) can import without dragging App's
// top-level side effects (BACKEND_URL resolution) into their dependency graph.

import { formatStepLabel, formatBlocks } from "./directionFormat.js";

export const PACE_LABELS = {
  leisurely: "Strolling · 2 mph",
  normal:    "Steady · 3 mph",
  brisk:     "Earnest · 4 mph",
};

export function safePaceLabel(pace) {
  return Object.prototype.hasOwnProperty.call(PACE_LABELS, pace)
    ? PACE_LABELS[pace]
    : null;
}

export function motivationMessage(steps, mobilityProfile = "walking") {
  const wheeled = mobilityProfile === "wheeled";
  if (steps < 1500)  return wheeled ? "A short roll. The day is improved by it." : "A short walk. The day is improved by it.";
  if (steps < 4000)  return wheeled ? "A neighborhood roll. The everyday measure of a useful day." : "A neighborhood walk. The everyday measure of a useful day.";
  if (steps < 7000)  return wheeled ? "A serious roll. You will arrive earned." : "A serious walk. You will arrive earned.";
  if (steps < 10000) return "Nearly a full day's measure in a single passage.";
  return wheeled ? "Over ten thousand. A roll to remember rolling." : "Over ten thousand. A walk to remember walking.";
}

export function formatDirectionsText(directions, result, mobilityProfile = "walking") {
  const headerLabel = mobilityProfile === "wheeled" ? "Rolling directions" : "Walking directions";
  const header = `Passage · ${headerLabel}\n${result.total_miles} mi · ${result.total_minutes} min · ${result.total_steps.toLocaleString()} steps`;
  const steps = directions.map((step, i) => {
    let streetLine = formatStepLabel(step, i);
    if (step.street && step.direction_full) streetLine += ` heading ${step.direction_full}`;
    return `${i + 1}. ${streetLine} — ${formatBlocks(step.blocks, step.block_type)} · ${step.minutes} min · ${step.steps.toLocaleString()} steps`;
  });
  return [header, "", ...steps, "", "Arrive at destination."].join("\n");
}
