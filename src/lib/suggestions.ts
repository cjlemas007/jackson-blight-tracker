/** Land-roll changes on verified parcels, surfaced for an admin. Never applied automatically. */
import { getPool } from "./db";
import { audit, type Staff } from "./auth/staff";
import { WorkflowError } from "./submissions";
import { addEvent } from "./parcelAdmin";

export async function openSuggestions() {
  const { rows } = await getPool().query(
    `SELECT sg.id, sg.kind, sg.details, sg.detected_at, sg.parcel_id, f.situs_address, f.owner_name,
            COALESCE(s.status::text, 'unreported') AS status, s.substatus
     FROM app.suggestions sg
     LEFT JOIN app.parcel_facts f ON f.county = sg.county AND f.parcel_id = sg.parcel_id
     LEFT JOIN app.parcel_status_current s ON s.county = sg.county AND s.parcel_id = sg.parcel_id
     WHERE sg.status = 'open' ORDER BY sg.detected_at DESC LIMIT 200`,
  );
  return rows;
}

/**
 * Dismiss, or record a status change it prompted (e.g. improvement value went to zero and the
 * house is gone: resolved / demolished, source land roll).
 */
export async function resolveSuggestion(
  admin: Staff,
  id: number,
  input: { action: "dismiss" } | { action: "record"; status: string; substatus?: string | null; date: string; note?: string },
) {
  if (admin.role !== "admin") throw new WorkflowError("Admins only.", 403);
  const pool = getPool();
  const { rows } = await pool.query("SELECT parcel_id, status FROM app.suggestions WHERE id = $1", [id]);
  if (!rows[0]) throw new WorkflowError("Suggestion not found.", 404);
  if (rows[0].status !== "open") throw new WorkflowError("Already handled.");
  let eventId: number | null = null;
  if (input.action === "record") {
    eventId = await addEvent(admin, {
      parcelId: rows[0].parcel_id,
      status: input.status,
      substatus: input.substatus,
      date: input.date,
      source: "land_roll",
      note: input.note || "From a land roll change",
    });
  }
  await pool.query(
    "UPDATE app.suggestions SET status = $2, resolved_by = $3, resolved_at = now(), event_id = $4 WHERE id = $1",
    [id, input.action === "dismiss" ? "dismissed" : "accepted", admin.id, eventId],
  );
  await audit(pool, admin.id, `suggestion.${input.action}`, "parcel", rows[0].parcel_id, { suggestion: id, event: eventId });
}
