/**
 * One palette for the map, legends, charts and embeds. Status and owner colors come from the
 * Okabe-Ito set, chosen to stay distinguishable with the common forms of color blindness
 * (blighted vs resolved is vermillion vs blue, never red vs green).
 */
export const INK = "#111418";
export const MUTED = "#5b6270";
export const RULE = "#e4e1da";
export const ACCENT = "#c8102e"; // newsroom red: kickers, key figures, focus

export const STATUS_COLORS = {
  verified_blighted: "#d55e00", // vermillion
  city_action: "#e69f00", // orange
  city_flagged: "#cc79a7", // reddish purple
  resolved: "#0072b2", // blue
  unreported: "#d6d2c9", // warm grey
} as const;

export const STATUS_LABELS: Record<keyof typeof STATUS_COLORS, string> = {
  verified_blighted: "Verified blighted",
  city_action: "City action pending",
  city_flagged: "City-flagged, not yet verified",
  resolved: "Resolved",
  unreported: "Not reported",
};

export const OWNER_COLORS = {
  state_forfeited: "#882255", // wine
  city: "#0072b2", // blue
  public: "#44aa99", // teal
  private_delinquent: "#e69f00", // orange
  private: "#d6d2c9", // warm grey
} as const;

/** Sequential ramp for choropleths (light to dark; lightness carries the signal). */
export const RAMP = ["#fdeee4", "#f9c9a8", "#f09a66", "#d9622b", "#a63a0b"];

// ---- Dark theme ("Night desk") -------------------------------------------------------------
export type Theme = "light" | "dark";

/** On a near-black map the Okabe-Ito blue is too dark to read, so it becomes sky blue; grey goes dark. */
const DARK_DATA: Record<string, string> = { "#0072b2": "#56b4e9", "#d6d2c9": "#4a505a" };
export const themed = (hex: string, theme: Theme) => (theme === "dark" ? (DARK_DATA[hex] ?? hex) : hex);

/** Choropleth ramp for a dark basemap: dim to bright, so lightness still carries the signal. */
export const RAMP_DARK = ["#3a2418", "#6b3414", "#a8470f", "#e06a1f", "#ffa463"];
export const rampFor = (theme: Theme) => (theme === "dark" ? RAMP_DARK : RAMP);

/** Colors for lines, labels and strokes drawn on top of the basemap. */
export const MAP_INK: Record<Theme, { ink: string; halo: string; stroke: string; accent: string }> = {
  light: { ink: INK, halo: "#ffffff", stroke: "#ffffff", accent: ACCENT },
  dark: { ink: "#e8eaed", halo: "#0e1116", stroke: "#0e1116", accent: "#d4ff3a" },
};
