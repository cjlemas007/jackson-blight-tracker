/** Every external endpoint the sync reads, in one place. See docs/STEP1_FINDINGS.md. */

const JXN = "https://services2.arcgis.com/n0wqzAPJddc1vROD/arcgis/rest/services";
const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services";
const RF = "https://services5.arcgis.com/5IdnladHvLU3ymOR/arcgis/rest/services";

/** Hinds County envelope (lon/lat), used to clip national layers. */
export const HINDS_ENVELOPE = { xmin: -90.75, ymin: 32.02, xmax: -90.05, ymax: 32.53 };

export const PARCELS_LAYER = `${JXN}/Zoning_Map_WFL1/FeatureServer/0`;

export interface BoundarySource {
  kind: "city_limits" | "city_limits_tiger" | "ward" | "neighborhood" | "zip" | "tract";
  label: string;
  url: string;
  where: string;
  envelope?: boolean;
  unofficial?: boolean;
  /** Features sharing a code are unioned into one boundary. */
  code(p: Record<string, unknown>): string;
  name(p: Record<string, unknown>): string;
}

export const BOUNDARY_SOURCES: BoundarySource[] = [
  {
    kind: "city_limits",
    label: "City of Jackson city limits (City of Jackson GIS)",
    url: `${JXN}/Zoning_Map_WFL1/FeatureServer/1`,
    where: "1=1",
    code: () => "JACKSON",
    name: () => "Jackson city limits",
  },
  {
    kind: "city_limits_tiger",
    label: "Jackson city, TIGER/Line current places (Census)",
    url: `${TIGER}/TIGERweb/tigerWMS_Current/MapServer/28`,
    where: "GEOID='2836000'",
    code: () => "2836000",
    name: () => "Jackson city (Census)",
  },
  {
    kind: "ward",
    label: "City council wards, post-2020 redistricting (City of Jackson GIS)",
    url: `${JXN}/Zoning_Map_WFL1/FeatureServer/2`,
    where: "1=1",
    code: (p) => String(p.Ward ?? p.WARD ?? p.District).trim(),
    name: (p) => `Ward ${String(p.Ward ?? p.WARD ?? p.District).trim()}`,
  },
  {
    kind: "neighborhood",
    label: "Neighborhoods: Zillow neighborhoods re-hosted by Reinvestment Fund (UNOFFICIAL)",
    url: `${RF}/Jackson_Neighborhood_Labels/FeatureServer/117`,
    where: "CITY='Jackson'",
    unofficial: true,
    code: (p) => String(p.REGIONID ?? p.NAME),
    name: (p) => String(p.NAME),
  },
  {
    kind: "zip",
    label: "2020 ZIP Code Tabulation Areas (Census TIGERweb)",
    url: `${TIGER}/TIGERweb/tigerWMS_Current/MapServer/2`,
    where: "1=1",
    envelope: true,
    code: (p) => String(p.ZCTA5 ?? p.GEOID),
    name: (p) => String(p.ZCTA5 ?? p.GEOID),
  },
  {
    kind: "tract",
    label: "2020 census tracts, Hinds County (Census TIGERweb)",
    url: `${TIGER}/TIGERweb/tigerWMS_Census2020/MapServer/6`,
    where: "STATE='28' AND COUNTY='049'",
    code: (p) => String(p.GEOID),
    name: (p) => String(p.NAME ?? p.BASENAME),
  },
];

export const CENSUS_BATCH_GEOCODER = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
