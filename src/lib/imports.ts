/**
 * Record imports: city demolition lists, code-enforcement case logs (CSV from records requests),
 * council agenda quick entry (pasted addresses), and the Secretary of State tax-forfeited list.
 *
 *   upload → mapping (pick columns, date, action) → review (match rows to parcels) → apply
 *
 * Rows that match exactly one parcel by parcel ID, DPIN, or exact address are accepted
 * automatically; everything else waits on the review screen. Nothing reaches the status history
 * until an admin applies the batch, and re-applying the same record never duplicates an event.
 */
import type pg from "pg";
import { getPool } from "./db";
import { parseCsv } from "./csv";
import { audit, type Staff } from "./auth/staff";
import { WorkflowError } from "./submissions";
import { cleanText, parseSitus } from "./normalize/address";
import { storage } from "./storage";

export type ImportKind = "demolition_list" | "code_enforcement" | "council_agenda" | "sos_forfeited";

/** What each kind writes when applied (admins can change the action per batch or per row). */
export const KIND_DEFAULTS: Record<ImportKind, { label: string; status?: string; substatus?: string; source?: string }> = {
  demolition_list: { label: "City demolition list", status: "resolved", substatus: "demolished", source: "city_record" },
  code_enforcement: { label: "Code enforcement case log", status: "city_action", substatus: "cited", source: "city_record" },
  council_agenda: { label: "Council agenda", status: "city_action", substatus: "adjudicated", source: "council_agenda" },
  sos_forfeited: { label: "Secretary of State tax-forfeited list" },
};

export const ACTIONS: { status: string; substatus: string; label: string }[] = [
  { status: "city_action", substatus: "cited", label: "Cited" },
  { status: "city_action", substatus: "hearing_set", label: "Hearing set" },
  { status: "city_action", substatus: "adjudicated", label: "Adjudicated by council" },
  { status: "city_action", substatus: "demolition_ordered", label: "Demolition ordered" },
  { status: "city_action", substatus: "lot_cleanup_ordered", label: "Lot cleanup ordered" },
  { status: "city_action", substatus: "lien_filed", label: "Lien filed" },
  { status: "resolved", substatus: "demolished", label: "Demolished" },
  { status: "resolved", substatus: "repaired", label: "Repaired" },
  { status: "resolved", substatus: "lot_cleared", label: "Lot cleared" },
];
const statusOf = (sub: string) => ACTIONS.find((a) => a.substatus === sub)?.status;

const MAX_ROWS = 5000;

// ---------------------------------------------------------------------------------------
// Parsing helpers (pure; tested)
// ---------------------------------------------------------------------------------------

/** "6/2/2017", "06/02/17", "2017-06-02", "2017/6/2" -> "2017-06-02"; else null. */
export function parseLooseDate(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/))) {
    [m, d, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
    if (y < 100) y += y >= 70 ? 1900 : 2000;
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1900) return null;
  return dt.toISOString().slice(0, 10);
}

/** Uppercase, no spaces: "4854 104-6 " -> "4854-104-6". */
export function normalizeParcelInput(v: string | null | undefined): string | null {
  const s = (v ?? "").toUpperCase().replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
  return s || null;
}

/** Only letters and digits, for matching records that drop the dashes: "4854-104-6" -> "48541046". */
export function compactParcelId(v: string): string {
  return v.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Strip city/state/zip and unit noise from a pasted address: "522 Burns St, Jackson, MS 39203" -> "522 BURNS ST". */
export function addressCore(v: string | null | undefined): string | null {
  let s = cleanText(v).replace(/#/g, " ");
  s = s.replace(/\bJACKSON\b.*$/, "").replace(/\bMS\b\s*\d{5}(-\d{4})?\s*$/, "").replace(/\b\d{5}(-\d{4})?\s*$/, "");
  s = s.replace(/\s+/g, " ").trim();
  return s || null;
}

// ---------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------

interface ParcelIndex {
  byId: Set<string>;
  byCompact: Map<string, string[]>;
  byDpin: Map<string, string>;
  byAddress: Map<string, string[]>; // "522|BURNS ST" -> parcel ids
}

async function loadIndex(db: pg.Pool | pg.PoolClient): Promise<ParcelIndex> {
  const { rows } = await db.query<{ parcel_id: string; situs_number: number | null; street_name: string | null; dpin: string | null }>(
    `SELECT f.parcel_id, f.situs_number, f.street_name, g.dpin
     FROM app.parcel_facts f LEFT JOIN data.gis_parcels g USING (county, parcel_id)`,
  );
  const idx: ParcelIndex = { byId: new Set(), byCompact: new Map(), byDpin: new Map(), byAddress: new Map() };
  const push = (m: Map<string, string[]>, k: string, v: string) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  for (const r of rows) {
    idx.byId.add(r.parcel_id);
    push(idx.byCompact, compactParcelId(r.parcel_id), r.parcel_id);
    if (r.dpin) idx.byDpin.set(r.dpin.replace(/\D/g, ""), r.parcel_id);
    if (r.situs_number && r.street_name) push(idx.byAddress, `${r.situs_number}|${r.street_name}`, r.parcel_id);
  }
  return idx;
}

export interface MatchResult {
  parcelId: string | null;
  method: "parcel_id" | "dpin" | "address_exact" | "address_fuzzy" | null;
  score: number | null;
  candidates: { parcel_id: string; situs_address: string | null; score?: number }[];
  accepted: boolean;
}

/** Match one row. Exact unique matches are accepted; anything else is left for review. */
export async function matchOne(
  db: pg.Pool | pg.PoolClient,
  idx: ParcelIndex,
  input: { parcelId: string | null; address: string | null },
): Promise<MatchResult> {
  const none: MatchResult = { parcelId: null, method: null, score: null, candidates: [], accepted: false };
  const pid = normalizeParcelInput(input.parcelId);
  if (pid) {
    if (idx.byId.has(pid)) return { parcelId: pid, method: "parcel_id", score: 1, candidates: [], accepted: true };
    const digits = (input.parcelId ?? "").replace(/\D/g, ""); // DPINs keep their leading zeros
    if (digits.length === 18 && idx.byDpin.has(digits)) {
      return { parcelId: idx.byDpin.get(digits)!, method: "dpin", score: 1, candidates: [], accepted: true };
    }
    const compact = idx.byCompact.get(compactParcelId(pid)) ?? [];
    if (compact.length === 1) return { parcelId: compact[0], method: "parcel_id", score: 0.95, candidates: [], accepted: true };
    if (compact.length > 1) {
      return { ...none, candidates: compact.map((p) => ({ parcel_id: p, situs_address: null })) };
    }
  }
  const core = addressCore(input.address);
  if (!core) return none;
  const { number, street } = parseSitus(core);
  if (number && street) {
    const exact = idx.byAddress.get(`${number}|${street}`) ?? [];
    if (exact.length === 1) return { parcelId: exact[0], method: "address_exact", score: 1, candidates: [], accepted: true };
    if (exact.length > 1) {
      const { rows } = await db.query("SELECT parcel_id, situs_address FROM app.parcel_facts WHERE parcel_id = ANY($1)", [exact]);
      return { ...none, method: "address_exact", candidates: rows };
    }
  }
  // Fuzzy: trigram similarity on the situs address, same house number when one was given.
  const { rows } = await db.query<{ parcel_id: string; situs_address: string; score: number }>(
    `SELECT parcel_id, situs_address, similarity(situs_address, $1)::float4 AS score
     FROM app.parcel_facts
     WHERE situs_address % $1 AND ($2::int IS NULL OR situs_number = $2) AND in_city
     ORDER BY score DESC LIMIT 5`,
    [core, number],
  );
  if (!rows.length) return none;
  return { parcelId: rows[0].parcel_id, method: "address_fuzzy", score: rows[0].score, candidates: rows, accepted: false };
}

async function matchBatch(c: pg.PoolClient, batchId: string) {
  const idx = await loadIndex(c);
  await c.query("SELECT set_limit(0.45)"); // trigram threshold for %
  const { rows } = await c.query<{ id: number; input_parcel_id: string | null; input_address: string | null }>(
    "SELECT id, input_parcel_id, input_address FROM app.import_rows WHERE batch_id = $1 ORDER BY row_num",
    [batchId],
  );
  const counts = { accepted: 0, review: 0, unmatched: 0 };
  for (const r of rows) {
    const m = await matchOne(c, idx, { parcelId: r.input_parcel_id, address: r.input_address });
    await c.query(
      `UPDATE app.import_rows SET match_county = CASE WHEN $2::text IS NULL THEN NULL ELSE 'Hinds' END, match_parcel_id = $2,
         match_method = $3, match_score = $4, candidates = $5, decision = $6
       WHERE id = $1`,
      [r.id, m.parcelId, m.method, m.score, JSON.stringify(m.candidates), m.accepted ? "accepted" : "pending"],
    );
    if (m.accepted) counts.accepted++;
    else if (m.parcelId || m.candidates.length) counts.review++;
    else counts.unmatched++;
  }
  return counts;
}

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

const requireAdmin = (s: Staff) => {
  if (s.role !== "admin") throw new WorkflowError("Admins only.", 403);
};

async function lockBatch(c: pg.PoolClient, id: string) {
  const { rows } = await c.query("SELECT * FROM app.import_batches WHERE id = $1 FOR UPDATE", [id]);
  if (!rows[0]) throw new WorkflowError("Import not found.", 404);
  return rows[0] as {
    id: string; kind: ImportKind; status: string; title: string; default_date: string | null; event_status: string | null;
    event_substatus: string | null; source: string | null; document_id: string | null; headers: string[] | null;
  };
}

// ---------------------------------------------------------------------------------------
// Creating batches
// ---------------------------------------------------------------------------------------

/** From an uploaded CSV document: stores the rows, returns headers for column mapping. */
export async function createCsvBatch(
  staff: Staff,
  input: { kind: ImportKind; title: string; documentId: string },
  readFile: (key: string) => Promise<Buffer | null> = (k) => storage().get(k),
): Promise<string> {
  requireAdmin(staff);
  if (input.kind === "council_agenda") throw new WorkflowError("Council agendas use quick entry, not CSV.");
  const { rows: docs } = await getPool().query("SELECT storage_key, kind FROM app.documents WHERE id = $1", [input.documentId]);
  if (!docs[0] || docs[0].kind !== "csv") throw new WorkflowError("Upload a CSV file first.");
  const buf = await readFile(docs[0].storage_key);
  if (!buf) throw new WorkflowError("The CSV file is missing from storage.");
  const table = parseCsv(buf.toString("utf8").replace(/^﻿/, ""));
  if (table.length < 2) throw new WorkflowError("The CSV needs a header row and at least one data row.");
  const [header, ...body] = table;
  if (body.length > MAX_ROWS) throw new WorkflowError(`Split the file: up to ${MAX_ROWS} rows per import.`);
  const headers = header.map((h, i) => h.trim() || `Column ${i + 1}`);
  return tx(async (c) => {
    const d = KIND_DEFAULTS[input.kind];
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.import_batches (kind, title, document_id, headers, event_status, event_substatus, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [input.kind, input.title.trim() || d.label, input.documentId, headers, d.status ?? null, d.substatus ?? null, d.source ?? null, staff.id],
    );
    const id = rows[0].id;
    const raws = body.map((r, i) => ({ row_num: i + 1, raw: Object.fromEntries(headers.map((h, j) => [h, (r[j] ?? "").trim()])) }));
    await c.query(
      `INSERT INTO app.import_rows (batch_id, row_num, raw)
       SELECT $1, r.row_num, r.raw FROM json_to_recordset($2::json) AS r(row_num int, raw jsonb)`,
      [id, JSON.stringify(raws)],
    );
    await audit(c, staff.id, "import.create", "import", id, { kind: input.kind, rows: raws.length });
    return id;
  });
}

export interface Mapping {
  parcelId?: string | null;
  address?: string | null;
  date?: string | null;
  note?: string | null;
}

/** Pick columns, the default date and the action, then match every row. */
export async function mapBatch(
  staff: Staff,
  batchId: string,
  input: { mapping: Mapping; defaultDate?: string | null; substatus?: string | null },
) {
  requireAdmin(staff);
  return tx(async (c) => {
    const b = await lockBatch(c, batchId);
    if (b.status === "applied" || b.status === "discarded") throw new WorkflowError("This import is closed.");
    const m = input.mapping;
    if (!m.parcelId && !m.address) throw new WorkflowError("Pick the parcel ID column, the address column, or both.");
    for (const col of [m.parcelId, m.address, m.date, m.note]) {
      if (col && !(b.headers ?? []).includes(col)) throw new WorkflowError(`Unknown column: ${col}`);
    }
    const defaultDate = input.defaultDate ? parseLooseDate(input.defaultDate) : null;
    if (input.defaultDate && !defaultDate) throw new WorkflowError("The default date isn't a valid date.");
    if (!m.date && !defaultDate) throw new WorkflowError("Pick a date column or set a date for every row.");
    let sub = b.event_substatus;
    if (b.kind !== "sos_forfeited" && input.substatus) {
      if (!statusOf(input.substatus)) throw new WorkflowError("Unknown action.");
      sub = input.substatus;
    }
    await c.query(
      `UPDATE app.import_batches SET mapping = $2, default_date = $3, event_substatus = $4, event_status = $5::app.parcel_status, status = 'review'
       WHERE id = $1`,
      [batchId, JSON.stringify(m), defaultDate, b.kind === "sos_forfeited" ? null : sub, b.kind === "sos_forfeited" ? null : statusOf(sub ?? "")],
    );
    await c.query(
      `UPDATE app.import_rows SET
         input_parcel_id = NULLIF(CASE WHEN $2::text IS NULL THEN NULL ELSE raw ->> $2 END, ''),
         input_address = NULLIF(CASE WHEN $3::text IS NULL THEN NULL ELSE raw ->> $3 END, ''),
         note = NULLIF(CASE WHEN $4::text IS NULL THEN NULL ELSE raw ->> $4 END, ''),
         event_date = NULL
       WHERE batch_id = $1`,
      [batchId, m.parcelId ?? null, m.address ?? null, m.note ?? null],
    );
    if (m.date) {
      const { rows } = await c.query<{ id: number; v: string }>("SELECT id, raw ->> $2 AS v FROM app.import_rows WHERE batch_id = $1", [batchId, m.date]);
      for (const r of rows) {
        const d = parseLooseDate(r.v);
        if (d) await c.query("UPDATE app.import_rows SET event_date = $2 WHERE id = $1", [r.id, d]);
      }
    }
    const counts = await matchBatch(c, batchId);
    await c.query("UPDATE app.import_batches SET stats = $2 WHERE id = $1", [batchId, JSON.stringify(counts)]);
    return counts;
  });
}

/** Council agenda quick entry: one address (or parcel ID) per line. */
export async function createAgendaBatch(
  staff: Staff,
  input: { title: string; meetingDate: string; substatus: string; lines: string; documentId?: string | null },
): Promise<string> {
  requireAdmin(staff);
  const date = parseLooseDate(input.meetingDate);
  if (!date) throw new WorkflowError("Enter the meeting date.");
  if (!statusOf(input.substatus)) throw new WorkflowError("Pick what the council did.");
  const lines = input.lines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new WorkflowError("Paste at least one address.");
  if (lines.length > MAX_ROWS) throw new WorkflowError(`Up to ${MAX_ROWS} addresses at a time.`);
  return tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.import_batches (kind, title, document_id, headers, mapping, default_date, event_status, event_substatus, source, created_by, status)
       VALUES ('council_agenda', $1, $2, '{line}', '{"address":"line"}', $3, $4, $5, 'council_agenda', $6, 'review') RETURNING id`,
      [input.title.trim() || `Council meeting ${date}`, input.documentId || null, date, statusOf(input.substatus), input.substatus, staff.id],
    );
    const id = rows[0].id;
    const raws = lines.map((l, i) => {
      const looksLikeId = /^\d+(-[\dA-Z]+)+$/i.test(l.replace(/\s/g, ""));
      return { row_num: i + 1, raw: { line: l }, parcel: looksLikeId ? l : null, address: looksLikeId ? null : l };
    });
    await c.query(
      `INSERT INTO app.import_rows (batch_id, row_num, raw, input_parcel_id, input_address)
       SELECT $1, r.row_num, r.raw, r.parcel, r.address FROM json_to_recordset($2::json) AS r(row_num int, raw jsonb, parcel text, address text)`,
      [id, JSON.stringify(raws)],
    );
    const counts = await matchBatch(c, id);
    await c.query("UPDATE app.import_batches SET stats = $2 WHERE id = $1", [id, JSON.stringify(counts)]);
    await audit(c, staff.id, "import.create", "import", id, { kind: "council_agenda", rows: lines.length });
    return id;
  });
}

// ---------------------------------------------------------------------------------------
// Review and apply
// ---------------------------------------------------------------------------------------

/** Admin fixes a row: pick a parcel (or none), accept or skip, optionally a different action. */
export async function updateRow(
  staff: Staff,
  rowId: number,
  input: { parcelId?: string | null; decision: "accepted" | "skipped" | "pending"; substatus?: string | null; date?: string | null },
) {
  requireAdmin(staff);
  await tx(async (c) => {
    const { rows } = await c.query<{ batch_id: string; match_parcel_id: string | null }>(
      "SELECT batch_id, match_parcel_id FROM app.import_rows WHERE id = $1",
      [rowId],
    );
    if (!rows[0]) throw new WorkflowError("Row not found.", 404);
    const b = await lockBatch(c, rows[0].batch_id);
    if (b.status !== "review") throw new WorkflowError("This import isn't open for review.");
    let parcel = rows[0].match_parcel_id;
    let method: string | null = null;
    if (input.parcelId !== undefined) {
      parcel = input.parcelId ? normalizeParcelInput(input.parcelId) : null;
      if (parcel) {
        const ok = await c.query("SELECT 1 FROM app.parcel_registry WHERE county = 'Hinds' AND parcel_id = $1", [parcel]);
        if (!ok.rows.length) throw new WorkflowError("That parcel isn't in our records.");
        method = "manual";
      }
    }
    if (input.decision === "accepted" && !parcel) throw new WorkflowError("Pick a parcel before accepting the row.");
    if (input.substatus && !statusOf(input.substatus)) throw new WorkflowError("Unknown action.");
    const date = input.date ? parseLooseDate(input.date) : undefined;
    if (input.date && !date) throw new WorkflowError("That date isn't valid.");
    await c.query(
      `UPDATE app.import_rows SET match_county = CASE WHEN $2::text IS NULL THEN NULL ELSE 'Hinds' END, match_parcel_id = $2,
         match_method = COALESCE($3, match_method), decision = $4,
         event_substatus = COALESCE($5, event_substatus), event_date = COALESCE($6::date, event_date)
       WHERE id = $1`,
      [rowId, parcel, method, input.decision, input.substatus ?? null, date ?? null],
    );
  });
}

export async function discardBatch(staff: Staff, batchId: string) {
  requireAdmin(staff);
  await tx(async (c) => {
    const b = await lockBatch(c, batchId);
    if (b.status === "applied") throw new WorkflowError("Applied imports can't be discarded; void the events instead.");
    await c.query("UPDATE app.import_batches SET status = 'discarded' WHERE id = $1", [batchId]);
    await audit(c, staff.id, "import.discard", "import", batchId);
  });
}

/**
 * Write every accepted row: a status event (or a State inventory listing). A row whose parcel
 * already has the same status + sub-status on the same date is recorded as a duplicate, not
 * written again, so overlapping records requests are safe to import.
 */
export async function applyBatch(staff: Staff, batchId: string) {
  requireAdmin(staff);
  return tx(async (c) => {
    const b = await lockBatch(c, batchId);
    if (b.status !== "review") throw new WorkflowError("This import isn't ready to apply.");
    const { rows: pending } = await c.query("SELECT count(*)::int n FROM app.import_rows WHERE batch_id = $1 AND decision = 'pending'", [batchId]);
    if (pending[0].n > 0) throw new WorkflowError(`${pending[0].n} row(s) still need a decision (accept or skip).`);
    const { rows } = await c.query<{
      id: number; row_num: number; match_county: string; match_parcel_id: string; event_date: string | null; event_substatus: string | null;
      note: string | null; raw: Record<string, string>;
    }>(
      `SELECT id, row_num, match_county, match_parcel_id, event_date::text, event_substatus, note, raw
       FROM app.import_rows WHERE batch_id = $1 AND decision = 'accepted' ORDER BY row_num`,
      [batchId],
    );
    const result = { events: 0, duplicates: 0, listed: 0, skipped: 0 };
    for (const r of rows) {
      const date = r.event_date ?? b.default_date;
      if (!date) throw new WorkflowError(`Row ${r.row_num} has no date.`);
      if (b.kind === "sos_forfeited") {
        const ins = await c.query(
          `INSERT INTO app.state_inventory (county, parcel_id, list_date, batch_id, raw) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [r.match_county, r.match_parcel_id, date, batchId, r.raw],
        );
        await c.query("UPDATE app.import_rows SET apply_result = $2 WHERE id = $1", [r.id, ins.rowCount ? "listed" : "duplicate"]);
        ins.rowCount ? result.listed++ : result.duplicates++;
        continue;
      }
      const sub = r.event_substatus ?? b.event_substatus!;
      const status = statusOf(sub)!;
      const dup = await c.query(
        `SELECT id FROM app.status_events_live
         WHERE county = $1 AND parcel_id = $2 AND status = $3 AND substatus = $4 AND effective_date = $5 LIMIT 1`,
        [r.match_county, r.match_parcel_id, status, sub, date],
      );
      if (dup.rows.length) {
        await c.query("UPDATE app.import_rows SET apply_result = 'duplicate', applied_event_id = $2 WHERE id = $1", [r.id, dup.rows[0].id]);
        result.duplicates++;
        continue;
      }
      const note = [`${b.title}, row ${r.row_num}`, r.note].filter(Boolean).join(": ").slice(0, 500);
      const ev = await c.query<{ id: number }>(
        `INSERT INTO app.status_events (county, parcel_id, status, substatus, effective_date, source, document_id, note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [r.match_county, r.match_parcel_id, status, sub, date, b.source, b.document_id, note, staff.id],
      );
      await c.query("UPDATE app.import_rows SET apply_result = 'event', applied_event_id = $2 WHERE id = $1", [r.id, ev.rows[0].id]);
      result.events++;
    }
    const { rows: sk } = await c.query("SELECT count(*)::int n FROM app.import_rows WHERE batch_id = $1 AND decision = 'skipped'", [batchId]);
    result.skipped = sk[0].n;
    await c.query(
      "UPDATE app.import_batches SET status = 'applied', applied_by = $2, applied_at = now(), stats = stats || $3::jsonb WHERE id = $1",
      [batchId, staff.id, JSON.stringify({ applied: result })],
    );
    await audit(c, staff.id, "import.apply", "import", batchId, result);
    return result;
  });
}

export async function listBatches() {
  const { rows } = await getPool().query(
    `SELECT b.id, b.kind, b.title, b.status, b.created_at, b.applied_at, b.stats, st.name AS created_by_name,
            (SELECT count(*)::int FROM app.import_rows r WHERE r.batch_id = b.id) AS row_count,
            (SELECT count(*)::int FROM app.import_rows r WHERE r.batch_id = b.id AND r.decision = 'pending') AS pending
     FROM app.import_batches b JOIN app.staff st ON st.id = b.created_by
     ORDER BY b.created_at DESC LIMIT 100`,
  );
  return rows;
}

export async function batchDetail(id: string) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT b.*, d.original_name AS document_name, d.public AS document_public
     FROM app.import_batches b LEFT JOIN app.documents d ON d.id = b.document_id WHERE b.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: items } = await pool.query(
    `SELECT r.id, r.row_num, r.raw, r.input_parcel_id, r.input_address, r.event_date::text, r.event_substatus, r.note,
            r.match_parcel_id, r.match_method, r.match_score, r.candidates, r.decision, r.apply_result,
            f.situs_address AS match_address, f.owner_name AS match_owner, f.in_city AS match_in_city
     FROM app.import_rows r LEFT JOIN app.parcel_facts f ON f.county = r.match_county AND f.parcel_id = r.match_parcel_id
     WHERE r.batch_id = $1 ORDER BY (r.decision = 'pending') DESC, r.row_num`,
    [id],
  );
  return { ...rows[0], rows: items };
}
