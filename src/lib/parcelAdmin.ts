/** Admin entry of single status events (a city record, a site visit) and voiding mistakes. */
import type pg from "pg";
import { getPool } from "./db";
import { audit, type Staff } from "./auth/staff";
import { WorkflowError } from "./submissions";
import { ACTIONS, parseLooseDate } from "./imports";

const SOURCES = ["admin_entry", "city_record", "council_agenda", "land_roll"];
const MANUAL_STATUSES = ["verified_blighted", ...new Set(ACTIONS.map((a) => a.status))];

export interface EventInput {
  parcelId: string;
  status: string;
  substatus?: string | null;
  date: string;
  source: string;
  note?: string | null;
  documentId?: string | null;
}

export async function addEvent(admin: Staff, input: EventInput, db: pg.Pool | pg.PoolClient = getPool()): Promise<number> {
  if (admin.role !== "admin") throw new WorkflowError("Admins only.", 403);
  if (!MANUAL_STATUSES.includes(input.status)) throw new WorkflowError("Pick a status.");
  const sub = input.substatus || null;
  if (input.status !== "verified_blighted" && !ACTIONS.some((a) => a.status === input.status && a.substatus === sub)) {
    throw new WorkflowError("Pick what happened.");
  }
  if (input.status === "verified_blighted" && sub) throw new WorkflowError("Verified blighted has no sub-status.");
  if (!SOURCES.includes(input.source)) throw new WorkflowError("Pick a source.");
  const date = parseLooseDate(input.date);
  if (!date) throw new WorkflowError("Enter a valid date.");
  const today = (await db.query("SELECT (now() AT TIME ZONE 'America/Chicago')::date::text d")).rows[0].d;
  if (date > today) throw new WorkflowError("The date can't be in the future.");
  const ok = await db.query("SELECT 1 FROM app.parcel_registry WHERE county = 'Hinds' AND parcel_id = $1", [input.parcelId]);
  if (!ok.rows.length) throw new WorkflowError("That parcel isn't in our records.", 404);
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO app.status_events (county, parcel_id, status, substatus, effective_date, source, document_id, note, recorded_by)
     VALUES ('Hinds', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [input.parcelId, input.status, sub, date, input.source, input.documentId || null, input.note?.trim().slice(0, 500) || null, admin.id],
  );
  await audit(db, admin.id, "status.add", "parcel", input.parcelId, { event: rows[0].id, status: input.status, substatus: sub, date });
  return rows[0].id;
}

export async function voidEvent(admin: Staff, eventId: number, reason: string) {
  if (admin.role !== "admin") throw new WorkflowError("Admins only.", 403);
  if (!reason?.trim()) throw new WorkflowError("Say why this entry is being voided.");
  const pool = getPool();
  const { rows } = await pool.query("SELECT parcel_id FROM app.status_events WHERE id = $1", [eventId]);
  if (!rows[0]) throw new WorkflowError("Entry not found.", 404);
  const r = await pool.query(
    "INSERT INTO app.status_event_voids (event_id, reason, voided_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [eventId, reason.trim().slice(0, 500), admin.id],
  );
  if (!r.rowCount) throw new WorkflowError("Already voided.");
  await audit(pool, admin.id, "status.void", "parcel", rows[0].parcel_id, { event: eventId, reason });
}

/** Full history for admins: includes submitted/unreported markers and voided entries. */
export async function adminParcel(parcelId: string) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT f.parcel_id, f.situs_address, f.owner_name, f.portfolio_id, f.owner_type, f.in_city, f.ward,
            COALESCE(s.status::text, 'unreported') AS status, s.substatus, s.status_since::text,
            (si.parcel_id IS NOT NULL) AS on_state_list, si.list_date::text AS state_list_date
     FROM app.parcel_facts f
     LEFT JOIN app.parcel_status_current s USING (county, parcel_id)
     LEFT JOIN app.state_inventory_latest si USING (county, parcel_id)
     WHERE f.parcel_id = $1`,
    [parcelId],
  );
  if (!rows[0]) return null;
  const { rows: history } = await pool.query(
    `SELECT e.id, e.status::text, e.substatus, e.effective_date::text, e.recorded_at, e.source::text, e.note,
            e.document_id, d.title AS document_title, e.submission_id, COALESCE(st.name, e.recorded_by) AS recorded_by_name,
            v.reason AS void_reason, vs.name AS voided_by_name
     FROM app.status_events e
     LEFT JOIN app.staff st ON st.id::text = e.recorded_by
     LEFT JOIN app.documents d ON d.id = e.document_id
     LEFT JOIN app.status_event_voids v ON v.event_id = e.id
     LEFT JOIN app.staff vs ON vs.id::text = v.voided_by -- voided_by is text (staff id)
     WHERE e.county = 'Hinds' AND e.parcel_id = $1
     ORDER BY e.effective_date DESC, e.recorded_at DESC, e.id DESC`,
    [parcelId],
  );
  const { rows: suggestions } = await pool.query(
    "SELECT id, kind, details, detected_at, status FROM app.suggestions WHERE parcel_id = $1 ORDER BY detected_at DESC",
    [parcelId],
  );
  return { ...rows[0], history, suggestions };
}
