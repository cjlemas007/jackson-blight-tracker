/**
 * Address normalization shared by the sync (street rankings, mailing-key owner grouping)
 * and the app (address search). Pure functions; covered by tests/address.test.ts.
 */

const DIRECTIONS: Record<string, string> = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
  N: "N", S: "S", E: "E", W: "W", NE: "NE", NW: "NW", SE: "SE", SW: "SW",
};

/** USPS Publication 28 suffix abbreviations for the suffixes that occur in Hinds County. */
const SUFFIXES: Record<string, string> = {
  STREET: "ST", ST: "ST", STR: "ST",
  AVENUE: "AVE", AVE: "AVE", AV: "AVE",
  DRIVE: "DR", DR: "DR", DRV: "DR",
  ROAD: "RD", RD: "RD",
  BOULEVARD: "BLVD", BLVD: "BLVD",
  LANE: "LN", LN: "LN",
  CIRCLE: "CIR", CIR: "CIR",
  COURT: "CT", CT: "CT",
  PLACE: "PL", PL: "PL",
  PARKWAY: "PKWY", PKWY: "PKWY", PKY: "PKWY",
  HIGHWAY: "HWY", HWY: "HWY",
  TERRACE: "TER", TER: "TER",
  TRAIL: "TRL", TRL: "TRL",
  COVE: "CV", CV: "CV",
  WAY: "WAY",
  LOOP: "LOOP",
  PLAZA: "PLZ", PLZ: "PLZ",
  SQUARE: "SQ", SQ: "SQ",
  CROSSING: "XING", XING: "XING",
  POINT: "PT", PT: "PT",
  RIDGE: "RDG", RDG: "RDG",
  ALLEY: "ALY", ALY: "ALY",
  ROW: "ROW",
  RUN: "RUN",
  PATH: "PATH",
  WALK: "WALK",
  BEND: "BND", BND: "BND",
  HOLLOW: "HOLW", HOLW: "HOLW",
  CREEK: "CRK", CRK: "CRK",
  COVES: "CVS",
  PIKE: "PIKE",
  PASS: "PASS",
  CENTER: "CTR", CTR: "CTR",
};

/** Tokens allowed after the suffix that are still part of the street name. */
const POST_TOKENS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "EXT"]);
const EXTENSIONS: Record<string, string> = { EXTENSION: "EXT", EXTD: "EXT", EXT: "EXT" };

const UNIT_WORDS: Record<string, string> = {
  SUITE: "STE", STE: "STE", APARTMENT: "APT", APT: "APT", UNIT: "UNIT", BUILDING: "BLDG", BLDG: "BLDG",
  FLOOR: "FL", FL: "FL", ROOM: "RM", RM: "RM",
};

export function cleanText(s: string | null | undefined): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normToken(t: string): string {
  return DIRECTIONS[t] ?? SUFFIXES[t] ?? EXTENSIONS[t] ?? UNIT_WORDS[t] ?? t;
}

/**
 * Normalize a street name (no house number), e.g. "north state street" -> "N STATE ST",
 * "J R LYNCH ST EXTENSION" -> "J R LYNCH ST EXT". Directional prefixes are kept because
 * N State St and S State St are different streets.
 */
export function normalizeStreetName(raw: string | null | undefined): string | null {
  const tokens = cleanText(raw).replace(/#/g, " ").split(" ").filter(Boolean);
  if (!tokens.length) return null;

  // Find the last suffix that has at least one name token before it.
  let suffixIdx = -1;
  for (let i = tokens.length - 1; i >= 1; i--) {
    if (SUFFIXES[tokens[i]] && !(i === 1 && DIRECTIONS[tokens[0]])) {
      suffixIdx = i;
      break;
    }
  }

  let kept: string[];
  if (suffixIdx === -1) {
    kept = tokens; // e.g. "HWY 80", "I-55 N"
    // Drop a trailing pure-number unit only if something precedes it and it isn't a route number.
  } else {
    kept = tokens.slice(0, suffixIdx + 1);
    for (const t of tokens.slice(suffixIdx + 1)) {
      const n = normToken(t);
      if (POST_TOKENS.has(n)) kept.push(t);
      else break; // unit numbers, "AC", "APT 2", etc.
    }
  }

  const out = kept.map((t, i) => {
    // Only abbreviate a leading directional when a name follows it ("SOUTH ST" stays a name).
    if (i === 0 && DIRECTIONS[t] && kept.length > 2) return DIRECTIONS[t];
    if (i === kept.length - 1 || i === suffixIdx) return normToken(t);
    if (i > suffixIdx && suffixIdx !== -1) return normToken(t);
    return t;
  });
  const s = out.join(" ").trim();
  return s || null;
}

export interface SitusParts {
  number: number | null;
  street: string | null;
}

/**
 * Split a land-roll situs address into house number and normalized street.
 * Number 0 means "no number" (vacant land) in the Hinds roll.
 */
export function parseSitus(addr: string | null | undefined): SitusParts {
  const s = cleanText(addr);
  const m = s.match(/^(\d+)[A-Z]?\s+(.*)$/);
  if (!m) return { number: null, street: normalizeStreetName(s) };
  const n = Number(m[1]);
  return { number: n > 0 ? n : null, street: normalizeStreetName(m[2]) };
}

// ---------------------------------------------------------------------------------------
// Mailing addresses and owner grouping keys
// ---------------------------------------------------------------------------------------

export interface MailingInput {
  street: string | null | undefined;
  city: string | null | undefined;
  state: string | null | undefined;
  zip?: string | null | undefined;
}

export interface MailingRepaired {
  careOf: string | null;
  street: string;
  city: string;
  state: string;
  zip: string;
  repaired: boolean;
}

const CARE_OF = /^(C\/O|C O|ATTN:?|ATTENTION|%)\s*/;
const LOOKS_LIKE_STREET = /^(\d|P ?O BOX|POST OFFICE BOX|BOX \d|RR \d|HC \d)/;
const LOOKS_LIKE_UNIT = /^(STE|SUITE|APT|UNIT|#|BLDG|FLOOR|FL|RM)\b/;

/**
 * The Hinds land roll shifts columns when a mailing address has a second line:
 *   "C/O JOSEPHINE WHITE | 2112 S NORRELL RD | (blank) | (blank)"
 *   "21860 BURBANK BLVD | SUITE 300 S | (blank) | (blank)"
 * Repair both shapes. Only applied when the state column is blank, so normal rows are untouched.
 */
export function repairMailing(input: MailingInput): MailingRepaired {
  let street = cleanText(input.street);
  let city = cleanText(input.city);
  const state = cleanText(input.state);
  const zip = cleanText(input.zip);
  let careOf: string | null = null;
  let repaired = false;

  if (!state && city) {
    if (LOOKS_LIKE_STREET.test(city)) {
      careOf = street || null;
      street = city;
      city = "";
      repaired = true;
    } else if (LOOKS_LIKE_UNIT.test(city)) {
      street = `${street} ${city}`.trim();
      city = "";
      repaired = true;
    }
  }
  if (CARE_OF.test(street) && !careOf) {
    // A care-of line left in the street column with no recoverable street.
    careOf = street;
  }
  if (careOf) careOf = careOf.replace(CARE_OF, "").trim() || careOf;
  return { careOf, street, city, state, zip, repaired };
}

/** Normalize a mailing street line for grouping: "125 SOUTH CONGRESS ST SUITE 1800" -> "125 S CONGRESS ST STE 1800". */
export function normalizeMailingStreet(raw: string | null | undefined): string {
  let s = cleanText(raw)
    .replace(/\bP\s*O\s*BOX\b/g, "P O BOX")
    .replace(/\bPOST OFFICE BOX\b/g, "P O BOX")
    .replace(/\bPOB\b/g, "P O BOX")
    .replace(/#\s*/g, "STE ");
  const tokens = s.split(" ").filter(Boolean);
  // House number followed by a directional word: abbreviate it (SOUTH CONGRESS -> S CONGRESS).
  if (tokens.length > 2 && /^\d/.test(tokens[0]) && DIRECTIONS[tokens[1]]) tokens[1] = DIRECTIONS[tokens[1]];
  s = tokens.map((t, i) => (i === 0 ? t : SUFFIXES[t] ?? UNIT_WORDS[t] ?? t)).join(" ");
  return s;
}

/** The street-only part of a grouping key. */
export function mailingStreetKey(m: MailingInput): string {
  return normalizeMailingStreet(repairMailing(m).street);
}

/** Full grouping key "STREET|CITY|STATE" after column repair and normalization. */
export function mailingKey(m: MailingInput): string {
  const r = repairMailing(m);
  return `${normalizeMailingStreet(r.street)}|${r.city}|${r.state}`;
}

/** Normalize a key already in "street|city|state" form (as stored in the editorial Sheet). */
export function normalizeMailingKey(key: string): string {
  const [street = "", city = "", state = ""] = key.split("|");
  return mailingKey({ street, city, state });
}
