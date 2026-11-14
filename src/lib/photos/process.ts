import { createHash } from "node:crypto";
import { getPool } from "../db";
import { storage } from "../storage";
import { detectSensitive } from "./detect";
import { readExif } from "./exif";
import { renderPublic, upright, type Box } from "./render";

/**
 * One photo: read EXIF from the original (it never leaves the private bucket), detect faces
 * and plates, write the stripped + blurred copy. Idempotent: re-running re-renders.
 */
export async function processPhoto(photoId: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ submission_id: string; original_key: string; manual_boxes: Box[] }>(
    "SELECT submission_id, original_key, manual_boxes FROM app.photos WHERE id = $1",
    [photoId],
  );
  const p = rows[0];
  if (!p) throw new Error(`photo ${photoId} not found`);
  try {
    const original = await storage().get(p.original_key);
    if (!original) throw new Error("original file is missing from storage");
    const exif = await readExif(original);
    const up = await upright(original);
    const detection = await detectSensitive(up.buf, up.width, up.height);
    const rendered = await renderPublic(original, [...detection.boxes, ...p.manual_boxes]);
    const processedKey = `processed/${p.submission_id}/${photoId}.jpg`;
    await storage().put(processedKey, rendered.buffer, "image/jpeg");
    await pool.query(
      `UPDATE app.photos SET processed_key = $2, sha256 = $3, bytes = $4, width = $5, height = $6,
         exif_taken_at = $7, exif_pt = CASE WHEN $8::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($9, $8), 4326) END,
         exif_camera = $10, auto_boxes = $11, detector = $12, processing_status = 'done', processing_error = NULL,
         processed_at = now()
       WHERE id = $1`,
      [
        photoId, processedKey, createHash("sha256").update(original).digest("hex"), original.length,
        rendered.width, rendered.height, exif.takenAt, exif.lat, exif.lon, exif.camera,
        JSON.stringify(detection.boxes), detection.detector,
      ],
    );
  } catch (e) {
    await pool.query("UPDATE app.photos SET processing_status = 'failed', processing_error = $2 WHERE id = $1", [
      photoId,
      (e as Error).message.slice(0, 500),
    ]);
  }
}

/** Process a submission's queued photos; move it into the review queue when none are left. */
export async function processSubmission(submissionId: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM app.photos WHERE submission_id = $1 AND processing_status = 'queued' ORDER BY position",
    [submissionId],
  );
  for (const r of rows) await processPhoto(r.id);
  // Failed photos still go to review: the admin sees the error and can request a new photo.
  await pool.query(
    `UPDATE app.submissions SET status = 'pending'
     WHERE id = $1 AND status = 'processing'
       AND NOT EXISTS (SELECT 1 FROM app.photos WHERE submission_id = $1 AND processing_status = 'queued')`,
    [submissionId],
  );
}

/** Re-render after an admin edits blur boxes. */
export async function setManualBoxes(photoId: string, boxes: Box[]): Promise<void> {
  await getPool().query("UPDATE app.photos SET manual_boxes = $2 WHERE id = $1", [photoId, JSON.stringify(boxes)]);
  await processPhoto(photoId);
}

/** Sweeper: everything still queued (crashed workers, dev restarts). */
export async function processAllQueued(): Promise<number> {
  const { rows } = await getPool().query<{ submission_id: string }>(
    "SELECT DISTINCT submission_id FROM app.photos WHERE processing_status = 'queued'",
  );
  for (const r of rows) await processSubmission(r.submission_id);
  return rows.length;
}
