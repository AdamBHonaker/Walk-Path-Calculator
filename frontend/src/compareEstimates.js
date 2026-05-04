// Heuristics for comparing a walk against driving / ride-share / transit
// alternatives. All constants are tunable in one place.

const DRIVING_AVG_MPH = 22;
const TRANSIT_TIME_FRACTION = 0.55;
const TRANSIT_MIN_MINUTES = 8;
const RIDE_BASE_USD = 3.5;
const RIDE_PER_MILE_USD = 1.8;
const RIDE_PER_MIN_USD = 0.3;
const CO2_KG_PER_MILE = 0.404;

export function drivingMinutes(miles) {
  if (miles <= 0) return 0;
  return (miles / DRIVING_AVG_MPH) * 60;
}

export function transitMinutes(walkMinutes) {
  if (walkMinutes <= 0) return 0;
  return Math.max(TRANSIT_MIN_MINUTES, walkMinutes * TRANSIT_TIME_FRACTION);
}

export function rideShareCost(miles) {
  if (miles <= 0) return 0;
  const driveMin = drivingMinutes(miles);
  return RIDE_BASE_USD + miles * RIDE_PER_MILE_USD + driveMin * RIDE_PER_MIN_USD;
}

export function co2AvoidedKg(miles) {
  if (miles <= 0) return 0;
  return miles * CO2_KG_PER_MILE;
}

export function summarize(miles, walkMinutes) {
  return {
    driveMin: drivingMinutes(miles),
    transitMin: transitMinutes(walkMinutes),
    costUsd: rideShareCost(miles),
    co2Kg: co2AvoidedKg(miles),
  };
}
