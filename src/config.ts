/** Site-wide constants. The working name may change; change it here only. */
export const SITE_NAME = "Jackson Blight Tracker";

/** v1 scope: Hinds County, Jackson city limits. County stays in every key. */
export const COUNTY = "Hinds";

/** Weeks start Monday in Central time for all weekly stats. */
export const STATS_TIMEZONE = "America/Chicago";

/** Minimum parcels on a street before it can be ranked (spec default 10). */
export const STREET_MIN_PARCELS = 10;

/** Free, keyless vector basemap. Swap for a hosted style if traffic grows. */
export const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export const MAP_CENTER: [number, number] = [-90.2, 32.31];
