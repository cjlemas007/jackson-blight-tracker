import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshTestDb } from "./helpers/testdb";
import { getPool } from "@/lib/db";
import { createStaff, type Staff } from "@/lib/auth/staff";
import {
  addressCore, applyBatch, batchDetail, compactParcelId, createAgendaBatch, createCsvBatch, mapBatch,
  normalizeParcelInput, parseLooseDate, updateRow,
} from "@/lib/imports";
import { addEvent, adminParcel, voidEvent } from "@/lib/parcelAdmin";
import { openSuggestions, resolveSuggestion } from "@/lib/suggestions";
import { cityResponse, waitingOnCity } from "@/lib/cityResponse";
import { headline } from "@/lib/rankings";

let pool: pg.Pool;
let admin: Staff;
let contributor: Staff;
let today: string;
const daysAgo = (n: number) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
let seq = 0;

async function parcel(id: string, num: number | null, street: string, opts: { dpin?: string; tvImp?: number } = {}) {
  const lon = -90.205 + seq++ * 0.0002;
  const situs = num ? `${num} ${street}` : street;
  await pool.query(
    `INSERT INTO data.landroll_parcels (county, parcel_id, owner_name, owner_type, row_hash, situs_address, situs_number, situs_street)
     VALUES ('Hinds', $1, 'OWNER ' || $1, 'private', 'x', $2, $3, $4)`,
    [id, situs, num, street],
  );
  await pool.query(
    `INSERT INTO data.gis_parcels (county, parcel_id, dpin, geom, geom_3857, pt, owner_name_gis, loc_num, loc_street, tv_imp, row_hash)
     SELECT 'Hinds', $1, $2, g, ST_Transform(g, 3857), ST_PointOnSurface(g), 'OWNER ' || $1, $3, $4, $5, 'x'
     FROM (SELECT ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint($6::float8, 32.3), 4326), 0.00003)) g) s`,
    [id, opts.dpin ?? null, num, street, opts.tvImp ?? 50000, lon],
  );
}
const ev = (id: string, status: string, sub: string | null, date: string) =>
  pool.query(
    `INSERT INTO app.status_events (county, parcel_id, status, substatus, effective_date, source, recorded_by)
     VALUES ('Hinds', $1, $2, $3, $4, 'admin_entry', 'test')`,
    [id, status, sub, date],
  );
const events = async (id: string) =>
  (await pool.query("SELECT status::text || COALESCE('/' || substatus, '') s, source::text FROM app.status_events_live WHERE parcel_id = $1 ORDER BY id", [id])).rows;

/** Put a CSV "document" in an in-memory store and return its id. */
const files = new Map<string, Buffer>();
async function csvDoc(text: string) {
  const { rows } = await pool.query(
    `INSERT INTO app.documents (kind, storage_key, original_name, mime_type, uploaded_by, uploaded_at)
     VALUES ('csv', 'docs/private/' || gen_random_uuid() || '.csv', 'list.csv', 'text/csv', $1, now()) RETURNING id, storage_key`,
    [admin.id],
  );
  files.set(rows[0].storage_key, Buffer.from(text));
  return rows[0].id as string;
}
const read = async (k: string) => files.get(k) ?? null;

beforeAll(async () => {
  pool = await freshTestDb();
  today = (await pool.query("SELECT (now() AT TIME ZONE 'America/Chicago')::date::text d")).rows[0].d;
  await pool.query(`INSERT INTO data.boundaries (kind, code, name, source, source_url, geom) VALUES
    ('city_limits', 'JACKSON', 'Test city', 't', 't', ST_Multi(ST_MakeEnvelope(-90.21, 32.29, -90.19, 32.31, 4326)))`);
  await parcel("4854-104", 435, "UTICA ST", { dpin: "048540000104000000" });
  await parcel("4854-104-6", 437, "UTICA ST");
  await parcel("142-23", 522, "BURNS ST");
  await parcel("142-24", 524, "BURNS ST");
  await parcel("200-1", 10, "OAK ST"); // two parcels share "10 OAK ST" (e.g. a split)
  await parcel("200-2", 10, "OAK ST");
  await parcel("300-1", 7, "MARTIN LUTHER KING JR DR");
  await parcel("400-1", 99, "PINE ST", { tvImp: 40000 });
  await parcel("400-2", 101, "PINE ST", { tvImp: 40000 });
  await pool.query("SELECT app.rebuild_parcel_facts()");
  admin = (await createStaff({ email: "a@t.t", name: "Ada", role: "admin" }, null)).staff;
  contributor = (await createStaff({ email: "c@t.t", name: "Cy", role: "contributor" }, null)).staff;
});
afterAll(async () => {
  await pool.end();
  await getPool().end();
});

describe("parsing helpers", () => {
  it.each([
    ["6/2/2017", "2017-06-02"], ["06/02/17", "2017-06-02"], ["2017-06-02", "2017-06-02"], ["2017/6/2", "2017-06-02"],
    ["9/31/2026", null], ["", null], ["soon", null],
  ])("parseLooseDate(%s) = %s", (i, o) => expect(parseLooseDate(i)).toBe(o));
  it("normalizes parcel ids and addresses", () => {
    // Spaces are dropped, not turned into dashes; the dash-free comparison still matches it.
    expect(normalizeParcelInput(" 4854 104-6 ")).toBe("4854104-6");
    expect(compactParcelId(normalizeParcelInput(" 4854 104-6 ")!)).toBe(compactParcelId("4854-104-6"));
    expect(compactParcelId("4854-104-6")).toBe("48541046");
    expect(addressCore("522 Burns St., Jackson, MS 39203")).toBe("522 BURNS ST");
    expect(addressCore("7 M L King Jr Dr #2")).toBe("7 M L KING JR DR 2");
  });
});

describe("matching rows to parcels", () => {
  it("accepts exact parcel id, id without dashes, DPIN and exact address; holds the rest for review", async () => {
    const id = await csvDoc(
      [
        "Parcel,Address,Date",
        "4854-104-6,,1/5/2026", // exact id
        "48541046,,1/5/2026", // same id, dashes dropped
        "048540000104000000,,1/5/2026", // DPIN
        ",522 Burns Street,1/5/2026", // exact address
        ",10 Oak St,1/5/2026", // two parcels share this address
        ",522 Burn St,1/5/2026", // typo
        ",1 Nowhere Rd,1/5/2026", // nothing
      ].join("\n"),
    );
    const b = await createCsvBatch(admin, { kind: "code_enforcement", title: "Code cases Jan", documentId: id }, read);
    const counts = await mapBatch(admin, b, { mapping: { parcelId: "Parcel", address: "Address", date: "Date" } });
    expect(counts).toEqual({ accepted: 4, review: 2, unmatched: 1 });
    const d = await batchDetail(b);
    const by = Object.fromEntries(d!.rows.map((r: { row_num: number }) => [r.row_num, r]));
    expect([by[1].match_parcel_id, by[1].match_method, by[1].decision]).toEqual(["4854-104-6", "parcel_id", "accepted"]);
    expect([by[2].match_parcel_id, by[2].decision]).toEqual(["4854-104-6", "accepted"]);
    expect([by[3].match_parcel_id, by[3].match_method]).toEqual(["4854-104", "dpin"]);
    expect([by[4].match_parcel_id, by[4].match_method]).toEqual(["142-23", "address_exact"]);
    expect([by[5].decision, by[5].candidates.map((c: { parcel_id: string }) => c.parcel_id).sort()]).toEqual(["pending", ["200-1", "200-2"]]);
    expect([by[6].match_parcel_id, by[6].match_method, by[6].decision]).toEqual(["142-23", "address_fuzzy", "pending"]);
    expect([by[7].match_parcel_id, by[7].decision]).toEqual([null, "pending"]);
  });
});

describe("applying a city record import", () => {
  it("won't apply with undecided rows, then writes events once (re-imports become duplicates)", async () => {
    const text = "Case,Parcel ID,Street address,Demo date\n1,,522 Burns St,3/1/2026\n2,4854-104,,3/2/2026\n3,,1 Nowhere Rd,3/3/2026";
    const b = await createCsvBatch(admin, { kind: "demolition_list", title: "Demolitions FY26", documentId: await csvDoc(text) }, read);
    await mapBatch(admin, b, { mapping: { parcelId: "Parcel ID", address: "Street address", date: "Demo date" } });
    await expect(applyBatch(admin, b)).rejects.toThrow(/still need a decision/);
    const row3 = (await batchDetail(b))!.rows.find((r: { row_num: number }) => r.row_num === 3);
    await expect(updateRow(admin, row3.id, { decision: "accepted" })).rejects.toThrow(/Pick a parcel/);
    await updateRow(admin, row3.id, { decision: "skipped" });
    await expect(applyBatch(contributor, b)).rejects.toThrow(/Admins only/);
    expect(await applyBatch(admin, b)).toEqual({ events: 2, duplicates: 0, listed: 0, skipped: 1 });
    expect(await events("142-23")).toEqual([{ s: "resolved/demolished", source: "city_record" }]);
    // The same list, obtained again in a later records request:
    const again = await createCsvBatch(admin, { kind: "demolition_list", title: "Demolitions FY26 (again)", documentId: await csvDoc(text) }, read);
    await mapBatch(admin, again, { mapping: { parcelId: "Parcel ID", address: "Street address", date: "Demo date" } });
    const r3 = (await batchDetail(again))!.rows.find((r: { row_num: number }) => r.row_num === 3);
    await updateRow(admin, r3.id, { decision: "skipped" });
    expect(await applyBatch(admin, again)).toMatchObject({ events: 0, duplicates: 2 });
    expect(await events("142-23")).toHaveLength(1);
  });

  it("lets an admin pick the parcel for an ambiguous row and change its action", async () => {
    const b = await createCsvBatch(admin, { kind: "code_enforcement", title: "Cases", documentId: await csvDoc("Address\n10 Oak St") }, read);
    await mapBatch(admin, b, { mapping: { address: "Address" }, defaultDate: daysAgo(5), substatus: "hearing_set" });
    const row = (await batchDetail(b))!.rows[0];
    await updateRow(admin, row.id, { parcelId: "200-2", decision: "accepted", substatus: "lien_filed" });
    await applyBatch(admin, b);
    expect(await events("200-2")).toEqual([{ s: "city_action/lien_filed", source: "city_record" }]);
    expect(await events("200-1")).toEqual([]);
  });
});

describe("council agenda quick entry", () => {
  it("matches pasted addresses and records them as council actions on the meeting date", async () => {
    const b = await createAgendaBatch(admin, {
      title: "Council 11/4",
      meetingDate: daysAgo(9),
      substatus: "adjudicated",
      lines: "7 Martin Luther King Jr Dr\n\n4854-104-6\n",
    });
    expect((await batchDetail(b))!.stats).toEqual({ accepted: 2, review: 0, unmatched: 0 });
    await applyBatch(admin, b);
    expect(await events("300-1")).toEqual([{ s: "city_action/adjudicated", source: "council_agenda" }]);
    const { rows } = await pool.query("SELECT effective_date::text d FROM app.status_events WHERE parcel_id = '300-1'");
    expect(rows[0].d).toBe(daysAgo(9));
  });
});

describe("Secretary of State tax-forfeited list", () => {
  it("records listings instead of status events", async () => {
    const b = await createCsvBatch(admin, { kind: "sos_forfeited", title: "SOS list Nov", documentId: await csvDoc("PPIN,Address\n142-24,\n,99 Pine St") }, read);
    await mapBatch(admin, b, { mapping: { parcelId: "PPIN", address: "Address" }, defaultDate: today });
    expect(await applyBatch(admin, b)).toMatchObject({ listed: 2, events: 0 });
    const { rows } = await pool.query("SELECT parcel_id FROM app.state_inventory_latest ORDER BY 1");
    expect(rows.map((r) => r.parcel_id)).toEqual(["142-24", "400-1"]);
    expect(await events("142-24")).toEqual([]);
  });
});

describe("blight counts need newsroom verification", () => {
  it("doesn't count a parcel the City cited but the newsroom never verified", async () => {
    // 200-2 has only a city lien (from the import above), 4854-104-6 only council action.
    const h = await headline();
    expect(h.blighted).toBe(0);
    expect((await cityResponse()).city_only).toBe(3); // 200-2, 4854-104-6, 300-1
    await ev("4854-104-6", "verified_blighted", null, daysAgo(30));
    // Verified before the council acted (9 days ago): now it counts.
    expect((await headline()).blighted).toBe(1);
  });
});

describe("manual entry and voids", () => {
  it("validates entries and keeps voided ones out of every figure", async () => {
    await expect(addEvent(contributor, { parcelId: "400-2", status: "verified_blighted", date: today, source: "admin_entry" })).rejects.toThrow(/Admins/);
    await expect(addEvent(admin, { parcelId: "400-2", status: "resolved", substatus: "cited", date: today, source: "admin_entry" })).rejects.toThrow(/what happened/);
    await expect(addEvent(admin, { parcelId: "400-2", status: "verified_blighted", date: "2099-01-01", source: "admin_entry" })).rejects.toThrow(/future/);
    const id = await addEvent(admin, { parcelId: "400-2", status: "verified_blighted", date: daysAgo(120), source: "admin_entry", note: "site visit" });
    expect((await waitingOnCity(90)).map((r) => r.parcel_id)).toContain("400-2");
    await expect(voidEvent(admin, id, " ")).rejects.toThrow(/why/);
    await voidEvent(admin, id, "Wrong parcel");
    expect((await waitingOnCity(90)).map((r) => r.parcel_id)).not.toContain("400-2");
    // Admins still see the voided entry, who voided it, and why.
    const p = await adminParcel("400-2");
    const voided = p!.history.find((h: { id: number }) => h.id === id);
    expect([voided.void_reason, voided.voided_by_name, voided.recorded_by_name, voided.note]).toEqual(["Wrong parcel", "Ada", "Ada", "site visit"]);
  });
});

describe("land roll suggestions", () => {
  it("suggests a status check when a verified parcel's improvements drop to zero, never on its own", async () => {
    await ev("400-1", "verified_blighted", null, daysAgo(200));
    await ev("400-2", "verified_blighted", null, daysAgo(200)); // will be voided-free baseline
    const run = (await pool.query("SELECT gen_random_uuid() id")).rows[0].id;
    await pool.query(
      `INSERT INTO data.parcel_field_changes (county, parcel_id, source, field, old_value, new_value, run_id) VALUES
        ('Hinds', '400-1', 'gis', 'tv_imp', '40000', '0', $1),
        ('Hinds', '400-2', 'landroll', 'owner_name', 'OWNER 400-2', 'NEW OWNER LLC', $1),
        ('Hinds', '142-24', 'gis', 'tv_imp', '40000', '0', $1)`, // unreported parcel: no suggestion
      [run],
    );
    await pool.query("SELECT app.rebuild_parcel_facts()");
    const open = await openSuggestions();
    expect(open.map((s) => [s.parcel_id, s.kind]).sort()).toEqual([["400-1", "improvement_zeroed"], ["400-2", "ownership_transfer"]]);
    expect(await events("400-1")).toEqual([{ s: "verified_blighted", source: "admin_entry" }]); // nothing applied
    const zero = open.find((s) => s.parcel_id === "400-1")!;
    await resolveSuggestion(admin, zero.id, { action: "record", status: "resolved", substatus: "demolished", date: daysAgo(2) });
    expect(await events("400-1")).toEqual([
      { s: "verified_blighted", source: "admin_entry" },
      { s: "resolved/demolished", source: "land_roll" },
    ]);
    await resolveSuggestion(admin, open.find((s) => s.parcel_id === "400-2")!.id, { action: "dismiss" });
    expect(await openSuggestions()).toEqual([]);
    await pool.query("SELECT app.rebuild_parcel_facts()"); // re-running doesn't resurrect them
    expect(await openSuggestions()).toEqual([]);
  });
});

describe("City response figures", () => {
  it("computes demolitions by period, medians, stages and the waiting list", async () => {
    // City demolition list: 142-23 on 3/1/2026 and 4854-104 on 3/2/2026 (never verified).
    // 400-1: verified 200 days ago, demolished 2 days ago.
    // 4854-104-6: verified 30 days ago, adjudicated 9 days ago (21 days to action).
    const r = await cityResponse();
    const thisYear = today.slice(0, 4) === "2026" ? 3 : 1; // the March 2026 demolitions count only during 2026
    expect(r.demolished.year).toBe(thisYear);
    expect(r.median_days_to_action).toBe(21);
    expect(r.median_days_to_resolution).toBe(198);
    expect(r.stages.find((s) => s.substatus === "adjudicated")!.parcels).toBe(2); // 4854-104-6, 300-1
    expect(r.stages.find((s) => s.substatus === "lien_filed")!.parcels).toBe(1); // 200-2
    // 400-2 verified 200 days ago with no City action (its ownership changed, but that's not an action).
    const waiting = await waitingOnCity(90);
    expect(waiting.map((w) => [w.parcel_id, w.days_waiting])).toEqual([["400-2", 200]]);
  });
});
