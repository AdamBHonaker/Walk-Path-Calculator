// Display list of Chicago's 77 community areas, mirroring the keys in
// backend/community_areas.py. Order is alphabetical, matching the dataset's
// natural sort.
//
// This list is used to populate the "🏘️ Community area" dropdown in the
// Neighborhood Explorer's origin selector. Coordinates aren't shipped to
// the frontend — the backend resolves the name to a centroid at request time.

export const COMMUNITY_AREA_NAMES = [
  "Albany Park", "Archer Heights", "Armour Square", "Ashburn", "Auburn Gresham",
  "Austin", "Avalon Park", "Avondale", "Belmont Cragin", "Beverly",
  "Bridgeport", "Brighton Park", "Burnside", "Calumet Heights", "Chatham",
  "Chicago Lawn", "Clearing", "Douglas", "Dunning", "East Garfield Park",
  "East Side", "Edgewater", "Edison Park", "Englewood", "Forest Glen",
  "Fuller Park", "Gage Park", "Garfield Ridge", "Grand Boulevard",
  "Greater Grand Crossing", "Hegewisch", "Hermosa", "Humboldt Park",
  "Hyde Park", "Irving Park", "Jefferson Park", "Kenwood", "Lake View",
  "Lincoln Park", "Lincoln Square", "Logan Square", "Loop", "Lower West Side",
  "McKinley Park", "Montclare", "Morgan Park", "Mount Greenwood",
  "Near North Side", "Near South Side", "Near West Side", "New City",
  "North Center", "North Lawndale", "North Park", "Norwood Park",
  "O'Hare", "Oakland", "Portage Park", "Pullman", "Riverdale",
  "Rogers Park", "Roseland", "South Chicago", "South Deering",
  "South Lawndale", "South Shore", "Uptown", "Washington Heights",
  "Washington Park", "West Elsdon", "West Englewood", "West Garfield Park",
  "West Lawn", "West Pullman", "West Ridge", "West Town", "Woodlawn",
];
