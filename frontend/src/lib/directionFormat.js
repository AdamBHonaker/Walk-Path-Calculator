export function formatSteps(n) {
  return n != null ? n.toLocaleString() : "–";
}

export function formatBlocks(blocks, blockType) {
  const t = blockType === "long" ? "long block" : "short block";
  return `${blocks} ${blocks === 1 ? t : t + "s"}`;
}

function pathTypePhrase(pathType) {
  switch (pathType) {
    case "crosswalk":        return "through the crosswalk";
    case "steps":            return "up the steps";
    case "pedestrian plaza": return "through the pedestrian plaza";
    case "bike path":        return "along the bike path";
    case "footway":          return "along the footway";
    case "trail":            return "along the trail";
    default:                 return "along the path";
  }
}

export function formatStepLabel(step, i) {
  if (step.street) return `${i === 0 ? "Start on" : "Continue on"} ${step.street}`;
  return `${i === 0 ? "Walk" : "Continue"}${step.direction_full ? ` ${step.direction_full}` : ""} ${pathTypePhrase(step.path_type)}`;
}
