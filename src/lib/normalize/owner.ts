/**
 * Owner classification from the owner-of-record string. These rules decide which ranking
 * tab an owner lands on and which parcels are excluded from the ranked list. Covered by
 * tests/owner.test.ts. The sync stores the results on data.landroll_parcels, so SQL never
 * re-implements these rules.
 */

export type OwnerType = "state_forfeited" | "city" | "public" | "private";

/**
 * Tax-forfeited land: the owner of record is the bare State of Mississippi (the Secretary
 * of State holds forfeited parcels). "STATE OF MISS HIGHWAY COMM", "STATE OF MISS HINDS
 * SCHOOL" (sixteenth-section land) etc. are agencies, classified as public instead.
 */
export const STATE_FORFEITED_RE =
  /^(STATE OF (MISS|MISSISSIPPI|MS)|(MISS|MISSISSIPPI|MS) SECRETARY OF STATE|SECRETARY OF STATE( OF (MISS|MISSISSIPPI|MS))?)( TAX (FORFEITED|LAND|SALE))?$/;

export const CITY_OF_JACKSON_RE = /^CITY OF JACKSON\b/;

export const PUBLIC_RE = new RegExp(
  [
    "^STATE OF (MISS|MISSISSIPPI|MS)\\b",
    "^CITY OF ",
    "^TOWN OF ",
    "\\bCOUNTY$",
    "^HINDS COUNTY\\b(?!.*\\b(LLC|INC)\\b)",
    "\\bHOUSING AUTHORITY\\b",
    "^HOUSING (& |AND )?URBAN DEV",
    "\\bSECRETARY OF (HUD|HOUSING)",
    "^JACKSON REDEVELOPMENT AUTHORITY",
    "^UNITED STATES\\b",
    "^USA$",
    "^(MISS|MISSISSIPPI) DEPT\\b",
    "^(MISS|MISSISSIPPI) (STATE )?(HIGHWAY|TRANSPORTATION)",
    "^JACKSON STATE UNIV(ERSITY)?$",
    "^UNIVERSITY OF (MISS|MISSISSIPPI)\\b(?!.*FOUNDATION)",
    "^HINDS COMM(UNITY)? COLLEGE",
    "\\bPUBLIC SCHOOL",
    "\\bSCHOOL DISTRICT\\b",
    "^HINDS COUNTY SCHOOL",
    "\\bBOARD OF (EDUCATION|SUPERVISORS)\\b",
  ].join("|"),
);

/** Decedent estates and heirs. "REAL ESTATE", "ESTATES LLC" are businesses, not estates. */
export const ESTATE_HEIRS_RE = /(\bHEIRS?\b|\bESTATE OF\b|\bEST OF\b|\bEST$|\bEST\b(?= ETAL| ET AL| C\/O)|(?<!REAL )\bESTATE$)/;

export function classifyOwner(name: string | null | undefined): OwnerType {
  const n = (name ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (STATE_FORFEITED_RE.test(n)) return "state_forfeited";
  if (CITY_OF_JACKSON_RE.test(n)) return "city";
  if (PUBLIC_RE.test(n)) return "public";
  return "private";
}

export function isEstateOrHeirs(name: string | null | undefined): boolean {
  return ESTATE_HEIRS_RE.test((name ?? "").toUpperCase().replace(/\s+/g, " ").trim());
}

/** Which ranking tab an owner type belongs on. */
export function rankingTab(t: OwnerType): "private" | "state" | "public" {
  return t === "private" ? "private" : t === "state_forfeited" ? "state" : "public";
}
