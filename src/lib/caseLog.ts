/**
 * Code Enforcement case logs: the City's spreadsheet of code-enforcement cases (from a public
 * records request), one row per case. Columns as exported in 2026:
 *
 *   Record # | Date Submitted | Address | Record Status | Case Category | Mbl | Council RESOLUTION: Property Adjudicated A Menace
 *
 * "Mbl" (map-block-lot) is the Hinds parcel ID. Columns are found by name, so a re-export with the
 * columns in another order still reads. Nothing here touches the database.
 */
import { normalizeCaseNo } from "./agendaPdf";
import { parseLooseDate } from "./imports";

export interface CaseLogRow {
  line: number; // spreadsheet row number (header is row 1)
  record: string; // as printed: "CE-26-3043"
  caseNo: string | null; // normalized: "26-3043"
  opened: string | null; // ISO date the case was opened
  address: string | null;
  parcelId: string | null;
  category: string | null;
  status: string | null;
  adjudicated: string | null; // ISO date of the council resolution declaring the property a menace
}

/**
 * Categories about the property itself (an unsafe or open structure, trash, a run-down building).
 * Grass & Weeds and Vehicle cases are routine and would swamp the map, so they only teach the app
 * their case numbers (council resolutions cite cases by number) and never change a parcel's status.
 */
export const CASE_ONLY_CATEGORIES = ["Grass & Weeds", "Vehicle"];
const isCaseOnly = (c: string | null) => CASE_ONLY_CATEGORIES.some((x) => x.toLowerCase() === (c ?? "").trim().toLowerCase());

const COLUMNS: Record<Exclude<keyof CaseLogRow, "line" | "caseNo">, RegExp> = {
  record: /^(record|case)\s*(#|no\.?|num|number)?$/i,
  opened: /date\s*(submitted|opened|created)|^opened/i,
  address: /^(address|location|property address)$/i,
  parcelId: /^(mbl|parcel|parcel\s*(id|#|no\.?|number))$/i,
  category: /category|case\s*type/i,
  status: /status/i,
  adjudicated: /adjudicat|menace/i,
};

const text = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v)).trim();

/** Spreadsheet cells arrive as Date objects (no time zone: read as UTC) or text. */
export function cellDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return parseLooseDate(text(v));
}

/** "918 N FARISH ST, Unit AB, Jackson, MS 39202" -> "918 N FARISH ST"; "0 N FARISH ST, ..." (no street number) -> null. */
export function caseLogAddress(v: unknown): string | null {
  const s = text(v).split(",")[0].replace(/\s+/g, " ").trim();
  if (!s || /^0+\s/.test(s)) return null;
  return s;
}

/** Reads the first sheet's rows (header row first). Throws if a needed column is missing. */
export function readCaseLog(table: unknown[][]): { rows: CaseLogRow[]; problems: string[] } {
  const headerAt = table.findIndex((r) => r.some((c) => COLUMNS.record.test(text(c))));
  if (headerAt < 0) throw new Error('Couldn\'t find the header row (a column named "Record #" or "Case #").');
  const header = table[headerAt].map(text);
  const col = {} as Record<keyof typeof COLUMNS, number>;
  for (const [k, re] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, RegExp][]) col[k] = header.findIndex((h) => re.test(h));
  const missing = (["record", "opened", "address", "parcelId", "category"] as const).filter((k) => col[k] < 0);
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(", ")}. Headers found: ${header.join(" | ")}`);

  const rows: CaseLogRow[] = [];
  const problems: string[] = [];
  table.slice(headerAt + 1).forEach((r, i) => {
    const line = headerAt + i + 2;
    const get = (k: keyof typeof COLUMNS) => (col[k] >= 0 ? r[col[k]] : null);
    const record = text(get("record"));
    if (!record) return;
    const row: CaseLogRow = {
      line, record, caseNo: normalizeCaseNo(record),
      opened: cellDate(get("opened")),
      address: caseLogAddress(get("address")),
      parcelId: text(get("parcelId")) || null,
      category: text(get("category")) || null,
      status: text(get("status")) || null,
      adjudicated: col.adjudicated >= 0 ? cellDate(get("adjudicated")) : null,
    };
    if (!row.caseNo) problems.push(`row ${line}: "${record}" isn't a case number`);
    if (!row.opened) problems.push(`row ${line}: no date the case was opened`);
    if (col.adjudicated >= 0 && text(get("adjudicated")) && !row.adjudicated) problems.push(`row ${line}: unreadable adjudication date "${text(get("adjudicated"))}"`);
    rows.push(row);
  });
  return { rows, problems };
}

/**
 * The City's Blight Action page (jacksonms.gov/.../blightaction/) builds its dashboard from data
 * embedded in the page as `window.JR_DATA`: open code-enforcement cases (`records`, layer "Active
 * Case"), demolition cases (`demolitions`), and Fire Department burned-structure reports (layer
 * "Burned Structure", no case number or parcel; left out here). Returns the cases as a table in the
 * case log's own column names, for readCaseLog. Checked 2026-11-24: its `date` is the date the case
 * was opened (matches the case log on 4,071 of 4,077 shared cases).
 */
export function cityPageTable(html: string): unknown[][] {
  const at = html.indexOf("window.JR_DATA");
  if (at < 0) throw new Error("This page doesn't contain the City's blight data (window.JR_DATA).");
  const start = html.indexOf("{", at);
  const data = parseJsonPrefix(html.slice(start)) as { records?: Record<string, unknown>[]; demolitions?: Record<string, unknown>[] };
  const cases = [...(data.records ?? []), ...(data.demolitions ?? [])].filter((r) => r.layer !== "Burned Structure");
  return [
    ["Record #", "Date Submitted", "Address", "Record Status", "Case Category", "Mbl"],
    ...cases.map((r) => [r.id, r.date, r.address, r.status, r.type, r.parcel]),
  ];
}

/** JSON.parse of the object at the start of `s`, ignoring whatever follows it (the rest of the script). */
function parseJsonPrefix(s: string): unknown {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(0, i + 1));
    }
  }
  throw new Error("The City's blight data is cut off.");
}

export interface CaseLogEntry {
  caseNo: string;
  date: string;
  substatus: string;
  parcelId?: string | null;
  address?: string | null;
  note?: string | null;
  skip?: string | null;
}

/**
 * Three review batches from one log:
 *   cases          property cases, each "Cited" on the day it was opened
 *   caseNumbers    Grass & Weeds and Vehicle cases, pre-skipped: recording them only links case numbers to parcels
 *   adjudications  every case with a council resolution date, "Adjudicated by council" on that date
 * Rows without a case number or a date are left out (reported as problems by readCaseLog).
 */
export function planCaseLog(rows: CaseLogRow[]) {
  const usable = rows.filter((r) => r.caseNo && r.opened);
  const base = (r: CaseLogRow) => ({ caseNo: r.caseNo!, parcelId: r.parcelId, address: r.address });
  const what = (r: CaseLogRow) => [r.record, r.category].filter(Boolean).join(", ");
  const status = (r: CaseLogRow) => (r.status && !/^active$/i.test(r.status) ? `case ${r.status.toLowerCase()}` : null);
  const cases: CaseLogEntry[] = [];
  const caseNumbers: CaseLogEntry[] = [];
  for (const r of usable) {
    const note = [what(r), status(r)].filter(Boolean).join("; ");
    if (isCaseOnly(r.category)) {
      caseNumbers.push({ ...base(r), date: r.opened!, substatus: "cited", note, skip: `${r.category} case: links the case number only` });
    } else {
      cases.push({ ...base(r), date: r.opened!, substatus: "cited", note });
    }
  }
  const adjudications: CaseLogEntry[] = usable
    .filter((r) => r.adjudicated)
    .map((r) => ({ ...base(r), date: r.adjudicated!, substatus: "adjudicated", note: `${what(r)}; council resolution declaring the property a menace` }));
  return { cases, caseNumbers, adjudications };
}
