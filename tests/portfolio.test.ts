import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshTestDb } from "./helpers/testdb";
import { transformLandrollRow, type BqLandrollRow } from "../sync/jobs/landroll";
import { normalizeMailingKey } from "@/lib/normalize/address";

/**
 * Mattiace Development portfolio, using the real Hinds land roll rows (Nov 2026) for every
 * parcel with a Mattiace-related owner name or mailing address. The portfolio and its three
 * mailing addresses are seeded by db/migrations/logic/1002_portfolios.sql.
 */
const ROWS: [string, string, string, string, string][] = [
  // parcel, owner, mailing_street, mailing_city, mailing_state
  ["832-250-6", "MATTIACE DEV CO", "125 S CONGRESS ST STE 1800", "JACKSON", "MS"],
  ["47-28", "FONDREN PLACE DEVELOPMENT CO LLC", "125 S CONGRESS ST STE 1800", "JACKSON", "MS"],
  ["50-196", "MATTIACE THOMAS A", "125 S CONGRESS ST STE 1800", "JACKSON", "MS"],
  ["590-89", "MATTIACE T ANDREW & WALKER VICTORIA", "125 SOUTH CONGRESS ST 18TH FLOOR", "JACKSON", "MS"],
  ["47-34", "FONDREN PLACE DEVELOPMENT CO LLC", "125 SOUTH CONGRESS ST STE 1800", "JACKSON", "MS"],
  ["47-32", "FONDREN PLACE DEVELOPMENT CO LLC", "125 SOUTH CONGRESS ST STE 1800", "JACKSON", "MS"],
  ["577-314", "MATTIACE T ANDREW & JAN L", "4230 EASTOVER PL", "JACKSON", "MS"],
  ["511-48", "MATTIACE JASON", "4624 MAUREY RD", "JACKSON", "MS"],
  ["590-88", "MATTIACE T ANDREW", "ATTN: CHARLENE", "125 S CONGRESS ST STE 1800", ""],
  ["192-2", "LAMAR LIFE QALICB LLC", "ATTN: T ANDREW MATTIACE", "125 S CONGRESS ST STE 1800", ""],
  ["192-3", "MATTIACE OFFICE CO LLC", "P O BOX 13809", "JACKSON", "MS"],
  ["535-480", "HIGHLAND BLUFF NORTH LLC", "P O BOX 13809", "JACKSON", "MS"],
  ["645-285", "METRO INVESTORS", "P O BOX 13809", "JACKSON", "MS"],
  ["535-470-2", "HIGHLAND PLAZA LLC", "P O BOX 13809", "JACKSON", "MS"],
  ["535-492", "HIGHLAND BLUFF NORTH LLC", "P O BOX 13809", "JACKSON", "MS"],
  ["831-25-1", "MATTIACE DEV CO", "P O BOX 13809", "JACKSON", "MS"],
  ["832-250", "METRO INVESTORS LLC", "P O BOX 13809", "JACKSON", "MS"],
  // Unrelated owner at a similar address: must not be pulled in.
  ["999-1", "SOMEONE ELSE LLC", "125 S CONGRESS ST STE 1700", "JACKSON", "MS"],
];

let pool: pg.Pool;
let portfolio: Record<string, { portfolio_id: string; portfolio_source: string }>;

beforeAll(async () => {
  pool = await freshTestDb();
  const rows = ROWS.map(([parcel_id, owner_name, mailing_street, mailing_city, mailing_state]) =>
    transformLandrollRow({
      county: "Hinds", parcel_id, owner_name, mailing_street, mailing_city, mailing_state,
      mailing_zip: "", property_address: "0 TEST ST", appraised_total: "1", assessed_total: "1", acreage: "",
      legal_description: "", deed_date: "", year_built: "", loaded_at: "2026-06-03T21:34:44.409711",
    } satisfies BqLandrollRow),
  );
  await pool.query(
    `INSERT INTO data.landroll_parcels
     SELECT * FROM json_populate_recordset(NULL::data.landroll_parcels, $1::json)`,
    [JSON.stringify(rows.map((r) => ({ ...r, first_seen_at: new Date(), last_seen_at: new Date() })))],
  );
  await pool.query("SELECT app.refresh_parcel_registry()");
  portfolio = Object.fromEntries(
    (await pool.query("SELECT parcel_id, portfolio_id, portfolio_source FROM app.parcel_owner")).rows.map((r) => [
      r.parcel_id,
      r,
    ]),
  );
});
afterAll(async () => {
  await pool.end();
});

describe("Mattiace Development portfolio grouping", () => {
  const inPortfolio = () =>
    Object.entries(portfolio)
      .filter(([, v]) => v.portfolio_id === "MATTIACE_DEV")
      .map(([k]) => k)
      .sort();

  it("seeds keys that are already in normalized form", async () => {
    const { rows } = await pool.query("SELECT mailing_key FROM app.portfolio_mailing_keys WHERE portfolio_id = 'MATTIACE_DEV'");
    expect(rows.length).toBe(3);
    for (const r of rows) expect(normalizeMailingKey(r.mailing_key)).toBe(r.mailing_key);
  });

  it("groups the 14 parcels reachable from the portfolio's three mailing addresses", () => {
    expect(inPortfolio()).toEqual(
      [
        "832-250-6", "47-28", "50-196", // exact key
        "47-34", "47-32", // "125 SOUTH CONGRESS" normalized to "125 S CONGRESS"
        "590-88", "192-2", // ATTN line shifted the street into the city column
        "192-3", "535-480", "645-285", "535-470-2", "535-492", "831-25-1", "832-250", // P O BOX 13809
      ].sort(),
    );
  });

  it("records how each parcel was matched", () => {
    expect(portfolio["47-28"].portfolio_source).toBe("mailing_key");
    expect(portfolio["192-2"].portfolio_source).toBe("mailing_street");
  });

  it("leaves out family residences and a different suite", () => {
    expect(portfolio["577-314"].portfolio_id).not.toBe("MATTIACE_DEV"); // 4230 Eastover Pl
    expect(portfolio["511-48"].portfolio_id).not.toBe("MATTIACE_DEV"); // 4624 Maurey Rd
    expect(portfolio["999-1"].portfolio_id).not.toBe("MATTIACE_DEV");
  });

  it("does not guess '18TH FLOOR' = 'STE 1800' (needs an admin override row)", () => {
    expect(portfolio["590-89"].portfolio_id).toBe("MK:125 S CONGRESS ST 18TH FL|JACKSON|MS");
  });

  it("lets an owner-name override win", async () => {
    await pool.query(
      `INSERT INTO app.portfolio_owner_overrides (owner_name, portfolio_id, created_by)
       VALUES ('MATTIACE T ANDREW & WALKER VICTORIA', 'MATTIACE_DEV', 'test')`,
    );
    const { rows } = await pool.query(
      "SELECT portfolio_id, portfolio_source, attributed_owner FROM app.parcel_owner WHERE parcel_id = '590-89'",
    );
    expect(rows[0]).toEqual({
      portfolio_id: "MATTIACE_DEV",
      portfolio_source: "override",
      attributed_owner: "T. Andrew Mattiace / Mattiace Development",
    });
  });
});
