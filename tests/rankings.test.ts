import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshTestDb } from "./helpers/testdb";
import { getPool } from "@/lib/db";
import { areaRankings, headline, ownerRankings, streetRankings } from "@/lib/rankings";
import { blightRateLabel, coverageLabel, isFullySurveyed } from "@/lib/coverage";

/**
 * A tiny city: west half is Ward 1, east half Ward 2. Parcels sit on ELM ST (12 parcels),
 * PINE ST (10, exactly the minimum), OAK ST (3, below it). Statuses are set with dated events
 * relative to "today" so the as-of queries are exercised.
 */
let pool: pg.Pool;
let today: string;
let staffId: string;
let seq = 0;
const daysAgo = (n: number) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

async function parcel(
  id: string,
  street: string,
  ward: 1 | 2,
  owner: { name: string; type?: string; mailing?: string; estate?: boolean; homestead?: boolean; due?: number },
) {
  const lon = (ward === 1 ? -90.205 : -90.195) + (seq++ % 40) * 0.0001;
  await pool.query(
    `INSERT INTO data.landroll_parcels (county, parcel_id, owner_name, owner_type, owner_estate_heirs, mailing_key, situs_street, row_hash)
     VALUES ('Hinds', $1, $2, $3, $4, $5, $6, 'x')`,
    [id, owner.name, owner.type ?? "private", owner.estate ?? false, owner.mailing ?? `${owner.name}|JACKSON|MS`, street],
  );
  await pool.query(
    `INSERT INTO data.gis_parcels (county, parcel_id, geom, geom_3857, pt, owner_name_gis, loc_street, homestead_app, row_hash)
     SELECT 'Hinds', $1, g, ST_Transform(g, 3857), ST_PointOnSurface(g), $2, $3, $4, 'x'
     FROM (SELECT ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint($5::float8, 32.3), 4326), 0.00003)) g) s`,
    [id, owner.name, street, owner.homestead ? "12345" : null, lon],
  );
  if (owner.due) {
    await pool.query("INSERT INTO data.parcel_tax (county, parcel_id, current_due, latest_tax_year) VALUES ('Hinds', $1, $2, 2025)", [id, owner.due]);
  }
}

async function event(id: string, status: string, substatus: string | null, date: string) {
  await pool.query(
    `INSERT INTO app.status_events (county, parcel_id, status, substatus, effective_date, source, recorded_by)
     VALUES ('Hinds', $1, $2, $3, $4, 'admin_entry', 'test')`,
    [id, status, substatus, date],
  );
}
const verify = (id: string, ago = 20) => event(id, "verified_blighted", null, daysAgo(ago));
async function survey(id: string, result = "not_blighted", ago = 10) {
  await pool.query(
    "INSERT INTO app.parcel_surveys (county, parcel_id, surveyed_on, result, surveyed_by) VALUES ('Hinds', $1, $2, $3, $4)",
    [id, daysAgo(ago), result, staffId],
  );
}

beforeAll(async () => {
  pool = await freshTestDb();
  today = (await pool.query("SELECT (now() AT TIME ZONE 'America/Chicago')::date::text d")).rows[0].d;
  await pool.query(`
    INSERT INTO data.boundaries (kind, code, name, source, source_url, geom) VALUES
      ('city_limits', 'JACKSON', 'Test city', 't', 't', ST_Multi(ST_MakeEnvelope(-90.21, 32.29, -90.19, 32.31, 4326))),
      ('ward', '1', 'Ward 1', 't', 't', ST_Multi(ST_MakeEnvelope(-90.21, 32.29, -90.2, 32.31, 4326))),
      ('ward', '2', 'Ward 2', 't', 't', ST_Multi(ST_MakeEnvelope(-90.2, 32.29, -90.19, 32.31, 4326)))`);

  // ELM ST: 12 parcels in Ward 1, owned by landlord A (mailing key A) except two.
  for (let i = 1; i <= 10; i++) await parcel(`E${i}`, "ELM ST", 1, { name: "LANDLORD A LLC", mailing: "1 MAIN ST|JACKSON|MS", due: 100 });
  await parcel("E11", "ELM ST", 1, { name: "SMITH JOHN", homestead: true, mailing: "1 MAIN ST|JACKSON|MS" }); // homestead, same mailing
  await parcel("E12", "ELM ST", 1, { name: "JONES MARY EST", estate: true });
  // PINE ST: 10 parcels in Ward 2.
  for (let i = 1; i <= 8; i++) await parcel(`P${i}`, "PINE ST", 2, { name: `OWNER P${i}` });
  await parcel("P9", "PINE ST", 2, { name: "STATE OF MISS", type: "state_forfeited" });
  await parcel("P10", "PINE ST", 2, { name: "CITY OF JACKSON", type: "city" });
  // OAK ST: 3 parcels in Ward 2, all blighted, below the 10-parcel minimum.
  for (let i = 1; i <= 3; i++) await parcel(`O${i}`, "OAK ST", 2, { name: `OWNER O${i}` });
  await pool.query("SELECT app.rebuild_parcel_facts()");
  staffId = (
    await pool.query("INSERT INTO app.staff (email, name, role, password_hash) VALUES ('t@t.t', 'T', 'admin', 'x') RETURNING id")
  ).rows[0].id;

  // ELM: E1, E2 blighted (landlord A); E3 demolished 5 days ago (was blighted); E11 homestead blighted;
  //      E12 estate blighted; E4 submitted only (not public, never counts).
  await verify("E1", 60);
  await verify("E2", 10); // verified 10 days ago: counts now, not 30 days ago
  await verify("E3", 60);
  await event("E3", "resolved", "demolished", today);
  await verify("E11");
  await verify("E12");
  await event("E4", "submitted", null, daysAgo(3));
  // PINE: P1-P3 blighted, P4 under city action, P9 state-owned blighted, P10 city-owned blighted.
  for (const id of ["P1", "P2", "P3", "P9", "P10"]) await verify(id);
  await verify("P4", 100);
  await event("P4", "city_action", "cited", daysAgo(40));
  // P5 was verified, then found not blighted on re-check: resolved but must not count as "resolved to date".
  await verify("P5", 50);
  await event("P5", "resolved", "rejected_on_recheck", daysAgo(45));
  // OAK: all three blighted.
  for (const id of ["O1", "O2", "O3"]) await verify(id);
  // Surveys: every PINE parcel (fully surveyed), half of ELM.
  for (let i = 1; i <= 10; i++) await survey(`P${i}`, i <= 4 || i >= 9 ? "blighted" : "not_blighted");
  for (let i = 1; i <= 6; i++) await survey(`E${i}`);
  await survey("O1", "not_blighted", 400); // too old to count
});
afterAll(async () => {
  await pool.end();
  await getPool().end();
});

describe("street rankings", () => {
  it("divides blighted by all parcels on the street and enforces the 10-parcel minimum", async () => {
    const rows = await streetRankings({});
    expect(rows.map((r) => [r.street_name, r.total_parcels, r.blighted])).toEqual([
      ["PINE ST", 10, 6], // P1-P4 (city action counts), P9, P10
      ["ELM ST", 12, 4], // E1, E2, E11 (homestead), E12 (estate). E3 demolished, E4 only submitted.
    ]);
    expect(rows[0].share_blighted).toBeCloseTo(0.6, 10);
    expect(rows[1].share_blighted).toBeCloseTo(4 / 12, 10);
    expect(rows.find((r) => r.street_name === "OAK ST")).toBeUndefined(); // 3 parcels < 10
  });

  it("lets a lower minimum in, and sorts by count or by percentage", async () => {
    const byPct = await streetRankings({ minParcels: 3, sort: "pct" });
    expect(byPct.map((r) => r.street_name)).toEqual(["OAK ST", "PINE ST", "ELM ST"]); // 100%, 60%, 33%
    const byCount = await streetRankings({ minParcels: 3, sort: "count" });
    expect(byCount.map((r) => r.street_name)).toEqual(["PINE ST", "ELM ST", "OAK ST"]); // 6, 4, 3
  });

  it("reports coverage and can show fully surveyed streets only", async () => {
    const rows = await streetRankings({ minParcels: 3 });
    const by = Object.fromEntries(rows.map((r) => [r.street_name, r]));
    expect([by["PINE ST"].surveyed, by["PINE ST"].fully_surveyed]).toEqual([10, true]);
    expect([by["ELM ST"].surveyed, by["ELM ST"].fully_surveyed]).toEqual([6, false]);
    expect([by["OAK ST"].surveyed, by["OAK ST"].fully_surveyed]).toEqual([0, false]); // year-old survey expired
    expect((await streetRankings({ minParcels: 3, surveyedOnly: true })).map((r) => r.street_name)).toEqual(["PINE ST"]);
  });
});

describe("owner rankings", () => {
  it("groups by portfolio and leaves homestead and estate parcels out of the ranked count", async () => {
    const rows = await ownerRankings("private");
    const a = rows.find((r) => r.portfolio_id === "MK:1 MAIN ST|JACKSON|MS")!;
    // Same mailing key: 10 LLC parcels + the homestead parcel = 11 parcels.
    expect(a.total_parcels).toBe(11);
    expect(a.blighted).toBe(2); // E1, E2 (E3 demolished; E11 homestead excluded)
    expect(a.blighted_excluded).toBe(1); // E11
    expect(a.share_blighted).toBeCloseTo(2 / 11, 10);
    expect(a.taxes_owed).toBe(1000);
    expect(a.other_names).toBe(1); // LANDLORD A LLC + SMITH JOHN
    // The estate's only blighted parcel is excluded, so the estate isn't ranked at all.
    expect(rows.some((r) => r.name === "JONES MARY EST")).toBe(false);
    expect(rows[0].portfolio_id).toBe(a.portfolio_id); // 2 beats the single-parcel owners
  });

  it("puts the State and the City on their own tabs", async () => {
    expect((await ownerRankings("state")).map((r) => [r.portfolio_id, r.blighted])).toEqual([["STATE_OF_MISSISSIPPI", 1]]);
    expect((await ownerRankings("public")).map((r) => [r.portfolio_id, r.blighted])).toEqual([["CITY_OF_JACKSON", 1]]);
    expect((await ownerRankings("private")).some((r) => r.portfolio_id === "STATE_OF_MISSISSIPPI")).toBe(false);
  });
});

describe("area rankings", () => {
  it("counts by ward, with change over 30 and 90 days from the dated history", async () => {
    const rows = Object.fromEntries((await areaRankings("ward")).map((r) => [r.code, r]));
    // Ward 1 (ELM): now E1, E2, E11, E12 = 4. 30 days ago: E1, E3 (not yet demolished), E11? no:
    // E11/E12 verified 20 days ago. So 30d ago = E1, E3 = 2. 90 days ago = none.
    expect([rows["1"].total_parcels, rows["1"].blighted, rows["1"].blighted_30d_ago, rows["1"].blighted_90d_ago]).toEqual([12, 4, 2, 0]);
    // Ward 2 (PINE + OAK): now P1-P4, P9, P10, O1-O3 = 9. 30 days ago: P4 (cited 40 days ago) only;
    // P5 was rejected on re-check 45 days ago. 90 days ago: P4 (verified 100 days ago).
    expect([rows["2"].total_parcels, rows["2"].blighted, rows["2"].blighted_30d_ago, rows["2"].blighted_90d_ago]).toEqual([13, 9, 1, 1]);
    expect(rows["2"].share_blighted).toBeCloseTo(9 / 13, 10);
  });

  it("can restrict to fully surveyed areas", async () => {
    expect(await areaRankings("ward", true)).toEqual([]); // Ward 2 is 10/13 surveyed: not enough
  });
});

describe("headline counters", () => {
  it("counts blighted, state-owned, demolished this week and resolved to date", async () => {
    const h = await headline();
    expect(h).toMatchObject({
      blighted: 13, // 4 in Ward 1 + 9 in Ward 2
      total_parcels: 25,
      state_owned_blighted: 1,
      demolished_this_week: 1, // E3, today
      resolved_to_date: 1, // E3; P5's "rejected on re-check" isn't a resolution of blight
      surveyed: 16,
    });
  });
});

describe("coverage labels", () => {
  it("calls a share a rate only when the area is fully surveyed", () => {
    expect(isFullySurveyed(95, 100)).toBe(true);
    expect(isFullySurveyed(94, 100)).toBe(false);
    expect(isFullySurveyed(0, 0)).toBe(false);
    expect(blightRateLabel(6, 10, 10)).toBe("60.0%");
    expect(blightRateLabel(4, 12, 6)).toBe("at least 33.3% (reported so far)");
    expect(coverageLabel(6, 12)).toBe("50% of parcels surveyed");
  });
});
