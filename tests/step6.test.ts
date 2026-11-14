import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshTestDb } from "./helpers/testdb";
import { getPool } from "@/lib/db";
import { createStaff, type Staff } from "@/lib/auth/staff";
import { completeSurvey, markParcel, startSurvey, surveyParcels, surveyProgress } from "@/lib/surveys";
import { listCorrections, resolveCorrection, submitCorrection, submitterHash } from "@/lib/corrections";
import { buildExport, exportToCsv } from "@/lib/exports";
import { movers, weeklyDigest } from "@/lib/digest";
import { headline, streetRankings } from "@/lib/rankings";
import { parseCsv } from "@/lib/csv";

let pool: pg.Pool;
let staff: Staff;
let admin: Staff;
let today: string;
let seq = 0;
const daysAgo = (n: number) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

async function parcel(id: string, num: number, street: string, owner = `OWNER ${id}`) {
  const lon = -90.205 + seq++ * 0.0002;
  await pool.query(
    `INSERT INTO data.landroll_parcels (county, parcel_id, owner_name, owner_type, row_hash, situs_address, situs_number, situs_street, mailing_key)
     VALUES ('Hinds', $1, $2, 'private', 'x', $3, $4, $5, $2 || '|JACKSON|MS')`,
    [id, owner, `${num} ${street}`, num, street],
  );
  await pool.query(
    `INSERT INTO data.gis_parcels (county, parcel_id, geom, geom_3857, pt, owner_name_gis, loc_num, loc_street, row_hash)
     SELECT 'Hinds', $1, g, ST_Transform(g, 3857), ST_PointOnSurface(g), $2, $3, $4, 'x'
     FROM (SELECT ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint($5::float8, 32.3), 4326), 0.00003)) g) s`,
    [id, owner, num, street, lon],
  );
}
const verify = (id: string, date: string) =>
  pool.query(
    `INSERT INTO app.status_events (county, parcel_id, status, effective_date, source, recorded_by)
     VALUES ('Hinds', $1, 'verified_blighted', $2, 'admin_entry', 'test')`,
    [id, date],
  );

beforeAll(async () => {
  pool = await freshTestDb();
  today = (await pool.query("SELECT (now() AT TIME ZONE 'America/Chicago')::date::text d")).rows[0].d;
  await pool.query(`INSERT INTO data.boundaries (kind, code, name, source, source_url, geom) VALUES
    ('city_limits', 'JACKSON', 'Test city', 't', 't', ST_Multi(ST_MakeEnvelope(-90.21, 32.29, -90.19, 32.31, 4326))),
    ('ward', '1', 'Ward 1', 't', 't', ST_Multi(ST_MakeEnvelope(-90.21, 32.29, -90.19, 32.31, 4326)))`);
  for (let i = 1; i <= 10; i++) await parcel(`M${i}`, 100 + i, "MAPLE ST", i <= 3 ? 'SMITH, "JR" & CO LLC' : `OWNER M${i}`);
  await parcel("X1", 5, "OTHER ST");
  await pool.query("SELECT app.rebuild_parcel_facts()");
  staff = (await createStaff({ email: "s@t.t", name: "Sam", role: "contributor" }, null)).staff;
  admin = (await createStaff({ email: "a@t.t", name: "Ada", role: "admin" }, null)).staff;
  await verify("M1", daysAgo(20));
  await verify("M2", daysAgo(3)); // this week-ish: a mover
});
afterAll(async () => {
  await pool.end();
  await getPool().end();
});

describe("survey mode", () => {
  let survey: string;

  it("starts a survey on a street and lists its parcels odd side first", async () => {
    await expect(startSurvey(staff, { kind: "street", value: "NOWHERE ST" })).rejects.toThrow(/No Jackson parcels/);
    survey = await startSurvey(staff, { kind: "street", value: "MAPLE ST" });
    const rows = await surveyParcels(survey);
    expect(rows).toHaveLength(10);
    expect(rows.slice(0, 5).map((r) => r.situs_number)).toEqual([101, 103, 105, 107, 109]);
    expect(await surveyProgress(survey)).toMatchObject({ total: 10, marked: 0 });
  });

  it("records marks, insists a 'blighted' mark has a photo submission, and rejects parcels outside the scope", async () => {
    await markParcel(staff, survey, { parcelId: "M3", result: "not_blighted" });
    await markParcel(staff, survey, { parcelId: "M4", result: "inaccessible", note: "fenced" });
    await expect(markParcel(staff, survey, { parcelId: "M5", result: "blighted" })).rejects.toThrow(/photo submission/);
    await expect(markParcel(staff, survey, { parcelId: "X1", result: "not_blighted" })).rejects.toThrow(/isn't part of this survey/);
    const sub = (
      await pool.query(
        `INSERT INTO app.submissions (county, parcel_id, submitted_by, status, kind, conditions, vantage_confirmed, submitted_at)
         VALUES ('Hinds', 'M5', $1, 'pending', 'initial', '{vacant_open}', true, now()) RETURNING id`,
        [staff.id],
      )
    ).rows[0].id;
    await markParcel(staff, survey, { parcelId: "M5", result: "blighted", submissionId: sub });
    expect(await surveyProgress(survey)).toMatchObject({ marked: 3, blighted: 1, not_blighted: 1, inaccessible: 1 });
    expect((await surveyParcels(survey, { todoOnly: true })).map((r) => r.parcel_id)).not.toContain("M3");
  });

  it("turns a street into a fully surveyed one, so its share becomes a rate", async () => {
    let row = (await streetRankings({ minParcels: 1 })).find((r) => r.street_name === "MAPLE ST")!;
    expect(row.fully_surveyed).toBe(false);
    for (const id of ["M1", "M2", "M6", "M7", "M8", "M9", "M10"]) await markParcel(staff, survey, { parcelId: id, result: "not_blighted" });
    row = (await streetRankings({ minParcels: 1 })).find((r) => r.street_name === "MAPLE ST")!;
    // M4 was inaccessible: 9 of 10 surveyed = 90% < 95%, still "reported so far".
    expect([row.surveyed, row.fully_surveyed]).toEqual([9, false]);
    await markParcel(staff, survey, { parcelId: "M4", result: "not_blighted", note: "gate open today" });
    row = (await streetRankings({ minParcels: 1 })).find((r) => r.street_name === "MAPLE ST")!;
    expect([row.surveyed, row.fully_surveyed]).toEqual([10, true]);
    expect((await headline()).surveyed).toBe(10);
  });

  it("closes when finished", async () => {
    await completeSurvey(staff, survey);
    await expect(markParcel(staff, survey, { parcelId: "M1", result: "not_blighted" })).rejects.toThrow(/finished/);
  });
});

describe("corrections", () => {
  const hash = submitterHash("203.0.113.9", "test-agent");

  it("validates and stores a request without storing the IP", async () => {
    await expect(submitCorrection({ parcelId: "M1", category: "nope", details: "x".repeat(20) }, hash)).rejects.toThrow(/Pick/);
    await expect(submitCorrection({ parcelId: "M1", category: "other", details: "short" }, hash)).rejects.toThrow(/at least 10/);
    await expect(submitCorrection({ parcelId: "M1", category: "other", details: "long enough text", email: "bad" }, hash)).rejects.toThrow(/email/);
    await expect(submitCorrection({ parcelId: "NOPE", category: "other", details: "long enough text" }, hash)).rejects.toThrow(/Unknown parcel/);
    const id = await submitCorrection({ parcelId: "M1", category: "fixed_or_demolished", details: "This house was torn down last month.", email: "me@example.com" }, hash);
    const row = (await pool.query("SELECT * FROM app.corrections WHERE id = $1", [id])).rows[0];
    expect(row.submitter_hash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain("203.0.113.9");
  });

  it("rate-limits to 5 an hour per requester", async () => {
    const h = submitterHash("198.51.100.1", "spammer");
    for (let i = 0; i < 5; i++) await submitCorrection({ portfolioId: "MK:X", category: "other", details: `request number ${i}` }, h);
    await expect(submitCorrection({ portfolioId: "MK:X", category: "other", details: "request number 6" }, h)).rejects.toThrow(/Too many/);
    // A different requester isn't affected.
    await submitCorrection({ portfolioId: "MK:X", category: "other", details: "someone else here" }, submitterHash("198.51.100.2", "x"));
  });

  it("is resolved by an admin with a note", async () => {
    const [first] = await listCorrections("open");
    await expect(resolveCorrection(staff, first.id, "corrected", "done")).rejects.toThrow(/Admins/);
    await expect(resolveCorrection(admin, first.id, "corrected", " ")).rejects.toThrow(/Note/);
    await resolveCorrection(admin, first.id, "corrected", "Recorded demolition from city list");
    expect((await listCorrections("corrected")).map((c) => c.id)).toEqual([first.id]);
  });
});

describe("CSV exports", () => {
  it("exports owner rankings with commas and quotes escaped, and a BOM for Excel", async () => {
    await verify("M3", daysAgo(2));
    const e = (await buildExport("owners", new URLSearchParams("tab=private")))!;
    const csv = exportToCsv(e);
    expect(csv.startsWith("﻿")).toBe(true);
    const rows = parseCsv(csv.slice(1));
    expect(rows[0]).toEqual(e.header);
    const smith = rows.find((r) => r[1] === 'SMITH, "JR" & CO LLC')!;
    expect(smith.slice(3, 4)).toEqual(["3"]); // M1, M2, M3 all verified, grouped by mailing key
    expect(csv).toContain('"SMITH, ""JR"" & CO LLC"');
  });

  it("exports streets with the same filters as the page", async () => {
    const e = (await buildExport("streets", new URLSearchParams("min=1&coverage=surveyed")))!;
    expect(e.rows.map((r) => r[1])).toEqual(["MAPLE ST"]);
    expect(e.header).toContain("share_label");
  });

  it("returns nothing for an owner that doesn't exist", async () => {
    expect(await buildExport("owner", new URLSearchParams("id=NOPE"))).toBeNull();
  });
});

describe("weekly digest and movers", () => {
  it("counts this week's changes and finds the biggest movers", async () => {
    const d = await weeklyDigest();
    expect(d.thisWeek.surveyed_parcels).toBe(10);
    expect(d.open.corrections).toBeGreaterThan(0);
    const m = await movers(7);
    // MAPLE ST: M2 (3 days ago) and M3 (2 days ago) are new this week; M1 was already blighted.
    expect(m.streets.find((s) => s.key === "MAPLE ST")).toMatchObject({ now: 3, before: 1, change: 2 });
    expect(m.wards[0]).toMatchObject({ label: "Ward 1", change: 2 });
  });
});
