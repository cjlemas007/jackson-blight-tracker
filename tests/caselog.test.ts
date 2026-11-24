import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshTestDb } from "./helpers/testdb";
import { getPool } from "@/lib/db";
import { createStaff, type Staff } from "@/lib/auth/staff";
import { caseLogAddress, cellDate, planCaseLog, readCaseLog } from "@/lib/caseLog";
import { applyBatch, batchDetail, createAgendaBatch, createCaseLogBatch } from "@/lib/imports";

const HEADER = ["Record #", "Date Submitted", "Address", "Record Status", "Case Category", "Mbl", "Council RESOLUTION: Property Adjudicated A Menace"];
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("reading a Code Enforcement case log", () => {
  const table = [
    HEADER,
    ["CE-25-2751", d("2025-03-01"), "12 ELM ST, Jackson, MS 39203", "Active", "Demolition", "500-1", d("2025-11-18")],
    ["CE-26-0459", new Date("2026-08-20T17:13:16Z"), "0 N FARISH ST, Jackson, MS 00000", "Active", "Grass & Weeds", "500-2", null],
    ["CE-24-1899", "6/2/2024", "600 W CAPITOL ST, Unit AB, Jackson, MS 39201", "Closed", "Board-up", "110-12", null],
    ["not-a-case", d("2025-01-01"), "1 X ST", "Active", "Vehicle", "1-1", null],
    [null, null, null, null, null, null, null],
  ];

  it("finds the columns by name and cleans each value", () => {
    const { rows, problems } = readCaseLog(table);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      line: 2, record: "CE-25-2751", caseNo: "25-2751", opened: "2025-03-01", address: "12 ELM ST", parcelId: "500-1",
      category: "Demolition", status: "Active", adjudicated: "2025-11-18",
    });
    expect(rows[1]).toMatchObject({ caseNo: "26-459", opened: "2026-08-20", address: null });
    expect(rows[2]).toMatchObject({ opened: "2024-06-02", address: "600 W CAPITOL ST", status: "Closed" });
    expect(problems).toEqual(['row 5: "not-a-case" isn\'t a case number']);
  });

  it("reads columns in any order and rejects a sheet missing one", () => {
    const shuffled = [["Mbl", "Case Category", "Address", "Date Submitted", "Record #"], ["500-1", "Housing", "12 ELM ST", "2025-01-02", "CE-25-1"]];
    expect(readCaseLog(shuffled).rows[0]).toMatchObject({ caseNo: "25-1", parcelId: "500-1", category: "Housing", adjudicated: null });
    expect(() => readCaseLog([["Record #", "Address"], ["CE-25-1", "x"]])).toThrow(/Missing column\(s\): opened, parcelId, category/);
  });

  it("cleans dates and addresses", () => {
    expect(cellDate(d("2025-07-29"))).toBe("2025-07-29");
    expect(cellDate("07/29/2025")).toBe("2025-07-29");
    expect(cellDate("")).toBeNull();
    expect(caseLogAddress("918 N FARISH ST, Unit AB, Jackson, MS 39202")).toBe("918 N FARISH ST");
    expect(caseLogAddress("0 DUANE ST, Jackson, MS 39209")).toBeNull();
  });

  it("plans property cases, case-number-only cases and council adjudications", () => {
    const p = planCaseLog(readCaseLog(table).rows);
    expect(p.cases).toEqual([
      { caseNo: "25-2751", parcelId: "500-1", address: "12 ELM ST", date: "2025-03-01", substatus: "cited", note: "CE-25-2751, Demolition" },
      { caseNo: "24-1899", parcelId: "110-12", address: "600 W CAPITOL ST", date: "2024-06-02", substatus: "cited", note: "CE-24-1899, Board-up; case closed" },
    ]);
    expect(p.caseNumbers).toEqual([
      {
        caseNo: "26-459", parcelId: "500-2", address: null, date: "2026-08-20", substatus: "cited", note: "CE-26-0459, Grass & Weeds",
        skip: "Grass & Weeds case: links the case number only",
      },
    ]);
    expect(p.adjudications).toEqual([
      {
        caseNo: "25-2751", parcelId: "500-1", address: "12 ELM ST", date: "2025-11-18", substatus: "adjudicated",
        note: "CE-25-2751, Demolition; council resolution declaring the property a menace",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------------------
// Recording it (test database)
// ---------------------------------------------------------------------------------------

let pool: pg.Pool;
let admin: Staff;
let seq = 0;

async function parcel(id: string, num: number, street: string) {
  const lon = -90.205 + seq++ * 0.0002;
  await pool.query(
    `INSERT INTO data.landroll_parcels (county, parcel_id, owner_name, owner_type, row_hash, situs_address, situs_number, situs_street)
     VALUES ('Hinds', $1, 'OWNER ' || $1, 'private', 'x', $2, $3, $4)`,
    [id, `${num} ${street}`, num, street],
  );
  await pool.query(
    `INSERT INTO data.gis_parcels (county, parcel_id, geom, geom_3857, pt, owner_name_gis, loc_num, loc_street, tv_imp, row_hash)
     SELECT 'Hinds', $1, g, ST_Transform(g, 3857), ST_PointOnSurface(g), 'OWNER ' || $1, $2, $3, 50000, 'x'
     FROM (SELECT ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint($4::float8, 32.3), 4326), 0.00003)) g) s`,
    [id, num, street, lon],
  );
}
const events = async (id: string) =>
  (await pool.query("SELECT status::text || '/' || substatus s, effective_date::text d, note FROM app.status_events_live WHERE parcel_id = $1 ORDER BY id", [id])).rows;

beforeAll(async () => {
  pool = await freshTestDb();
  await pool.query(`INSERT INTO data.boundaries (kind, code, name, source, source_url, geom) VALUES
    ('city_limits', 'JACKSON', 'Test city', 't', 't', ST_Multi(ST_MakeEnvelope(-90.21, 32.29, -90.19, 32.31, 4326)))`);
  await parcel("500-1", 12, "ELM ST");
  await parcel("500-2", 14, "ELM ST");
  await parcel("500-3", 16, "ELM ST");
  await pool.query("SELECT app.rebuild_parcel_facts()");
  admin = (await createStaff({ email: "a@t.t", name: "Ada", role: "admin" }, null)).staff;
});
afterAll(async () => {
  await pool.end();
  await getPool().end();
});

describe("importing a case log", () => {
  it("cites property cases on their own dates, links case-only cases without changing status, and frees waiting council rows", async () => {
    // A council resolution that lists only case numbers waits for a case log.
    const council = await createAgendaBatch(admin, {
      title: "Minutes 11/18/2025", meetingDate: "2025-11-18",
      entries: [{ item: "Order 9", substatus: "adjudicated", caseNo: "25-2751" }, { item: "Order 9", substatus: "adjudicated", caseNo: "26-459" }],
    });
    expect((await batchDetail(council))!.stats).toMatchObject({ waiting: 2 });

    const cases = await createCaseLogBatch(admin, {
      title: "Case log: property cases", logDate: "2026-08-21",
      entries: [
        { caseNo: "25-2751", parcelId: "500-1", address: "12 ELM ST", date: "2025-03-01", substatus: "cited", note: "CE-25-2751, Demolition" },
        { caseNo: "25-3000", parcelId: "500-1", address: "12 ELM ST", date: "2025-03-01", substatus: "cited", note: "CE-25-3000, Board-up" }, // same day
        { caseNo: "25-3001", parcelId: null, address: "16 ELM ST", date: "2025-04-01", substatus: "cited", note: "CE-25-3001, Housing" },
      ],
    });
    const caseNumbers = await createCaseLogBatch(admin, {
      title: "Case log: case numbers only",
      entries: [{ caseNo: "26-459", parcelId: "500-2", address: null, date: "2026-08-20", substatus: "cited", note: "CE-26-0459, Grass & Weeds", skip: "Grass & Weeds case: links the case number only" }],
    });
    const cd = (await batchDetail(cases))!;
    expect(cd.kind).toBe("code_enforcement");
    expect(cd.source).toBe("city_record");
    expect(cd.stats).toEqual({ accepted: 3, review: 0, unmatched: 0, waiting: 0, preSkipped: 0 });
    expect(cd.rows.map((r: { match_method: string }) => r.match_method)).toEqual(["parcel_id", "parcel_id", "address_exact"]);
    expect((await batchDetail(caseNumbers))!.rows[0]).toMatchObject({ decision: "skipped", match_parcel_id: "500-2" });

    const a = await applyBatch(admin, cases);
    expect(a).toMatchObject({ events: 2, duplicates: 1, skipped: 0, learnedCases: 3 });
    expect(await events("500-1")).toEqual([{ s: "city_action/cited", d: "2025-03-01", note: "Case log: property cases, row 1: CE-25-2751, Demolition" }]);
    expect(await events("500-3")).toEqual([{ s: "city_action/cited", d: "2025-04-01", note: "Case log: property cases, row 3: CE-25-3001, Housing" }]);
    // The council batch is still under review, so its waiting row is matched in place.
    const councilRows = (await batchDetail(council))!.rows as { input_case_no: string; decision: string; match_parcel_id: string | null }[];
    expect(councilRows.find((r) => r.input_case_no === "25-2751")).toMatchObject({ decision: "accepted", match_parcel_id: "500-1" });
    expect(councilRows.find((r) => r.input_case_no === "26-459")).toMatchObject({ decision: "waiting_case" });

    // Recording the case-number batch writes no status but links the case.
    const b = await applyBatch(admin, caseNumbers);
    expect(b).toMatchObject({ events: 0, skipped: 1, learnedCases: 1 });
    expect(await events("500-2")).toEqual([]);
    expect((await batchDetail(council))!.rows.find((r: { input_case_no: string }) => r.input_case_no === "26-459")).toMatchObject({
      decision: "accepted", match_parcel_id: "500-2", match_method: "case_no",
    });
  });

  it("records adjudications on the resolution date and treats ones the minutes already recorded as duplicates", async () => {
    const council = (await pool.query("SELECT id FROM app.import_batches WHERE title = 'Minutes 11/18/2025'")).rows[0].id;
    await applyBatch(admin, council);
    const adj = await createCaseLogBatch(admin, {
      title: "Case log: council adjudications",
      entries: [
        { caseNo: "25-2751", parcelId: "500-1", date: "2025-11-18", substatus: "adjudicated", note: "CE-25-2751, Demolition; council resolution" },
        { caseNo: "25-3001", parcelId: null, address: "16 ELM ST", date: "2025-12-30", substatus: "adjudicated", note: "CE-25-3001, Housing; council resolution" },
      ],
    });
    expect(await applyBatch(admin, adj)).toMatchObject({ events: 1, duplicates: 1 });
    expect((await events("500-3")).map((e) => e.s + " " + e.d)).toEqual(["city_action/cited 2025-04-01", "city_action/adjudicated 2025-12-30"]);
    expect((await events("500-1")).map((e) => e.s + " " + e.d)).toEqual(["city_action/cited 2025-03-01", "city_action/adjudicated 2025-11-18"]);
  });

  it("leaves a case it can't place for review instead of waiting on itself", async () => {
    const b = await createCaseLogBatch(admin, {
      title: "Case log: unplaceable",
      entries: [{ caseNo: "25-9999", parcelId: "999-999", address: null, date: "2025-01-01", substatus: "cited" }],
    });
    const d = (await batchDetail(b))!;
    expect(d.stats).toMatchObject({ unmatched: 1, waiting: 0 });
    expect(d.rows[0].decision).toBe("pending");
  });

  it("validates entries", async () => {
    await expect(createCaseLogBatch(admin, { title: "x", entries: [] })).rejects.toThrow(/no cases/);
    await expect(createCaseLogBatch(admin, { title: "x", entries: [{ caseNo: "nope", date: "2025-01-01", substatus: "cited" }] })).rejects.toThrow(/case number/);
    await expect(createCaseLogBatch(admin, { title: "x", entries: [{ caseNo: "25-1", date: "soon", substatus: "cited" }] })).rejects.toThrow(/valid date/);
    await expect(createCaseLogBatch(admin, { title: "x", entries: [{ caseNo: "25-1", date: "2025-01-01", substatus: "fined" }] })).rejects.toThrow(/Unknown action/);
  });
});
