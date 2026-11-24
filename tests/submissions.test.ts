import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Workflow tests don't need the ML models (tests/detect.test.ts covers them).
process.env.DISABLE_DETECTORS = "1";
import type pg from "pg";
import { freshTestDb } from "./helpers/testdb";
import { jpegWithExif } from "./helpers/images";
import { getPool } from "@/lib/db";
import { setStorage, type Storage } from "@/lib/storage";
import { createStaff, type Staff } from "@/lib/auth/staff";
import { processSubmission, setManualBoxes } from "@/lib/photos/process";
import {
  addPhotoSlot, createDraft, publicPhotos, removePhoto, review, submissionDetail, submit, type SubmitInput,
} from "@/lib/submissions";
import { APPROVAL_STANDARD } from "@/lib/approval";
import { headline } from "@/lib/rankings";
import { needsNewsroomCheck } from "@/lib/cityResponse";

/** In-memory storage standing in for disk / Supabase. */
const files = new Map<string, Buffer>();
const memory: Storage = {
  async put(k, b) { files.set(k, b); },
  async get(k) { return files.get(k) ?? null; },
  async exists(k) { return files.has(k); },
  async uploadTarget(k) { return { url: `mem://${k}`, method: "PUT", headers: {} }; },
};

let pool: pg.Pool;
let contributor: Staff;
let other: Staff;
let admin: Staff;

// Parcel A..E inside the test city; Z outside it. Each is a ~10m square; A's center is the reference point.
const PARCELS: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, Z: 50 };
const lonOf = (i: number) => -90.2 + i * 0.001;

const OK: SubmitInput = { conditions: ["vacant_open"], vantageConfirmed: true };
const ALL_CHECKED = Object.fromEntries(APPROVAL_STANDARD.map((i) => [i.id, true]));
const uploaded = async (k: string) => files.has(k);

async function status(parcel: string) {
  const { rows } = await pool.query(
    "SELECT COALESCE((SELECT status::text FROM app.parcel_status_current WHERE parcel_id = $1), 'unreported') s",
    [parcel],
  );
  return rows[0].s as string;
}
async function events(parcel: string) {
  const { rows } = await pool.query(
    "SELECT status::text, source::text FROM app.status_events WHERE parcel_id = $1 ORDER BY id",
    [parcel],
  );
  return rows.map((r) => `${r.status}/${r.source}`);
}

/** Draft + one uploaded photo (taken `metersAway` east of the parcel) + submit + process. */
async function fullSubmission(who: Staff, parcel: string, metersAway = 5): Promise<string> {
  const id = await createDraft(who, "Hinds", parcel);
  const { key } = await addPhotoSlot(who, id, { name: "p.jpg", mime: "image/jpeg", bytes: 1000 });
  const lon = lonOf(PARCELS[parcel]) + 0.00005 + metersAway / (111320 * Math.cos((32.30005 * Math.PI) / 180));
  files.set(key, await jpegWithExif({ lat: 32.30005, lon, takenAt: "2026:11:10 14:32:05" }));
  await submit(who, id, OK, uploaded);
  await processSubmission(id);
  return id;
}

beforeAll(async () => {
  pool = await freshTestDb();
  setStorage(memory);
  await pool.query(
    `INSERT INTO data.boundaries (kind, code, name, source, source_url, geom)
     VALUES ('city_limits', 'JACKSON', 'Test city', 'test', 'test',
             ST_Multi(ST_MakeEnvelope(-90.21, 32.29, -90.19, 32.31, 4326)))`,
  );
  for (const [id, i] of Object.entries(PARCELS)) {
    await pool.query(
      `INSERT INTO data.landroll_parcels (county, parcel_id, owner_name, owner_type, row_hash, situs_address)
       VALUES ('Hinds', $1, 'OWNER ' || $1, 'private', 'x', $1 || ' TEST ST')`,
      [id],
    );
    await pool.query(
      `INSERT INTO data.gis_parcels (county, parcel_id, geom, geom_3857, pt, owner_name_gis, row_hash)
       SELECT 'Hinds', $1, g, ST_Transform(g, 3857), ST_Centroid(g), 'OWNER ' || $1, 'x'
       FROM (SELECT ST_Multi(ST_MakeEnvelope($2::float8, 32.3, $2::float8 + 0.0001, 32.3001, 4326)) g) s`,
      [id, lonOf(i)],
    );
  }
  await pool.query("SELECT app.rebuild_parcel_facts()");
  contributor = (await createStaff({ email: "c@t.test", name: "Casey Contributor", role: "contributor" }, null)).staff;
  other = (await createStaff({ email: "o@t.test", name: "Other", role: "contributor" }, null)).staff;
  admin = (await createStaff({ email: "a@t.test", name: "Ada Admin", role: "admin" }, null)).staff;
});
beforeEach(() => {
  /* parcels are separate per test; nothing to reset */
});
afterAll(async () => {
  setStorage(null);
  await pool.end();
  await getPool().end();
});

describe("submitting", () => {
  it("runs draft → processing → pending, marking the parcel submitted (not public)", async () => {
    const id = await createDraft(contributor, "Hinds", "A");
    const { key } = await addPhotoSlot(contributor, id, { name: "p.jpg", mime: "image/jpeg", bytes: 1000 });
    await expect(submit(contributor, id, OK, uploaded)).rejects.toThrow(/still uploading/);
    files.set(key, await jpegWithExif({ lat: 32.30005, lon: lonOf(0) + 0.00005, takenAt: "2026:11:10 14:32:05" }));
    await submit(contributor, id, OK, uploaded);
    expect(await status("A")).toBe("submitted");
    expect(await events("A")).toEqual(["submitted/user_photo"]);
    await processSubmission(id);
    const d = await submissionDetail(id);
    expect(d.status).toBe("pending");
    expect(d.kind).toBe("initial");
    expect(d.photos[0].processing_status).toBe("done");
    expect(d.photos[0].exif_distance_m).toBeLessThan(15);
    expect(d.photos[0].detector).toBe("unavailable");
    expect(d.photos[0].exif_taken_at.toISOString()).toBe("2026-11-10T20:32:05.000Z");
    expect(await publicPhotos("Hinds", "A")).toEqual([]); // nothing public before approval
  });

  it("validates the form", async () => {
    const id = await createDraft(contributor, "Hinds", "B");
    await expect(submit(contributor, id, OK, uploaded)).rejects.toThrow(/at least one photo/);
    await addPhotoSlot(contributor, id, { name: "p.jpg", mime: "image/jpeg", bytes: 1 });
    await expect(submit(contributor, id, { ...OK, conditions: [] }, uploaded)).rejects.toThrow(/condition/);
    await expect(submit(contributor, id, { ...OK, conditions: ["haunted"] }, uploaded)).rejects.toThrow(/Unknown/);
    await expect(submit(contributor, id, { ...OK, vantageConfirmed: false }, uploaded)).rejects.toThrow(/where the photos/);
    await expect(submit(contributor, id, { ...OK, note: "x".repeat(301) }, uploaded)).rejects.toThrow(/300/);
    await expect(addPhotoSlot(contributor, id, { name: "p.heic", mime: "image/heic", bytes: 1 })).rejects.toThrow(/JPEG/);
    await expect(addPhotoSlot(contributor, id, { name: "big.jpg", mime: "image/jpeg", bytes: 30e6 })).rejects.toThrow(/25 MB/);
    for (let i = 0; i < 4; i++) await addPhotoSlot(contributor, id, { name: "p.jpg", mime: "image/jpeg", bytes: 1 });
    await expect(addPhotoSlot(contributor, id, { name: "p.jpg", mime: "image/jpeg", bytes: 1 })).rejects.toThrow(/Up to 5/);
  });

  it("keeps people out of each other's drafts and outside-city parcels", async () => {
    const id = await createDraft(contributor, "Hinds", "B");
    const slot = await addPhotoSlot(contributor, id, { name: "p.jpg", mime: "image/jpeg", bytes: 1 });
    await expect(addPhotoSlot(other, id, { name: "p.jpg", mime: "image/jpeg", bytes: 1 })).rejects.toThrow(/Not your/);
    await expect(removePhoto(other, slot.photoId)).rejects.toThrow(/Not your/);
    await expect(createDraft(contributor, "Hinds", "Z")).rejects.toThrow(/outside Jackson/);
    await expect(createDraft(contributor, "Hinds", "NOPE")).rejects.toThrow(/isn't in our records/);
  });
});

describe("reviewing", () => {
  it("only admins review, and approval needs the whole standard", async () => {
    const id = (await pool.query("SELECT id FROM app.submissions WHERE parcel_id = 'A'")).rows[0].id;
    await expect(review(contributor, id, { action: "approve", checklist: ALL_CHECKED })).rejects.toThrow(/Admins only/);
    const partial = { ...ALL_CHECKED, privacy: false };
    await expect(review(admin, id, { action: "approve", checklist: partial })).rejects.toThrow(/Every item/);
    await review(admin, id, { action: "approve", checklist: ALL_CHECKED });
    expect(await status("A")).toBe("verified_blighted");
    expect(await events("A")).toEqual(["submitted/user_photo", "verified_blighted/user_photo"]);
    const { rows } = await pool.query(
      "SELECT effective_date::text d, recorded_by FROM app.status_events WHERE parcel_id = 'A' AND status = 'verified_blighted'",
    );
    const today = (await pool.query("SELECT (now() AT TIME ZONE 'America/Chicago')::date::text d")).rows[0].d;
    expect(rows[0]).toEqual({ d: today, recorded_by: admin.id });
    expect(await publicPhotos("Hinds", "A")).toHaveLength(1);
    await expect(review(admin, id, { action: "reject", reason: "x" })).rejects.toThrow(/approved, not waiting/);
  });

  it("follow-up photos on a verified parcel add to the timeline without changing status", async () => {
    const id = await fullSubmission(other, "A");
    expect((await submissionDetail(id)).kind).toBe("follow_up");
    await review(admin, id, { action: "approve", checklist: ALL_CHECKED });
    expect(await events("A")).toEqual(["submitted/user_photo", "verified_blighted/user_photo"]);
    expect(await publicPhotos("Hinds", "A")).toHaveLength(2);
  });

  it("rejecting returns the parcel to unreported, unless another submission is still open", async () => {
    const first = await fullSubmission(contributor, "C");
    const second = await fullSubmission(other, "C");
    await review(admin, first, { action: "reject", reason: "Wrong house" });
    expect(await status("C")).toBe("submitted"); // `second` is still open
    await expect(review(admin, second, { action: "reject", reason: " " })).rejects.toThrow(/reason/);
    await review(admin, second, { action: "reject", reason: "Not blighted" });
    expect(await status("C")).toBe("unreported");
    expect(await events("C")).toEqual(["submitted/user_photo", "unreported/admin_entry"]);
  });

  it("request a better photo → contributor adds one → back in the queue", async () => {
    const id = await fullSubmission(contributor, "D");
    await review(admin, id, { action: "request_photo", reason: "Get the whole front of the house" });
    expect((await submissionDetail(id)).status).toBe("needs_photo");
    await expect(submit(contributor, id, OK, uploaded)).rejects.toThrow(/new photo/);
    const { key } = await addPhotoSlot(contributor, id, { name: "q.jpg", mime: "image/jpeg", bytes: 1 });
    files.set(key, await jpegWithExif({ lat: 32.30005, lon: lonOf(3) }));
    await submit(contributor, id, OK, uploaded);
    await processSubmission(id);
    const d = await submissionDetail(id);
    expect(d.status).toBe("pending");
    expect(d.photos).toHaveLength(2);
    expect(await events("D")).toEqual(["submitted/user_photo"]); // one 'submitted', not two
  });

  it("reassigning moves the submission and its 'submitted' marker to the right parcel", async () => {
    const id = await fullSubmission(contributor, "E", 120); // photo taken 120m away: wrong parcel
    const before = await submissionDetail(id);
    expect(before.photos[0].exif_distance_m).toBeGreaterThan(100);
    await expect(review(admin, id, { action: "reassign", parcelId: "Z" })).rejects.toThrow(/outside/);
    await review(admin, id, { action: "reassign", parcelId: "B" });
    expect(await status("E")).toBe("unreported");
    expect(await status("B")).toBe("submitted");
    expect((await submissionDetail(id)).parcel_id).toBe("B");
  });

  it("manual blur boxes re-render the public copy", async () => {
    const id = (await pool.query("SELECT id FROM app.submissions WHERE parcel_id = 'A' ORDER BY created_at LIMIT 1")).rows[0].id;
    const photo = (await submissionDetail(id)).photos[0];
    const key = `processed/${id}/${photo.id}.jpg`;
    const before = files.get(key)!;
    await setManualBoxes(photo.id, [{ x: 0.1, y: 0.1, w: 0.3, h: 0.3, kind: "manual" }]);
    expect(files.get(key)!.equals(before)).toBe(false);
    expect((await submissionDetail(id)).photos[0].manual_boxes).toHaveLength(1);
  });

  it("logs every review action with who did it", async () => {
    const { rows } = await pool.query(
      "SELECT action, count(*)::int n FROM app.audit_log WHERE entity = 'submission' AND actor_id IS NOT NULL GROUP BY 1",
    );
    const counts = Object.fromEntries(rows.map((r) => [r.action, r.n]));
    expect(counts).toMatchObject({
      "submission.approve": 2,
      "submission.reject": 2,
      "submission.request_photo": 1,
      "submission.reassign": 1,
      "submission.resubmit": 1,
    });
  });
});

describe("City-flagged parcels", () => {
  const cite = (parcel: string, sub: string, date: string) =>
    pool.query(
      `INSERT INTO app.status_events (county, parcel_id, status, substatus, effective_date, source, recorded_by)
       VALUES ('Hinds', $1, 'city_action', $2, $3, 'city_record', 'test')`,
      [parcel, sub, date],
    );

  it("lists them for staff, strongest City findings first, and counts them separately", async () => {
    const before = await headline();
    await cite("F", "cited", "2026-09-01");
    await cite("G", "lien_filed", "2026-10-01");
    await cite("H", "demolition_ordered", "2026-10-05"); // a council finding: counts as blight, not City-flagged
    expect((await needsNewsroomCheck()).map((r) => [r.parcel_id, r.substatus])).toEqual([["G", "lien_filed"], ["F", "cited"]]);
    const h = await headline();
    expect(h.city_flagged).toBe(before.city_flagged + 2);
    expect(h.blighted).toBe(before.blighted + 1); // H
  });

  it("a staff photo verifies a flagged parcel without hiding the City action", async () => {
    const before = await headline();
    const id = await fullSubmission(contributor, "F");
    const d = await submissionDetail(id);
    expect(d.kind).toBe("initial"); // needs verifying, not a follow-up
    expect(await events("F")).toEqual(["city_action/city_record"]); // no 'submitted' marker over the City status
    await review(admin, id, { action: "approve", checklist: ALL_CHECKED });
    expect(await events("F")).toEqual(["city_action/city_record", "verified_blighted/user_photo"]);
    expect(await status("F")).toBe("city_action"); // still shows the City action
    const after = await headline();
    expect(after.city_flagged).toBe(before.city_flagged - 1);
    expect(after.blighted).toBe(before.blighted + 1);
    expect((await needsNewsroomCheck()).map((r) => r.parcel_id)).toEqual(["G"]);
  });
});

