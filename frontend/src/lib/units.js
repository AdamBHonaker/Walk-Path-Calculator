// Weight unit conversions. Used by PersonalizeModal (input toggle) and the
// route-fetch path in App.jsx (lb input → kg before sending to the backend).

export function lbToKg(lb) {
  return lb / 2.20462;
}

export function kgToLb(kg) {
  return kg * 2.20462;
}
