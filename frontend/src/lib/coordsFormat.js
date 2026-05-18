// Display formatter for a "lat, lon" coordinate pair.
//
// 5 decimals (~1.1 m) is the project convention for UI surfaces — pick-on-map
// confirm card, locate-me fallback when reverse-geocode misses, place-popover
// fallback labels, etc. The reverse-geocode request URL uses 6 decimals
// independently (a request, not a display string).
export function formatLatLonLabel(lat, lon, decimals = 5) {
  return `${lat.toFixed(decimals)}, ${lon.toFixed(decimals)}`;
}
