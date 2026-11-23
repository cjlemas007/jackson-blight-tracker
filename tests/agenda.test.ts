import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshTestDb } from "./helpers/testdb";
import { getPool } from "@/lib/db";
import { createStaff, type Staff } from "@/lib/auth/staff";
import {
  findRefs, findingsTargets, groupTargets, looksLikeMinutes, minutesAction, normalizeCaseNo, parseMeetingDate, readAgendaPdf, readVote,
  splitAgenda, splitMinutes, suggestAction, type PdfLine,
} from "@/lib/agendaPdf";
import { applyBatch, batchDetail, createAgendaBatch, createCsvBatch, mapBatch, updateRow } from "@/lib/imports";

// ---------------------------------------------------------------------------------------
// Reading the PDF (no database)
// ---------------------------------------------------------------------------------------

describe("reading a City Council agenda PDF", () => {
  it("finds the meeting, the blight items and every case, parcel and address in the Nov 17, 2026 agenda", async () => {
    const buf = readFileSync(path.join(import.meta.dirname, "fixtures/11-17_JacksonCC.pdf"));
    const r = await readAgendaPdf(new Uint8Array(buf));
    expect(r.meetingDate).toBe("2026-11-17");
    expect(r.title).toBe("Regular meeting of the City Council");
    expect(r.items).toHaveLength(35);
    const relevant = r.items.filter((i) => i.relevant);
    expect(relevant.map((i) => [i.number, i.substatus])).toEqual([
      ["3", "adjudicated"],
      ["4", "lot_cleanup_ordered"],
      ["5", "lot_cleanup_ordered"],
    ]);
    const menace = relevant[0];
    expect(menace.section).toBe("CONSENT AGENDA");
    expect(menace.targets).toHaveLength(38);
    expect(menace.targets.every((t) => t.caseNo && !t.parcelId && !t.address)).toBe(true);
    const cases = menace.targets.map((t) => t.caseNo);
    expect(cases.slice(0, 3)).toEqual(["25-2751", "25-1977", "25-2216"]);
    expect(cases).toContain("26-1984"); // printed "26--1984"
    expect(cases).toContain("26-459");
    expect(cases).not.toContain("21-19"); // the statute number isn't a case
    expect(relevant[1].targets).toEqual([{ caseNo: "24-1899", parcelId: "110-12", address: "600 W CAPITOL ST" }]);
    expect(relevant[2].targets).toEqual([{ caseNo: "25-1397", parcelId: "414-45", address: "2615 QUEENSROAD AVENUE" }]);
    // Tower-site leases name addresses but aren't about blight.
    expect(r.items.find((i) => i.number === "6")!.relevant).toBe(false);
  });

  it("normalizes case numbers", () => {
    expect(normalizeCaseNo("CE-24-1899")).toBe("24-1899");
    expect(normalizeCaseNo("26--1984")).toBe("26-1984");
    expect(normalizeCaseNo("25–0459")).toBe("25-459");
    expect(normalizeCaseNo("2025-1")).toBeNull();
    expect(normalizeCaseNo("hello")).toBeNull();
  });

  it("suggests an action only for items about nuisance property", () => {
    expect(suggestAction("ORDER AUTHORIZING DEMOLITION OF STRUCTURES DECLARED A MENACE")).toBe("demolition_ordered");
    expect(suggestAction("RESOLUTION DECLARING CERTAIN PARCELS A MENACE PURSUANT TO 21-19-11")).toBe("adjudicated");
    expect(suggestAction("CONTRACT TO CUT GRASS ON PRIVATE PROPERTY WHICH CONSTITUTE A MENACE")).toBe("lot_cleanup_ordered");
    expect(suggestAction("ORDER ASSESSING A LIEN FOR COSTS OF CLEANING PROPERTY UNDER 21-19-11")).toBe("lien_filed");
    expect(suggestAction("ORDER AUTHORIZING THE MAYOR TO EXECUTE A LEASE AT 3551 JOHN R. LYNCH STREET")).toBeNull();
    expect(suggestAction("CONTRACT TO CUT GRASS AT CITY PARKS")).toBeNull();
  });

  it("groups one property's case, parcel and address, and splits lists", () => {
    const one = findRefs("FOR CASE #CE-25-1397 LOCATED AT 2615 QUEENSROAD AVENUE– PARCEL #414-45 – $1,640.00");
    expect(groupTargets(one)).toEqual([{ caseNo: "25-1397", parcelId: "414-45", address: "2615 QUEENSROAD AVENUE" }]);
    const list = findRefs("PARCELS #12-3, 12-4 AND 12-5 BASED ON HEARINGS FOR THE FOLLOWING CASES: 25-1 25-2");
    expect(groupTargets(list)).toEqual([
      { caseNo: null, parcelId: "12-3", address: null },
      { caseNo: null, parcelId: "12-4", address: null },
      { caseNo: null, parcelId: "12-5", address: null },
      { caseNo: "25-1", parcelId: null, address: null },
      { caseNo: "25-2", parcelId: null, address: null },
    ]);
  });

  it("splits items at the numbered margin and stops at section headings", () => {
    const L = (x: number, text: string): PdfLine => ({ page: 1, x, text });
    const r = splitAgenda([
      L(250, "REGULAR MEETING OF THE CITY COUNCIL"),
      L(260, "March 3, 2026"),
      L(97, "CONSENT AGENDA"),
      L(97, "1. ORDER TO DEMOLISH STRUCTURE DECLARED A MENACE"),
      L(138, "LOCATED AT 10 OAK ST - PARCEL #200-1"),
      L(97, "REGULAR AGENDA"),
      L(138, "STRAY TEXT THAT BELONGS TO NO ITEM"),
      L(97, "2."),
      L(138, "CLAIMS"),
    ]);
    expect(r.meetingDate).toBe("2026-03-03");
    expect(r.items.map((i) => [i.number, i.section, i.text])).toEqual([
      ["1", "CONSENT AGENDA", "ORDER TO DEMOLISH STRUCTURE DECLARED A MENACE LOCATED AT 10 OAK ST - PARCEL #200-1"],
      ["2", "REGULAR AGENDA", "CLAIMS"],
    ]);
    expect(r.items[0].targets).toEqual([{ caseNo: null, parcelId: "200-1", address: "10 OAK ST" }]);
  });
});

// ---------------------------------------------------------------------------------------
// Recording it (test database)
// ---------------------------------------------------------------------------------------

let pool: pg.Pool;
let admin: Staff;
let seq = 0;
const files = new Map<string, Buffer>();
const read = async (k: string) => files.get(k) ?? null;

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
async function csvDoc(text: string) {
  const { rows } = await pool.query(
    `INSERT INTO app.documents (kind, storage_key, original_name, mime_type, uploaded_by, uploaded_at)
     VALUES ('csv', 'docs/private/' || gen_random_uuid() || '.csv', 'cases.csv', 'text/csv', $1, now()) RETURNING id, storage_key`,
    [admin.id],
  );
  files.set(rows[0].storage_key, Buffer.from(text));
  return rows[0].id as string;
}
const events = async (id: string) =>
  (await pool.query("SELECT status::text || '/' || substatus s, effective_date::text d FROM app.status_events_live WHERE parcel_id = $1 ORDER BY id", [id])).rows;

beforeAll(async () => {
  pool = await freshTestDb();
  await pool.query(`INSERT INTO data.boundaries (kind, code, name, source, source_url, geom) VALUES
    ('city_limits', 'JACKSON', 'Test city', 't', 't', ST_Multi(ST_MakeEnvelope(-90.21, 32.29, -90.19, 32.31, 4326)))`);
  await parcel("110-12", 600, "W CAPITOL ST");
  await parcel("414-45", 2615, "QUEENSROAD AVE");
  await parcel("500-1", 12, "ELM ST");
  await parcel("500-2", 14, "ELM ST");
  await pool.query("SELECT app.rebuild_parcel_facts()");
  admin = (await createStaff({ email: "a@t.t", name: "Ada", role: "admin" }, null)).staff;
});
afterAll(async () => {
  await pool.end();
  await getPool().end();
});

describe("recording an agenda read from a PDF", () => {
  it("records named parcels, holds case-only rows until a case log links them, then offers them for review", async () => {
    const b = await createAgendaBatch(admin, {
      title: "Council 11/17",
      meetingDate: "2026-11-17",
      entries: [
        { item: "3", substatus: "adjudicated", caseNo: "25-2751" },
        { item: "3", substatus: "adjudicated", caseNo: "26--1984" },
        { item: "4", substatus: "lot_cleanup_ordered", caseNo: "CE-24-1899", parcelId: "110-12", address: "600 W CAPITOL ST" },
        { item: "5", substatus: "lot_cleanup_ordered", caseNo: "25-1397", address: "2615 QUEENSROAD AVENUE" },
      ],
    });
    const d = (await batchDetail(b))!;
    expect(d.stats).toEqual({ accepted: 2, review: 0, unmatched: 0, waiting: 2, preSkipped: 0 });
    const byItem = Object.fromEntries(d.rows.map((r: { input_case_no: string; decision: string }) => [r.input_case_no, r.decision]));
    expect(byItem).toEqual({ "25-2751": "waiting_case", "26-1984": "waiting_case", "24-1899": "accepted", "25-1397": "accepted" });

    // Waiting rows don't block recording the rest.
    const applied = await applyBatch(admin, b);
    expect(applied).toMatchObject({ events: 2, waiting: 2, learnedCases: 2, followUps: [] });
    expect(await events("110-12")).toEqual([{ s: "city_action/lot_cleanup_ordered", d: "2026-11-17" }]);
    expect(await events("414-45")).toEqual([{ s: "city_action/lot_cleanup_ordered", d: "2026-11-17" }]);
    // The cleanup rows taught us their case numbers.
    const cc = (await pool.query("SELECT case_no, parcel_id FROM app.code_cases ORDER BY case_no")).rows;
    expect(cc).toEqual([{ case_no: "24-1899", parcel_id: "110-12" }, { case_no: "25-1397", parcel_id: "414-45" }]);

    // A code-enforcement log links one waiting case. Recording it creates a follow-up batch for the agenda.
    const log = await createCsvBatch(admin, { kind: "code_enforcement", title: "Case log", documentId: await csvDoc("Case,Address,Opened\n25-02751,12 Elm St,2025-03-01\n") }, read);
    await mapBatch(admin, log, { mapping: { caseNo: "Case", address: "Address", date: "Opened" }, substatus: "cited" });
    const logApplied = await applyBatch(admin, log);
    expect(logApplied.learnedCases).toBe(1);
    expect(logApplied.followUps).toHaveLength(1);

    const fu = (await batchDetail(logApplied.followUps[0]))!;
    expect(fu.status).toBe("review");
    expect(String(fu.default_date).slice(0, 10)).toBe("2026-11-17");
    expect(fu.rows.map((r: { input_case_no: string; match_parcel_id: string; match_method: string; decision: string }) =>
      [r.input_case_no, r.match_parcel_id, r.match_method, r.decision])).toEqual([["25-2751", "500-1", "case_no", "accepted"]]);
    // The original row points at the follow-up; the other case keeps waiting.
    const orig = (await batchDetail(b))!.rows;
    expect(orig.find((r: { input_case_no: string }) => r.input_case_no === "25-2751").apply_result).toBe(`moved:${fu.id}`);
    expect(orig.find((r: { input_case_no: string }) => r.input_case_no === "26-1984").apply_result).toBeNull();

    await applyBatch(admin, fu.id);
    expect(await events("500-1")).toEqual([
      { s: "city_action/cited", d: "2025-03-01" },
      { s: "city_action/adjudicated", d: "2026-11-17" },
    ]);
    // Nothing new to move on a second pass.
    const c = await getPool().connect();
    try {
      const { resolveWaitingCases } = await import("@/lib/imports");
      expect(await resolveWaitingCases(c, admin)).toEqual([]);
    } finally {
      c.release();
    }
  });

  it("matches case-only rows straight away once the case is known, and lets an admin pick a parcel for a waiting row", async () => {
    const b = await createAgendaBatch(admin, {
      title: "Council 12/1",
      meetingDate: "2026-12-01",
      entries: [
        { item: "7", substatus: "demolition_ordered", caseNo: "25-2751" }, // linked by the case log above
        { item: "7", substatus: "demolition_ordered", caseNo: "26-9999" },
      ],
    });
    const rows = (await batchDetail(b))!.rows as { id: number; input_case_no: string; match_parcel_id: string | null; decision: string }[];
    expect(rows.find((r) => r.input_case_no === "25-2751")).toMatchObject({ match_parcel_id: "500-1", decision: "accepted" });
    const waiting = rows.find((r) => r.input_case_no === "26-9999")!;
    expect(waiting.decision).toBe("waiting_case");
    await updateRow(admin, waiting.id, { parcelId: "500-2", decision: "accepted" });
    const res = await applyBatch(admin, b);
    expect(res).toMatchObject({ events: 2, waiting: 0, learnedCases: 1 });
    expect((await pool.query("SELECT parcel_id FROM app.code_cases WHERE case_no = '26-9999'")).rows).toEqual([{ parcel_id: "500-2" }]);
  });

  it("rejects malformed case numbers and empty entry lists", async () => {
    await expect(createAgendaBatch(admin, { title: "x", meetingDate: "2026-12-01", entries: [] })).rejects.toThrow(/at least one/);
    await expect(
      createAgendaBatch(admin, { title: "x", meetingDate: "2026-12-01", entries: [{ substatus: "adjudicated", caseNo: "nope" }] }),
    ).rejects.toThrow(/case number/);
  });
});

// ---------------------------------------------------------------------------------------
// Council minutes
// ---------------------------------------------------------------------------------------


describe("reading council minutes", () => {
  const L = (text: string, x = 100): PdfLine => ({ page: 1, x, text });
  const HEADER = [L("REGULAR MEETING OF THE CITY COUNCIL", 170), L("TUESDAY, JANUARY 14, 202S 10:00 A.M. 519", 190)];
  const VOTE = [L("Council Member Stokes moved adoption; Vice President Hartley seconded."), L("Yeas-Brown-Thomas, Clay, Foote, Grizzell, Hartley, Parkinson and Stokes."), L("Nays-None."), L("Absent-None.")];
  const SEP = L("* * * * * * * * * * * * * *", 240);

  it("reads the meeting date through scanner misreads", () => {
    expect(parseMeetingDate("TUESDAY, JANUARY 14, 202S 10:00 A.M. 519")).toBe("2025-01-14");
    expect(parseMeetingDate("TUESDAY, DECEMBER 2, 202510:00 A.M. 387")).toBe("2025-12-02");
  });

  it("tells adopted, failed and tabled orders apart", () => {
    expect(readVote("Council Member Stokes moved adoption; Vice President Hartley seconded. Yeas-Brown-Thomas, Clay and Stokes. Nays-None. Absent-None."))
      .toEqual({ adopted: true, vote: "3–0" });
    expect(readVote("Council Member Foote moved adoption. Yeas-Foote. Nays-Banks, Clay, Grizzell, Hartley and Lindsay."))
      .toEqual({ adopted: false, vote: "1–5" });
    expect(readVote("Council Member Foote moved adoption. The motion failed for a lack of second.").adopted).toBe(false);
    expect(readVote("Said item was tabled until the August 18, 2025, Regular Zoning Council Meeting.").adopted).toBe(false);
    expect(readVote("~aid item was pulled by the Administration.")).toEqual({ adopted: false, vote: "Said item was pulled by the Administration." });
    expect(readVote("Council Member Stokes moved adoption; Vice President Hartley seconded.")).toEqual({ adopted: null, vote: "moved; the vote isn't printed" });
  });

  it("classifies orders by title, ignoring housing-program lien releases", () => {
    expect(minutesAction("RESOLUTION DECLARING CERTAIN PARCELS OF REAL PROPERTY IN THE CITY OF JACKSON TO BE A MENACE")).toBe("adjudicated");
    expect(minutesAction("ORDER AUTHORIZING THE MAYOR TO EXECUTE A CONTRACT ... TO DEMOLISH A STRUCTURE ... 21-19-11 FOR CASE #CE-22-2421 LOCATED AT 121 TEXAS AVE")).toBe("demolition_ordered");
    expect(minutesAction("ORDER ... CONTRACT ... TO BOARD UP AND SECURE STRUCTURE ... ON PRIVATE PROPERTY WHICH CONSTITUTE A MENACE")).toBe("lot_cleanup_ordered");
    expect(minutesAction("RESOLUTION ... ADJUDICATING THE ACTUAL COSTS OF CLEANING PROPERTY AND IMPOSING A PENALTY AND LIEN")).toBe("lien_filed");
    expect(minutesAction("ORDER AUTHORIZING THE MAYOR TO EXECUTE A RELEASE OF LIEN AND RESTRICTION ON TRANSFER AGAINST THE PROPERTY LOCATED AT 12 STILLWOOD DRIVE")).toBeNull();
  });

  it("reads hearing findings case by case and sets aside ones not adjudicated", () => {
    const t = findingsTargets(
      "1) Case #24-473: Parcel #9-210-1 located at 1746 Myrtle St.: No appearance by owner. Hearing officer recommends that the property be adjudicated as a menace to public health. " +
      "2) Case #23-2521: Parcel 606-141 located at 2816 Kingswood Ave.: Hearing officer recommends that the property be adjudicated as a menace. " +
      "3) Case #24-1905: Parcel #135-4 located at 1103 West Capitol St.: Owner completed the work; hearing officer recommends that the case be dismissed. " +
      "4) Case #25-60: Parcel #409-3-5 located at 3875 California Ave.: Hearing officer recommends that the property be adjudicate4d as a menace. " +
      "5) Case #24-1596: Parcel #433-116 located at 4645 Normandy Dr.: Hearing officer recommends that the property be held in abeyance for thirty (30) days.",
    );
    expect(t).toEqual([
      { caseNo: "24-473", parcelId: "9-210-1", address: "1746 MYRTLE ST", excluded: null },
      { caseNo: "23-2521", parcelId: "606-141", address: "2816 KINGSWOOD AVE", excluded: null },
      { caseNo: "24-1905", parcelId: "135-4", address: "1103 WEST CAPITOL ST", excluded: "Hearing officer dismissed it" },
      { caseNo: "25-60", parcelId: "409-3-5", address: "3875 CALIFORNIA AVE", excluded: null },
      { caseNo: "24-1596", parcelId: "433-116", address: "4645 NORMANDY DR", excluded: "Held in abeyance" },
    ]);
  });

  it("splits orders, skips earlier actions cited in WHEREAS text, and folds a repeated scan into one order", () => {
    const contract = [
      L("ORDER AUTHORIZING THE MAYOR TO EXECUTE A CONTRACT BETWEEN THE CITY OF JACKSON AND"),
      L("FAIRCLOTH DEMOLITION, INC. TO DEMOLISH A STRUCTURE ... ACCORDING TO MISSISSIPPI CODE"),
      L("ANNOTATED SECTION 21-19-11 FOR CASE #CE-22-2421 LOCATED AT 121 TEXAS AVE-- PARCEL #116-53- $55,000.00."),
      L("WHEREAS, on December 17, 2024, the Jackson City Council approved a resolution declaring certain parcels"),
      L("of real property to be a menace pursuant to Section 21-19-11 for the following cases: 24-1 24-2; and"),
      ...VOTE,
    ];
    const lines = [
      ...HEADER, SEP, ...contract, SEP,
      L("ORDER AUTHORIZING THE PURCHASE OF FIRE TRUCKS"), ...VOTE, SEP,
      ...HEADER, ...contract, SEP, // the same pages again, scanned twice
    ];
    expect(looksLikeMinutes(lines)).toBe(true);
    const r = splitMinutes(lines);
    expect(r.kind).toBe("minutes");
    expect(r.meetingDate).toBe("2025-01-14");
    const rel = r.items.filter((i) => i.relevant);
    expect(rel).toHaveLength(1);
    expect(rel[0]).toMatchObject({ substatus: "demolition_ordered", adopted: true, vote: "7–0" });
    expect(rel[0].targets).toEqual([{ caseNo: "22-2421", parcelId: "116-53", address: "121 TEXAS AVE" }]);
  });
});
