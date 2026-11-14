/**
 * Submission workflow. Pure database logic (no Next.js imports) so it can be tested directly.
 *
 *   draft ──submit──▶ processing ──photos done──▶ pending ──approve──▶ approved
 *     ▲                                             │  ├──reject───▶ rejected
 *     └───────── add photos ◀── needs_photo ◀───────┘  └──reassign─▶ pending (other parcel)
 *
 * Status events (append-only history) written along the way:
 *   first submission on an unreported parcel  → 'submitted'          (never shown publicly)
 *   approval while unreported/submitted        → 'verified_blighted' (dated the approval day)
 *   rejection leaving nothing else open        → back to 'unreported'
 *   follow-ups on verified parcels             → no status change; photos join the timeline
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { getPool } from "./db";
import { audit, type Staff } from "./auth/staff";
import { ACCEPTED_MIME, APPROVAL_STANDARD, CONDITIONS, MAX_PHOTO_BYTES, MAX_PHOTOS, NOTE_MAX } from "./approval";

export class WorkflowError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const OPEN = ["processing", "pending", "needs_photo"];
const VERIFIED_OR_LATER = ["verified_blighted", "city_action", "resolved"];

async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

async function parcelStatus(c: pg.PoolClient, county: string, parcelId: string): Promise<string> {
  const { rows } = await c.query<{ status: string }>(
    "SELECT status::text FROM app.parcel_status_current WHERE county = $1 AND parcel_id = $2",
    [county, parcelId],
  );
  return rows[0]?.status ?? "unreported";
}

/** Has the newsroom ever verified this parcel? (City-flagged parcels haven't.) */
async function everVerified(c: pg.PoolClient, county: string, parcelId: string): Promise<boolean> {
  const { rows } = await c.query(
    "SELECT 1 FROM app.status_events_live WHERE county = $1 AND parcel_id = $2 AND status = 'verified_blighted' LIMIT 1",
    [county, parcelId],
  );
  return rows.length > 0;
}

/** Follow-up = adds photos to an already verified parcel. City-flagged parcels still need verifying. */
async function kindFor(c: pg.PoolClient, county: string, parcelId: string, current: string) {
  return VERIFIED_OR_LATER.includes(current) && (await everVerified(c, county, parcelId)) ? "follow_up" : "initial";
}

async function addEvent(
  c: pg.PoolClient,
  e: { county: string; parcelId: string; status: string; date?: string; source: string; by: string; submissionId?: string; note?: string },
) {
  await c.query(
    `INSERT INTO app.status_events (county, parcel_id, status, effective_date, source, recorded_by, submission_id, note)
     VALUES ($1, $2, $3, COALESCE($4::date, (now() AT TIME ZONE 'America/Chicago')::date), $5, $6, $7, $8)`,
    [e.county, e.parcelId, e.status, e.date ?? null, e.source, e.by, e.submissionId ?? null, e.note ?? null],
  );
}

async function lockSubmission(c: pg.PoolClient, id: string) {
  const { rows } = await c.query<{
    id: string; county: string; parcel_id: string; status: string; kind: string | null; submitted_by: string;
  }>("SELECT id, county, parcel_id, status, kind, submitted_by FROM app.submissions WHERE id = $1 FOR UPDATE", [id]);
  if (!rows[0]) throw new WorkflowError("Submission not found.", 404);
  return rows[0];
}

/** If a parcel shows 'submitted' only because of open submissions and none are left, return it to unreported. */
async function revertSubmittedIfNoneOpen(c: pg.PoolClient, county: string, parcelId: string, by: string, note: string) {
  if ((await parcelStatus(c, county, parcelId)) !== "submitted") return;
  const { rows } = await c.query(
    "SELECT 1 FROM app.submissions WHERE county = $1 AND parcel_id = $2 AND status = ANY($3) LIMIT 1",
    [county, parcelId, OPEN],
  );
  if (!rows.length) await addEvent(c, { county, parcelId, status: "unreported", source: "admin_entry", by, note });
}

async function assertSubmittableParcel(c: pg.PoolClient | pg.Pool, county: string, parcelId: string) {
  const { rows } = await c.query<{ in_city: boolean }>(
    "SELECT in_city FROM app.parcel_facts WHERE county = $1 AND parcel_id = $2",
    [county, parcelId],
  );
  if (!rows[0]) throw new WorkflowError("That parcel isn't in our records.", 404);
  if (!rows[0].in_city) throw new WorkflowError("That parcel is outside Jackson city limits.");
}

// ---------------------------------------------------------------------------------------
// Contributor actions
// ---------------------------------------------------------------------------------------

export async function createDraft(staff: Staff, county: string, parcelId: string): Promise<string> {
  const pool = getPool();
  await assertSubmittableParcel(pool, county, parcelId);
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO app.submissions (county, parcel_id, submitted_by) VALUES ($1, $2, $3) RETURNING id",
    [county, parcelId, staff.id],
  );
  return rows[0].id;
}

/** Reserve a photo slot; returns the storage key the browser uploads to. */
export async function addPhotoSlot(
  staff: Staff,
  submissionId: string,
  file: { name: string; mime: string; bytes: number },
): Promise<{ photoId: string; key: string }> {
  if (!ACCEPTED_MIME.includes(file.mime)) {
    throw new WorkflowError("Photos must be JPEG, PNG or WebP. On iPhone, choose “Most Compatible” or upload from the camera.");
  }
  if (file.bytes > MAX_PHOTO_BYTES) throw new WorkflowError("That photo is over 25 MB.");
  return tx(async (c) => {
    const s = await lockSubmission(c, submissionId);
    if (s.submitted_by !== staff.id) throw new WorkflowError("Not your submission.", 403);
    if (s.status !== "draft" && s.status !== "needs_photo") throw new WorkflowError("This submission can't take more photos.");
    const { rows } = await c.query<{ n: number; maxpos: number }>(
      "SELECT count(*)::int n, COALESCE(max(position), 0)::int maxpos FROM app.photos WHERE submission_id = $1",
      [submissionId],
    );
    if (rows[0].n >= MAX_PHOTOS) throw new WorkflowError(`Up to ${MAX_PHOTOS} photos per submission.`);
    const photoId = randomUUID();
    const ext = file.mime === "image/png" ? "png" : file.mime === "image/webp" ? "webp" : "jpg";
    const key = `originals/${submissionId}/${photoId}.${ext}`;
    await c.query(
      `INSERT INTO app.photos (id, submission_id, position, original_key, original_name, mime_type, bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [photoId, submissionId, rows[0].maxpos + 1, key, file.name.slice(0, 200), file.mime, file.bytes],
    );
    return { photoId, key };
  });
}

/** Contributor removes a photo before submitting (e.g. picked the wrong one). */
export async function removePhoto(staff: Staff, photoId: string): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{ submission_id: string; processing_status: string }>(
      "SELECT submission_id, processing_status FROM app.photos WHERE id = $1",
      [photoId],
    );
    if (!rows[0]) throw new WorkflowError("Photo not found.", 404);
    const s = await lockSubmission(c, rows[0].submission_id);
    if (s.submitted_by !== staff.id) throw new WorkflowError("Not your submission.", 403);
    if (rows[0].processing_status !== "uploading") throw new WorkflowError("Submitted photos can't be removed.");
    await c.query("DELETE FROM app.photos WHERE id = $1", [photoId]);
  });
}

/** Called by the upload route once the file is stored. */
export async function photoSlotForUpload(staff: Staff, key: string) {
  const { rows } = await getPool().query<{ id: string; mime_type: string; status: string; submitted_by: string; processing_status: string }>(
    `SELECT p.id, p.mime_type, s.status, s.submitted_by, p.processing_status
     FROM app.photos p JOIN app.submissions s ON s.id = p.submission_id WHERE p.original_key = $1`,
    [key],
  );
  const r = rows[0];
  if (!r || r.submitted_by !== staff.id || r.processing_status !== "uploading") {
    throw new WorkflowError("No upload is expected for that file.", 403);
  }
  return r;
}

export interface SubmitInput {
  conditions: string[];
  note?: string;
  vantageConfirmed: boolean;
}

/**
 * Send a draft (or a needs_photo submission with new photos) for processing + review.
 * `uploaded(key)` checks storage so a half-finished upload can't slip through.
 */
export async function submit(
  staff: Staff,
  submissionId: string,
  input: SubmitInput,
  uploaded: (key: string) => Promise<boolean>,
): Promise<void> {
  const conditions = [...new Set(input.conditions)];
  const valid = new Set<string>(CONDITIONS.map((c) => c.id));
  if (!conditions.length) throw new WorkflowError("Tick at least one condition.");
  if (conditions.some((c) => !valid.has(c))) throw new WorkflowError("Unknown condition.");
  if (!input.vantageConfirmed) throw new WorkflowError("Confirm where the photos were taken from.");
  const note = (input.note ?? "").trim();
  if (note.length > NOTE_MAX) throw new WorkflowError(`Keep the note under ${NOTE_MAX} characters.`);

  const { rows: pending } = await getPool().query<{ original_key: string }>(
    "SELECT original_key FROM app.photos WHERE submission_id = $1 AND processing_status = 'uploading'",
    [submissionId],
  );
  for (const p of pending) {
    if (!(await uploaded(p.original_key))) throw new WorkflowError("A photo is still uploading. Try again in a moment.");
  }

  await tx(async (c) => {
    const s = await lockSubmission(c, submissionId);
    if (s.submitted_by !== staff.id) throw new WorkflowError("Not your submission.", 403);
    if (s.status !== "draft" && s.status !== "needs_photo") throw new WorkflowError("Already submitted.");
    const { rows } = await c.query<{ n: number; fresh: number }>(
      "SELECT count(*)::int n, count(*) FILTER (WHERE processing_status = 'uploading')::int fresh FROM app.photos WHERE submission_id = $1",
      [submissionId],
    );
    if (rows[0].n === 0) throw new WorkflowError("Add at least one photo.");
    if (s.status === "needs_photo" && rows[0].fresh === 0) throw new WorkflowError("Add a new photo first.");

    const current = await parcelStatus(c, s.county, s.parcel_id);
    const kind = await kindFor(c, s.county, s.parcel_id, current);
    await c.query("UPDATE app.photos SET processing_status = 'queued' WHERE submission_id = $1 AND processing_status = 'uploading'", [
      submissionId,
    ]);
    await c.query(
      `UPDATE app.submissions SET status = 'processing', kind = COALESCE(kind, $2), conditions = $3, note = NULLIF($4, ''),
         vantage_confirmed = true, submitted_at = COALESCE(submitted_at, now())
       WHERE id = $1`,
      [submissionId, kind, conditions, note],
    );
    if (current === "unreported") {
      await addEvent(c, { county: s.county, parcelId: s.parcel_id, status: "submitted", source: "user_photo", by: staff.id, submissionId });
    }
    await audit(c, staff.id, s.status === "draft" ? "submission.submit" : "submission.resubmit", "submission", submissionId, {
      parcel: s.parcel_id,
      kind,
    });
  });
}

// ---------------------------------------------------------------------------------------
// Admin review
// ---------------------------------------------------------------------------------------

export type ReviewAction =
  | { action: "approve"; checklist: Record<string, boolean> }
  | { action: "reject"; reason: string }
  | { action: "request_photo"; reason: string }
  | { action: "reassign"; parcelId: string };

export async function review(admin: Staff, submissionId: string, a: ReviewAction): Promise<void> {
  if (admin.role !== "admin") throw new WorkflowError("Admins only.", 403);
  await tx(async (c) => {
    const s = await lockSubmission(c, submissionId);
    if (s.status !== "pending") throw new WorkflowError(`This submission is ${s.status}, not waiting for review.`);
    const by = admin.id;

    if (a.action === "approve") {
      const missing = APPROVAL_STANDARD.filter((i) => !a.checklist?.[i.id]);
      if (missing.length) throw new WorkflowError("Every item of the approval standard must be checked to approve.");
      const { rows } = await c.query<{ bad: number }>(
        "SELECT count(*)::int bad FROM app.photos WHERE submission_id = $1 AND processing_status <> 'done'",
        [submissionId],
      );
      if (rows[0].bad) throw new WorkflowError("A photo failed processing. Request a new photo instead.");
      await c.query(
        `UPDATE app.submissions SET status = 'approved', reviewed_by = $2, reviewed_at = now(), review_checklist = $3 WHERE id = $1`,
        [submissionId, by, JSON.stringify(a.checklist)],
      );
      const current = await parcelStatus(c, s.county, s.parcel_id);
      const cityFlagged = current === "city_action" && !(await everVerified(c, s.county, s.parcel_id));
      if (current === "unreported" || current === "submitted" || cityFlagged) {
        // On a City-flagged parcel this verifies it but the City action stays the current status
        // (see app.status_as_of).
        await addEvent(c, { county: s.county, parcelId: s.parcel_id, status: "verified_blighted", source: "user_photo", by, submissionId });
      }
      await audit(c, by, "submission.approve", "submission", submissionId, { parcel: s.parcel_id, parcel_status_before: current });
    } else if (a.action === "reject") {
      const reason = a.reason?.trim();
      if (!reason) throw new WorkflowError("Give a reason for rejecting.");
      await c.query(
        "UPDATE app.submissions SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_reason = $3 WHERE id = $1",
        [submissionId, by, reason],
      );
      await revertSubmittedIfNoneOpen(c, s.county, s.parcel_id, by, "Submission rejected on review");
      await audit(c, by, "submission.reject", "submission", submissionId, { parcel: s.parcel_id, reason });
    } else if (a.action === "request_photo") {
      const reason = a.reason?.trim();
      if (!reason) throw new WorkflowError("Say what kind of photo is needed.");
      await c.query(
        "UPDATE app.submissions SET status = 'needs_photo', reviewed_by = $2, reviewed_at = now(), review_reason = $3 WHERE id = $1",
        [submissionId, by, reason],
      );
      await audit(c, by, "submission.request_photo", "submission", submissionId, { reason });
    } else if (a.action === "reassign") {
      const target = a.parcelId?.trim();
      if (!target || target === s.parcel_id) throw new WorkflowError("Pick a different parcel.");
      await assertSubmittableParcel(c, s.county, target);
      await c.query("UPDATE app.submissions SET parcel_id = $2 WHERE id = $1", [submissionId, target]);
      // History is append-only: the old parcel gets an 'unreported' event if nothing else is open on it,
      // and the new parcel gets its own 'submitted' event.
      await revertSubmittedIfNoneOpen(c, s.county, s.parcel_id, by, "Submission moved to the correct parcel");
      const targetStatus = await parcelStatus(c, s.county, target);
      const kind = await kindFor(c, s.county, target, targetStatus);
      await c.query("UPDATE app.submissions SET kind = $2 WHERE id = $1", [submissionId, kind]);
      if (targetStatus === "unreported") {
        await addEvent(c, { county: s.county, parcelId: target, status: "submitted", source: "admin_entry", by, submissionId });
      }
      await audit(c, by, "submission.reassign", "submission", submissionId, { from: s.parcel_id, to: target });
    }
  });
}

// ---------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------

export async function mySubmissions(staff: Staff) {
  const { rows } = await getPool().query(
    `SELECT s.id, s.status, s.kind, s.parcel_id, f.situs_address, s.created_at, s.submitted_at, s.review_reason,
            (SELECT count(*)::int FROM app.photos p WHERE p.submission_id = s.id) AS photo_count
     FROM app.submissions s LEFT JOIN app.parcel_facts f USING (county, parcel_id)
     WHERE s.submitted_by = $1 ORDER BY s.created_at DESC LIMIT 100`,
    [staff.id],
  );
  return rows;
}

export async function queue(statuses: string[] = ["pending"]) {
  const { rows } = await getPool().query(
    "SELECT * FROM app.review_queue WHERE status = ANY($1) ORDER BY submitted_at NULLS LAST LIMIT 200",
    [statuses],
  );
  return rows;
}

export async function submissionDetail(id: string) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT q.*, s.submitted_by, s.created_at, s.vantage_confirmed, s.review_checklist, s.reviewed_at,
            rv.name AS reviewed_by_name
     FROM app.review_queue q JOIN app.submissions s ON s.id = q.id
     LEFT JOIN app.staff rv ON rv.id = s.reviewed_by
     WHERE q.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const sub = rows[0];
  const [photos, prior, facts, auditRows] = await Promise.all([
    pool.query(
      `SELECT p.id, p.position, p.processing_status, p.processing_error, p.width, p.height, p.exif_taken_at,
              p.exif_camera, p.detector, p.auto_boxes, p.manual_boxes, p.processed_key IS NOT NULL AS has_processed,
              ST_Y(p.exif_pt) AS exif_lat, ST_X(p.exif_pt) AS exif_lon,
              round(ST_Distance(p.exif_pt::geography, f.pt::geography))::int AS exif_distance_m
       FROM app.photos p
       JOIN app.submissions s ON s.id = p.submission_id
       LEFT JOIN app.parcel_facts f ON f.county = s.county AND f.parcel_id = s.parcel_id
       WHERE p.submission_id = $1 ORDER BY p.position`,
      [id],
    ),
    pool.query(
      `SELECT s.id, s.status, s.kind, s.submitted_at, st.name AS submitted_by_name, s.review_reason
       FROM app.submissions s JOIN app.staff st ON st.id = s.submitted_by
       WHERE s.county = $1 AND s.parcel_id = $2 AND s.id <> $3 AND s.status <> 'draft'
       ORDER BY s.submitted_at DESC`,
      [sub.county, sub.parcel_id, id],
    ),
    pool.query(
      `SELECT parcel_id, situs_address, owner_name, owner_type, owner_source, attributed_owner, homestead,
              appraised_total, tv_imp, year_built, deed_date, current_due, delinquent, ward, neighborhood, zip,
              to_char(owner_as_of AT TIME ZONE 'America/Chicago', 'Mon DD, YYYY') AS owner_as_of,
              ST_Y(pt) AS lat, ST_X(pt) AS lon
       FROM app.parcel_facts WHERE county = $1 AND parcel_id = $2`,
      [sub.county, sub.parcel_id],
    ),
    pool.query(
      `SELECT a.at, a.action, a.details, st.name AS actor
       FROM app.audit_log a LEFT JOIN app.staff st ON st.id = a.actor_id
       WHERE a.entity = 'submission' AND a.entity_id = $1 ORDER BY a.at`,
      [id],
    ),
  ]);
  return { ...sub, photos: photos.rows, prior: prior.rows, parcel: facts.rows[0] ?? null, audit: auditRows.rows };
}

/** Approved photos for a parcel's public timeline, newest first. */
export async function publicPhotos(county: string, parcelId: string) {
  const { rows } = await getPool().query(
    `SELECT p.id, p.width, p.height, s.kind, s.conditions,
            to_char(COALESCE(p.exif_taken_at, s.submitted_at) AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS taken_on,
            to_char(s.reviewed_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS verified_on
     FROM app.photos p JOIN app.submissions s ON s.id = p.submission_id
     WHERE s.county = $1 AND s.parcel_id = $2 AND s.status = 'approved' AND p.processing_status = 'done'
     ORDER BY COALESCE(p.exif_taken_at, s.submitted_at) DESC, p.position`,
    [county, parcelId],
  );
  return rows;
}
