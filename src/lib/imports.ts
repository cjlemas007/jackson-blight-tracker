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
import { normalizeCaseNo } from "./agendaPdf";
import type { CaseLogEntry } from "./caseLog";

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
  byCase: Map<string, string>; // code-enforcement case "25-2751" -> parcel id
}

async function loadIndex(db: pg.Pool | pg.PoolClient): Promise<ParcelIndex> {
  const { rows } = await db.query<{ parcel_id: string; situs_number: number | null; street_name: string | null; dpin: string | null }>(
    `SELECT f.parcel_id, f.situs_number, f.street_name, g.dpin
     FROM app.parcel_facts f LEFT JOIN data.gis_parcels g USING (county, parcel_id)`,
  );
  const idx: ParcelIndex = { byId: new Set(), byCompact: new Map(), byDpin: new Map(), byAddress: new Map(), byCase: new Map() };
  const push = (m: Map<string, string[]>, k: string, v: string) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  for (const r of rows) {
    idx.byId.add(r.parcel_id);
    push(idx.byCompact, compactParcelId(r.parcel_id), r.parcel_id);
    if (r.dpin) idx.byDpin.set(r.dpin.replace(/\D/g, ""), r.parcel_id);
    if (r.situs_number && r.street_name) push(idx.byAddress, `${r.situs_number}|${r.street_name}`, r.parcel_id);
  }
  const cases = await db.query<{ case_no: string; parcel_id: string }>("SELECT case_no, parcel_id FROM app.code_cases WHERE county = 'Hinds'");
  for (const r of cases.rows) idx.byCase.set(r.case_no, r.parcel_id);
  return idx;
}

export interface MatchResult {
  parcelId: string | null;
  method: "parcel_id" | "dpin" | "address_exact" | "address_fuzzy" | "case_no" | null;
  score: number | null;
  candidates: { parcel_id: string; situs_address: string | null; score?: number }[];
  accepted: boolean;
}

/**
 * Match one row. Exact unique matches are accepted; anything else is left for review. A row whose
 * parcel ID and address find nothing falls back to its code-enforcement case number, when the case
 * is already linked to a parcel.
 */
export async function matchOne(
  db: pg.Pool | pg.PoolClient,
  idx: ParcelIndex,
  input: { parcelId: string | null; address: string | null; caseNo?: string | null },
): Promise<MatchResult> {
  const none: MatchResult = { parcelId: null, method: null, score: null, candidates: [], accepted: false };
  const m = await matchByParcelOrAddress(db, idx, input, none);
  if (m.accepted || m.parcelId || m.candidates.length) return m;
  const caseNo = normalizeCaseNo(input.caseNo);
  const byCase = caseNo ? idx.byCase.get(caseNo) : undefined;
  if (byCase) return { parcelId: byCase, method: "case_no", score: 1, candidates: [], accepted: true };
  return m;
}

async function matchByParcelOrAddress(
  db: pg.Pool | pg.PoolClient,
  idx: ParcelIndex,
  input: { parcelId: string | null; address: string | null },
  none: MatchResult,
): Promise<MatchResult> {
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
  const { rows: kb } = await c.query<{ kind: ImportKind }>("SELECT kind FROM app.import_batches WHERE id = $1", [batchId]);
  await c.query("SELECT set_limit(0.45)"); // trigram threshold for %
  const { rows } = await c.query<{ id: number; input_parcel_id: string | null; input_address: string | null; input_case_no: string | null }>(
    "SELECT id, input_parcel_id, input_address, input_case_no FROM app.import_rows WHERE batch_id = $1 ORDER BY row_num",
    [batchId],
  );
  const counts = { accepted: 0, review: 0, unmatched: 0, waiting: 0 };
  for (const r of rows) {
    const m = await matchOne(c, idx, { parcelId: r.input_parcel_id, address: r.input_address, caseNo: r.input_case_no });
    // A council row with nothing to go on but a case number we haven't linked yet waits for a case
    // log instead of blocking the batch. (In a case log itself it needs a decision like any other row.)
    const waiting = kb[0]?.kind === "council_agenda" && !m.accepted && !m.parcelId && !m.candidates.length && !!r.input_case_no;
    await c.query(
      `UPDATE app.import_rows SET match_county = CASE WHEN $2::text IS NULL THEN NULL ELSE 'Hinds' END, match_parcel_id = $2,
         match_method = $3, match_score = $4, candidates = $5, decision = $6
       WHERE id = $1`,
      [r.id, m.parcelId, m.method, m.score, JSON.stringify(m.candidates), m.accepted ? "accepted" : waiting ? "waiting_case" : "pending"],
    );
    if (m.accepted) counts.accepted++;
    else if (waiting) counts.waiting++;
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
  caseNo?: string | null;
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
    for (const col of [m.parcelId, m.address, m.caseNo, m.date, m.note]) {
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
         event_date = NULL, input_case_no = NULL
       WHERE batch_id = $1`,
      [batchId, m.parcelId ?? null, m.address ?? null, m.note ?? null],
    );
    if (m.caseNo) {
      const { rows } = await c.query<{ id: number; v: string }>("SELECT id, raw ->> $2 AS v FROM app.import_rows WHERE batch_id = $1", [batchId, m.caseNo]);
      for (const r of rows) {
        const cn = normalizeCaseNo(r.v);
        if (cn) await c.query("UPDATE app.import_rows SET input_case_no = $2 WHERE id = $1", [r.id, cn]);
      }
    }
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

/** One property from an agenda read out of a PDF (see agendaPdf.ts). */
export interface AgendaEntry {
  item?: string | null; // "3" (agenda item 3) or "Order 16" (minutes)
  substatus: string;
  parcelId?: string | null;
  address?: string | null;
  caseNo?: string | null;
  /** Arrives skipped, with this reason in its note (e.g. "Not adopted", "Hearing officer dismissed it"). */
  skip?: string | null;
  /** Extra context for the note (e.g. "vote not printed: check the minutes"). */
  note?: string | null;
}

/**
 * Council agenda quick entry. Either `lines` (one address or parcel ID per line, all with the same
 * action) or `entries` read from the agenda PDF (each with its own action and any of parcel ID,
 * address and code-enforcement case number).
 */
export async function createAgendaBatch(
  staff: Staff,
  input: { title: string; meetingDate: string; substatus?: string; lines?: string; entries?: AgendaEntry[]; documentId?: string | null },
): Promise<string> {
  requireAdmin(staff);
  const date = parseLooseDate(input.meetingDate);
  if (!date) throw new WorkflowError("Enter the meeting date.");

  type Raw = {
    row_num: number; raw: Record<string, string>; parcel: string | null; address: string | null; case_no: string | null; item: string | null;
    sub: string | null; skip: string | null; extra: string | null;
  };
  let raws: Raw[];
  let batchSub: string;
  if (input.entries) {
    const entries = input.entries.filter((e) => e.parcelId?.trim() || e.address?.trim() || e.caseNo?.trim());
    if (!entries.length) throw new WorkflowError("Pick at least one property to record.");
    if (entries.length > MAX_ROWS) throw new WorkflowError(`Up to ${MAX_ROWS} properties at a time.`);
    for (const e of entries) if (!statusOf(e.substatus)) throw new WorkflowError("Pick what the council did for every item.");
    raws = entries.map((e, i) => {
      const caseNo = e.caseNo ? normalizeCaseNo(e.caseNo) : null;
      if (e.caseNo && !caseNo) throw new WorkflowError(`"${e.caseNo}" doesn't look like a case number (like 25-2751).`);
      const raw: Record<string, string> = {};
      if (e.item) raw.item = String(e.item);
      if (caseNo) raw.case = caseNo;
      if (e.parcelId) raw.parcel = e.parcelId.trim();
      if (e.address) raw.address = e.address.trim();
      return {
        row_num: i + 1, raw, parcel: e.parcelId?.trim() || null, address: e.address?.trim() || null, case_no: caseNo,
        item: e.item ? String(e.item).slice(0, 20) : null, sub: e.substatus,
        skip: e.skip ? String(e.skip).slice(0, 200) : null, extra: e.note ? String(e.note).slice(0, 200) : null,
      };
    });
    // The batch's own action is the most common one; rows that differ carry their own.
    const tally = new Map<string, number>();
    for (const r of raws) tally.set(r.sub!, (tally.get(r.sub!) ?? 0) + 1);
    batchSub = [...tally].sort((a, b) => b[1] - a[1])[0][0];
    for (const r of raws) if (r.sub === batchSub) r.sub = null;
  } else {
    if (!input.substatus || !statusOf(input.substatus)) throw new WorkflowError("Pick what the council did.");
    batchSub = input.substatus;
    const lines = (input.lines ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new WorkflowError("Paste at least one address.");
    if (lines.length > MAX_ROWS) throw new WorkflowError(`Up to ${MAX_ROWS} addresses at a time.`);
    raws = lines.map((l, i) => {
      const looksLikeId = /^\d+(-[\dA-Z]+)+$/i.test(l.replace(/\s/g, ""));
      return { row_num: i + 1, raw: { line: l }, parcel: looksLikeId ? l : null, address: looksLikeId ? null : l, case_no: null, item: null, sub: null, skip: null, extra: null };
    });
  }

  const title = input.title.trim() || `Council meeting ${date}`;
  return insertReviewBatch(staff, {
    kind: "council_agenda", source: "council_agenda", title, documentId: input.documentId || null, date, batchSub,
    headers: input.entries ? ["item", "case", "parcel", "address"] : ["line"],
    mapping: input.entries ? { parcelId: "parcel", address: "address", caseNo: "case" } : { address: "line" },
    rows: raws.map((r) => ({
      row_num: r.row_num, raw: r.raw, parcel: r.parcel, address: r.address, case_no: r.case_no, item: r.item, sub: r.sub, date: null, skip: r.skip,
      note: [r.item && /^\d+$/.test(r.item) ? `Item ${r.item}` : r.item, r.case_no && `case ${r.case_no}`, r.extra, r.skip && `skipped: ${r.skip}`]
        .filter(Boolean).join(", ") || null,
    })),
    auditDetail: { fromPdf: !!input.entries },
  });
}

/**
 * A City Code Enforcement case log (see caseLog.ts): one row per case, each with its own date and
 * action. Rows marked `skip` arrive skipped; when the batch is recorded they still link their case
 * number to the parcel the City gave (learnCases), without changing the parcel's status.
 */
export async function createCaseLogBatch(
  staff: Staff,
  input: { title: string; entries: CaseLogEntry[]; documentId?: string | null; logDate?: string | null },
): Promise<string> {
  requireAdmin(staff);
  if (!input.entries.length) throw new WorkflowError("The case log has no cases to import.");
  if (input.entries.length > MAX_ROWS) throw new WorkflowError(`Up to ${MAX_ROWS} cases at a time.`);
  const rows = input.entries.map((e, i) => {
    const caseNo = normalizeCaseNo(e.caseNo);
    if (!caseNo) throw new WorkflowError(`"${e.caseNo}" doesn't look like a case number (like 25-2751).`);
    const date = parseLooseDate(e.date);
    if (!date) throw new WorkflowError(`Case ${e.caseNo} has no valid date.`);
    if (!statusOf(e.substatus)) throw new WorkflowError(`Unknown action for case ${e.caseNo}.`);
    const raw: Record<string, string> = { case: caseNo, date };
    if (e.parcelId) raw.parcel = e.parcelId.trim();
    if (e.address) raw.address = e.address.trim();
    return {
      row_num: i + 1, raw, parcel: e.parcelId?.trim() || null, address: e.address?.trim() || null, case_no: caseNo, item: null,
      sub: e.substatus, date, skip: e.skip ? String(e.skip).slice(0, 200) : null,
      note: [e.note, e.skip && `skipped: ${e.skip}`].filter(Boolean).join("; ").slice(0, 400) || null,
    };
  });
  const tally = new Map<string, number>();
  for (const r of rows) tally.set(r.sub, (tally.get(r.sub) ?? 0) + 1);
  const batchSub = [...tally].sort((a, b) => b[1] - a[1])[0][0];
  return insertReviewBatch(staff, {
    kind: "code_enforcement", source: "city_record", title: input.title.trim() || KIND_DEFAULTS.code_enforcement.label,
    documentId: input.documentId || null, date: null, docDate: input.logDate ?? null, batchSub,
    headers: ["case", "date", "parcel", "address"], mapping: { parcelId: "parcel", address: "address", caseNo: "case", date: "date" },
    rows: rows.map((r) => ({ ...r, sub: r.sub === batchSub ? null : r.sub })),
  });
}

/** Writes a batch that skips column mapping (agenda and case-log entries), matches it, and pre-skips rows. */
async function insertReviewBatch(
  staff: Staff,
  b: {
    kind: ImportKind; source: string; title: string; documentId: string | null; date: string | null; docDate?: string | null; batchSub: string;
    headers: string[]; mapping: Mapping; auditDetail?: Record<string, unknown>;
    rows: {
      row_num: number; raw: Record<string, string>; parcel: string | null; address: string | null; case_no: string | null; item: string | null;
      sub: string | null; date: string | null; skip: string | null; note: string | null;
    }[];
  },
): Promise<string> {
  return tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.import_batches (kind, title, document_id, headers, mapping, default_date, event_status, event_substatus, source, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'review') RETURNING id`,
      [b.kind, b.title, b.documentId, b.headers, b.mapping, b.date, statusOf(b.batchSub), b.batchSub, b.source, staff.id],
    );
    const id = rows[0].id;
    await c.query(
      `INSERT INTO app.import_rows (batch_id, row_num, raw, input_parcel_id, input_address, input_case_no, agenda_item, event_substatus, event_date, note)
       SELECT $1, r.row_num, r.raw, r.parcel, r.address, r.case_no, r.item, r.sub, r.date, r.note
       FROM json_to_recordset($2::json) AS r(row_num int, raw jsonb, parcel text, address text, case_no text, item text, sub text, date date, note text)`,
      [id, JSON.stringify(b.rows)],
    );
    if (b.documentId) {
      await c.query("UPDATE app.documents SET document_date = COALESCE(document_date, $2), title = COALESCE(NULLIF(title, original_name), $3) WHERE id = $1", [
        b.documentId, b.docDate ?? b.date, b.title,
      ]);
    }
    const counts = await matchBatch(c, id);
    // Rows the source itself says not to record (not adopted, dismissed, case-number only) stay visible but skipped.
    const skipRows = b.rows.filter((r) => r.skip).map((r) => r.row_num);
    if (skipRows.length) {
      await c.query("UPDATE app.import_rows SET decision = 'skipped' WHERE batch_id = $1 AND row_num = ANY($2)", [id, skipRows]);
    }
    await c.query("UPDATE app.import_batches SET stats = $2 WHERE id = $1", [id, JSON.stringify({ ...counts, preSkipped: skipRows.length })]);
    await audit(c, staff.id, "import.create", "import", id, { kind: b.kind, rows: b.rows.length, ...b.auditDetail });
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
  input: { parcelId?: string | null; decision: "accepted" | "skipped" | "pending" | "waiting_case"; substatus?: string | null; date?: string | null },
) {
  requireAdmin(staff);
  if (!["accepted", "skipped", "pending", "waiting_case"].includes(input.decision)) throw new WorkflowError("Unknown decision.");
  await tx(async (c) => {
    const { rows } = await c.query<{ batch_id: string; match_parcel_id: string | null; input_case_no: string | null }>(
      "SELECT batch_id, match_parcel_id, input_case_no FROM app.import_rows WHERE id = $1",
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
    if (input.decision === "waiting_case" && !rows[0].input_case_no) throw new WorkflowError("Only rows with a case number can wait for a case log.");
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
    const undated = rows.find((r) => !(r.event_date ?? b.default_date));
    if (undated) throw new WorkflowError(`Row ${undated.row_num} has no date.`);
    if (b.kind !== "sos_forfeited") Object.assign(result, await applyEvents(c, b, staff));
    for (const r of b.kind === "sos_forfeited" ? rows : []) {
      const ins = await c.query(
        `INSERT INTO app.state_inventory (county, parcel_id, list_date, batch_id, raw) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [r.match_county, r.match_parcel_id, r.event_date ?? b.default_date, batchId, r.raw],
      );
      await c.query("UPDATE app.import_rows SET apply_result = $2 WHERE id = $1", [r.id, ins.rowCount ? "listed" : "duplicate"]);
      ins.rowCount ? result.listed++ : result.duplicates++;
    }
    const { rows: sk } = await c.query(
      "SELECT count(*) FILTER (WHERE decision = 'skipped')::int skipped, count(*) FILTER (WHERE decision = 'waiting_case')::int waiting FROM app.import_rows WHERE batch_id = $1",
      [batchId],
    );
    const applied = { ...result, skipped: sk[0].skipped, waiting: sk[0].waiting };
    await c.query(
      "UPDATE app.import_batches SET status = 'applied', applied_by = $2, applied_at = now(), stats = stats || $3::jsonb WHERE id = $1",
      [batchId, staff.id, JSON.stringify({ applied })],
    );
    const learned = await learnCases(c, batchId);
    const followUps = await resolveWaitingCases(c, staff);
    await audit(c, staff.id, "import.apply", "import", batchId, { ...applied, learnedCases: learned, followUps: followUps.length });
    return { ...applied, learnedCases: learned, followUps };
  });
}

/**
 * One statement for the whole batch (a case log has thousands of rows; a row-by-row loop would
 * outlast the web request). Rows matching a live event with the same status, sub-status and date,
 * or an earlier row in the same batch, are marked duplicates pointing at that event.
 */
async function applyEvents(c: pg.PoolClient, b: Awaited<ReturnType<typeof lockBatch>>, staff: Staff) {
  const { rows } = await c.query<{ apply_result: string }>(
    `WITH r AS (
       SELECT i.id, i.row_num, i.match_county AS county, i.match_parcel_id AS parcel_id, i.note,
              COALESCE(i.event_substatus, $2::text) AS sub, COALESCE(i.event_date, $3::date) AS d, a.status::app.parcel_status AS status
       FROM app.import_rows i JOIN json_to_recordset($4::json) AS a(status text, substatus text) ON a.substatus = COALESCE(i.event_substatus, $2::text)
       WHERE i.batch_id = $1 AND i.decision = 'accepted'
     ), k AS (
       SELECT r.*, (SELECT e.id FROM app.status_events_live e
                    WHERE e.county = r.county AND e.parcel_id = r.parcel_id AND e.status = r.status AND e.substatus = r.sub AND e.effective_date = r.d
                    ORDER BY e.id LIMIT 1) AS existing
       FROM r
     ), firsts AS (
       SELECT DISTINCT ON (county, parcel_id, sub, d) * FROM k WHERE existing IS NULL ORDER BY county, parcel_id, sub, d, row_num
     ), ins AS (
       INSERT INTO app.status_events (county, parcel_id, status, substatus, effective_date, source, document_id, note, recorded_by)
       SELECT county, parcel_id, status, sub, d, $5::app.event_source, $6::uuid, left(concat_ws(': ', $7::text || ', row ' || row_num, note), 500), $8
       FROM firsts ORDER BY row_num
       RETURNING id, county, parcel_id, substatus, effective_date
     )
     UPDATE app.import_rows u
     SET apply_result = CASE WHEN f.id IS NULL THEN 'duplicate' ELSE 'event' END, applied_event_id = COALESCE(k.existing, ins.id)
     FROM k LEFT JOIN firsts f ON f.id = k.id
            LEFT JOIN ins ON ins.county = k.county AND ins.parcel_id = k.parcel_id AND ins.substatus = k.sub AND ins.effective_date = k.d
     WHERE u.id = k.id
     RETURNING u.apply_result`,
    [b.id, b.event_substatus, b.default_date, JSON.stringify(ACTIONS), b.source, b.document_id, b.title, staff.id],
  );
  const { rows: all } = await c.query<{ n: number }>("SELECT count(*)::int n FROM app.import_rows WHERE batch_id = $1 AND decision = 'accepted'", [b.id]);
  if (all[0].n !== rows.length) throw new WorkflowError("Some rows have an unknown action; fix them and record again.");
  return { events: rows.filter((r) => r.apply_result === "event").length, duplicates: rows.filter((r) => r.apply_result === "duplicate").length };
}

// ---------------------------------------------------------------------------------------
// Code-enforcement case numbers
// ---------------------------------------------------------------------------------------

/**
 * Every recorded row that has both a case number and a parcel links that case to the parcel (a
 * newer link replaces an older one). In a code-enforcement case log, skipped rows count too when the
 * City's own parcel ID matched: skipping there means "don't change the status", not "wrong parcel".
 * Returns how many links were added or changed.
 */
async function learnCases(c: pg.PoolClient, batchId: string): Promise<number> {
  const r = await c.query(
    `INSERT INTO app.code_cases (case_no, county, parcel_id, address, source_batch_id)
     SELECT DISTINCT ON (r.input_case_no) r.input_case_no, r.match_county, r.match_parcel_id, r.input_address, r.batch_id
     FROM app.import_rows r JOIN app.import_batches b ON b.id = r.batch_id
     WHERE r.batch_id = $1 AND r.input_case_no IS NOT NULL AND r.match_parcel_id IS NOT NULL
       AND (r.decision = 'accepted' OR (r.decision = 'skipped' AND b.kind = 'code_enforcement' AND r.match_method = 'parcel_id'))
     ORDER BY r.input_case_no, r.row_num DESC
     ON CONFLICT (case_no) DO UPDATE SET parcel_id = EXCLUDED.parcel_id, county = EXCLUDED.county,
       address = COALESCE(EXCLUDED.address, app.code_cases.address), source_batch_id = EXCLUDED.source_batch_id, updated_at = now()
     WHERE (app.code_cases.county, app.code_cases.parcel_id) IS DISTINCT FROM (EXCLUDED.county, EXCLUDED.parcel_id)`,
    [batchId],
  );
  return r.rowCount ?? 0;
}

/**
 * Rows waiting on a case number that is now linked to a parcel. In a batch still under review the
 * row is matched in place; for an already-recorded batch the rows move to a new follow-up batch
 * (same meeting, date, action and document) that an admin reviews and records like any other.
 * Returns the follow-up batch ids.
 */
export async function resolveWaitingCases(c: pg.PoolClient, staff: Staff): Promise<string[]> {
  const { rows } = await c.query<{ id: number; batch_id: string; batch_status: string; county: string; parcel_id: string }>(
    `SELECT r.id, r.batch_id, b.status AS batch_status, cc.county, cc.parcel_id
     FROM app.import_rows r
     JOIN app.import_batches b ON b.id = r.batch_id
     JOIN app.code_cases cc ON cc.case_no = r.input_case_no
     WHERE r.decision = 'waiting_case' AND r.apply_result IS NULL AND b.status IN ('review', 'applied')
     ORDER BY r.batch_id, r.row_num`,
  );
  const followUps: string[] = [];
  const byBatch = new Map<string, typeof rows>();
  for (const r of rows) (byBatch.get(r.batch_id) ?? byBatch.set(r.batch_id, []).get(r.batch_id)!).push(r);
  for (const [batchId, items] of byBatch) {
    if (items[0].batch_status === "review") {
      for (const r of items) {
        await c.query(
          `UPDATE app.import_rows SET match_county = $2, match_parcel_id = $3, match_method = 'case_no', match_score = 1, decision = 'accepted'
           WHERE id = $1`,
          [r.id, r.county, r.parcel_id],
        );
      }
      continue;
    }
    const { rows: nb } = await c.query<{ id: string }>(
      `INSERT INTO app.import_batches (kind, title, document_id, headers, mapping, default_date, event_status, event_substatus, source, created_by, status, stats)
       SELECT kind, left(title || ' (cases matched later)', 300), document_id, headers, mapping, default_date, event_status, event_substatus, source, $2, 'review',
              jsonb_build_object('followUpOf', id)
       FROM app.import_batches WHERE id = $1 RETURNING id`,
      [batchId, staff.id],
    );
    const newId = nb[0].id;
    await c.query(
      `INSERT INTO app.import_rows (batch_id, row_num, raw, input_parcel_id, input_address, input_case_no, agenda_item, event_date, event_substatus, note,
                                    match_county, match_parcel_id, match_method, match_score, decision)
       SELECT $1, row_number() OVER (ORDER BY r.row_num), r.raw, r.input_parcel_id, r.input_address, r.input_case_no, r.agenda_item, r.event_date,
              r.event_substatus, r.note, cc.county, cc.parcel_id, 'case_no', 1, 'accepted'
       FROM app.import_rows r JOIN app.code_cases cc ON cc.case_no = r.input_case_no
       WHERE r.id = ANY($2)`,
      [newId, items.map((r) => r.id)],
    );
    await c.query("UPDATE app.import_rows SET apply_result = $2 WHERE id = ANY($1)", [items.map((r) => r.id), `moved:${newId}`]);
    await audit(c, staff.id, "import.case_followup", "import", newId, { from: batchId, rows: items.length });
    followUps.push(newId);
  }
  return followUps;
}

export async function listBatches() {
  const { rows } = await getPool().query(
    `SELECT b.id, b.kind, b.title, b.status, b.created_at, b.applied_at, b.stats, st.name AS created_by_name,
            (SELECT count(*)::int FROM app.import_rows r WHERE r.batch_id = b.id) AS row_count,
            (SELECT count(*)::int FROM app.import_rows r WHERE r.batch_id = b.id AND r.decision = 'pending') AS pending,
            (SELECT count(*)::int FROM app.import_rows r WHERE r.batch_id = b.id AND r.decision = 'waiting_case' AND r.apply_result IS NULL) AS waiting
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
    `SELECT r.id, r.row_num, r.raw, r.input_parcel_id, r.input_address, r.input_case_no, r.agenda_item, r.event_date::text, r.event_substatus, r.note,
            r.match_parcel_id, r.match_method, r.match_score, r.candidates, r.decision, r.apply_result,
            f.situs_address AS match_address, f.owner_name AS match_owner, f.in_city AS match_in_city
     FROM app.import_rows r LEFT JOIN app.parcel_facts f ON f.county = r.match_county AND f.parcel_id = r.match_parcel_id
     WHERE r.batch_id = $1 ORDER BY (r.decision = 'pending') DESC, r.row_num`,
    [id],
  );
  return { ...rows[0], rows: items };
}
