/**
 * Read a City Council agenda (or minutes) PDF: split it into numbered items, find the ones about
 * blighted property, and pull out what they reference: code-enforcement case numbers, parcel
 * numbers and street addresses. Nothing here touches the database; the admin reviews the result
 * and it becomes an ordinary council-agenda import batch.
 *
 * Built against the City of Jackson's agenda layout (2026): item numbers ("3.") sit in a left
 * column, item text is indented, section headings ("CONSENT AGENDA") sit at the item-number margin.
 */

export interface PdfLine {
  page: number;
  x: number;
  text: string;
}

export type RefKind = "case" | "parcel" | "address";
export interface AgendaRef {
  kind: RefKind;
  value: string;
}

/** One property an item names: any of case number, parcel number and address that identify it. */
export interface AgendaTarget {
  caseNo: string | null;
  parcelId: string | null;
  address: string | null;
}

export interface AgendaItem {
  number: string | null; // "3"; null when the document has no numbered items
  section: string | null; // "CONSENT AGENDA"
  text: string;
  relevant: boolean; // about blighted / nuisance property
  substatus: string | null; // suggested action
  targets: AgendaTarget[];
}

export interface ReadAgenda {
  meetingDate: string | null; // YYYY-MM-DD
  title: string | null;
  items: AgendaItem[];
}

// ---------------------------------------------------------------------------------------
// PDF -> lines
// ---------------------------------------------------------------------------------------

const MAX_PAGES = 150;

/** Text lines in reading order, with the x position of each line's first word. */
export async function pdfLines(buf: Uint8Array): Promise<PdfLine[]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(buf);
  if (pdf.numPages > MAX_PAGES) throw new Error(`That PDF has ${pdf.numPages} pages; agendas over ${MAX_PAGES} pages aren't supported.`);
  const out: PdfLine[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
    for (const it of tc.items as { str?: string; transform?: number[] }[]) {
      if (!it.str || !it.str.trim() || !it.transform) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= 2.5);
      if (!row) rows.push((row = { y, parts: [] }));
      row.parts.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      const text = r.parts.map((q) => q.s.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (text) out.push({ page: p, x: r.parts[0].x, text });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Lines -> items (pure; tested)
// ---------------------------------------------------------------------------------------

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

/** "November 17, 2026" -> "2026-11-17". */
export function parseMeetingDate(s: string): string | null {
  const m = s.toUpperCase().match(new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`));
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1]) + 1;
  const d = new Date(Date.UTC(Number(m[3]), mo - 1, Number(m[2])));
  if (d.getUTCMonth() !== mo - 1) return null;
  return d.toISOString().slice(0, 10);
}

const ITEM_NO = /^(\d{1,3})\.$/;

export function splitAgenda(lines: PdfLine[]): ReadAgenda {
  const head = lines.slice(0, 15);
  let meetingDate: string | null = null;
  for (const l of head) if (!meetingDate) meetingDate = parseMeetingDate(l.text);
  const meetingLine = head.find((l) => /MEETING OF THE (JACKSON )?CITY COUNCIL/i.test(l.text));
  const title = meetingLine ? sentenceCase(meetingLine.text) : null;

  const firstToken = (t: string) => t.split(" ")[0];
  const numbered = lines.filter((l) => ITEM_NO.test(firstToken(l.text)));
  if (!numbered.length) {
    const text = lines.map((l) => l.text).join(" ");
    return { meetingDate, title, items: [describe({ number: null, section: null, text })] };
  }
  const margin = Math.min(...numbered.map((l) => l.x));
  const atMargin = (l: PdfLine) => l.x <= margin + 6;

  const items: AgendaItem[] = [];
  let section: string | null = null;
  let cur: { number: string; section: string | null; parts: string[] } | null = null;
  const close = () => {
    if (cur) items.push(describe({ number: cur.number, section: cur.section, text: cur.parts.join(" ") }));
    cur = null;
  };
  for (const l of lines) {
    const tok = firstToken(l.text);
    const n = tok.match(ITEM_NO);
    if (n && atMargin(l)) {
      close();
      cur = { number: n[1], section, parts: [l.text.slice(tok.length).trim()] };
    } else if (atMargin(l) && l.text === l.text.toUpperCase() && /[A-Z]/.test(l.text)) {
      close(); // section heading
      section = l.text;
    } else if (cur) {
      cur.parts.push(l.text);
    }
  }
  close();
  return { meetingDate, title, items };
}

function sentenceCase(s: string) {
  const lower = s.toLowerCase().replace(/\s+/g, " ").trim();
  return lower.charAt(0).toUpperCase() + lower.slice(1).replace(/\bcity council\b/, "City Council").replace(/\bjackson\b/, "Jackson");
}

// ---------------------------------------------------------------------------------------
// What an item is about, and what it references (pure; tested)
// ---------------------------------------------------------------------------------------

/** Dashes of every kind (en/em/minus/doubled) become one hyphen. */
const dashes = (s: string) => s.replace(/[‐-―−]/g, "-").replace(/-{2,}/g, "-");

/** "CE-24-1899", "24-01899", "26--1984" -> "24-1899", "24-1899", "26-1984". */
export function normalizeCaseNo(v: string | null | undefined): string | null {
  const m = dashes(String(v ?? "").toUpperCase()).replace(/\s+/g, "").match(/^(?:CE-?)?(\d{2})-(\d{1,6})$/);
  return m ? `${m[1]}-${Number(m[2])}` : null;
}

/** Suggested action for an item, or null when it isn't about nuisance property. */
export function suggestAction(text: string): string | null {
  const t = text.toUpperCase();
  const nuisance = /MENACE|21-19-11|BLIGHT|DILAPIDAT|UNSAFE STRUCTURE|NUISANCE/.test(t);
  if (/DEMOLI(SH|TION)/.test(t) && (nuisance || /STRUCTURE|PROPERTY|PARCEL/.test(t))) return "demolition_ordered";
  if (/BOARD(ED)? UP|CUT GRASS|REMOVE TRASH|DEBRIS|CLEAN(ING)? (UP|OF)|LOT CLEAN|MOW/.test(t) && (nuisance || /PRIVATE PROPERTY/.test(t))) {
    return "lot_cleanup_ordered";
  }
  if (/\bLIENS?\b/.test(t) && (nuisance || /CLEAN|DEMOLI|PROPERTY/.test(t))) return "lien_filed";
  if (nuisance && /DECLAR|ADJUDICAT/.test(t)) return "adjudicated";
  if (nuisance && /HEARING/.test(t) && /SET|SCHEDUL|NOTICE/.test(t)) return "hearing_set";
  if (nuisance) return "adjudicated";
  return null;
}

/** Case numbers, parcel numbers and addresses an item names. */
export function findRefs(text: string): AgendaRef[] {
  const t = dashes(text.toUpperCase()).replace(/\s+/g, " ");
  const refs: AgendaRef[] = [];
  const seen = new Set<string>();
  const add = (kind: RefKind, value: string | null) => {
    if (!value) return;
    const k = `${kind}:${value}`;
    if (!seen.has(k)) {
      seen.add(k);
      refs.push({ kind, value });
    }
  };

  // Parcel numbers: "PARCEL #110-12", "PARCEL NO. 414-45", "PARCELS 12-3, 12-4". Remember their spans
  // so the case-number list doesn't also claim them.
  const parcelSpans: [number, number][] = [];
  for (const m of t.matchAll(/PARCELS?\s*(?:#|NO\.?|NUMBERS?|NOS\.?)?\s*:?\s*((?:#?\s*\d{1,5}(?:-[0-9A-Z]{1,5}){1,3}(?:\s*(?:,|AND|&)\s*)?)+)/g)) {
    for (const p of m[1].matchAll(/\d{1,5}(?:-[0-9A-Z]{1,5}){1,3}/g)) {
      add("parcel", p[0]);
      const start = m.index! + m[0].indexOf(m[1]) + p.index!;
      parcelSpans.push([start, start + p[0].length]);
    }
  }
  const inParcel = (i: number) => parcelSpans.some(([a, b]) => i >= a && i < b);

  // Case numbers: "CASE #CE-24-1899", and every number in a "FOLLOWING CASES:" list.
  for (const m of t.matchAll(/CASE\s*(?:#|NO\.?|NUMBER)?\s*:?\s*((?:CE-?)?\d{2}-\d{1,6})/g)) add("case", normalizeCaseNo(m[1]));
  const list = t.search(/\bCASES?\s*(?:NOS?\.?|NUMBERS?)?\s*:/);
  if (list >= 0) {
    const tail = t.slice(list);
    for (const m of tail.matchAll(/(?<![\d-])(?:CE-?)?(\d{2})-(\d{1,6})(?![\d-])/g)) {
      if (!inParcel(list + m.index!)) add("case", `${m[1]}-${Number(m[2])}`);
    }
  }

  // Addresses: "LOCATED AT 600 W CAPITOL ST - PARCEL ...", "AT 2615 QUEENSROAD AVENUE".
  for (const m of t.matchAll(/(?:LOCATED AT|PROPERTY AT|ADDRESS(?: OF)?:?)\s+(\d{1,6}\s+[A-Z0-9 .'’]+?)(?=\s*(?:-|,|;|\(|\$|PARCEL|CASE|WARD|$))/g)) {
    add("address", m[1].replace(/\s+/g, " ").replace(/\.$/, "").trim());
  }
  return refs;
}

/**
 * Group an item's references into properties. An item naming at most one case, one parcel and one
 * address ("CASE #CE-24-1899 LOCATED AT 600 W CAPITOL ST - PARCEL #110-12") is one property; a list
 * ("FOLLOWING CASES: 25-2751 25-1977 ...") is one property per reference.
 */
export function groupTargets(refs: AgendaRef[]): AgendaTarget[] {
  const of = (k: RefKind) => refs.filter((r) => r.kind === k).map((r) => r.value);
  const [cases, parcels, addresses] = [of("case"), of("parcel"), of("address")];
  if (!refs.length) return [];
  if (cases.length <= 1 && parcels.length <= 1 && addresses.length <= 1) {
    return [{ caseNo: cases[0] ?? null, parcelId: parcels[0] ?? null, address: addresses[0] ?? null }];
  }
  return refs.map((r) => ({
    caseNo: r.kind === "case" ? r.value : null,
    parcelId: r.kind === "parcel" ? r.value : null,
    address: r.kind === "address" ? r.value : null,
  }));
}

function describe(input: { number: string | null; section: string | null; text: string }): AgendaItem {
  const text = input.text.replace(/\s+/g, " ").trim();
  const substatus = suggestAction(text);
  const relevant = substatus !== null;
  return { ...input, text, relevant, substatus, targets: relevant ? groupTargets(findRefs(text)) : [] };
}

/** Whole pipeline. Throws a readable error for scanned PDFs with no text layer. */
export async function readAgendaPdf(buf: Uint8Array): Promise<ReadAgenda> {
  const lines = await pdfLines(buf);
  if (lines.length < 5) {
    throw new Error("This PDF has no readable text (it may be a scan). Paste the addresses or parcel numbers instead.");
  }
  return splitAgenda(lines);
}
