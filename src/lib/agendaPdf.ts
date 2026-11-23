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
  /** Why this property is listed but shouldn't be recorded (e.g. the hearing officer dismissed it). */
  excluded?: string | null;
}

export interface AgendaItem {
  number: string | null; // "3"; null when the document has no numbered items
  section: string | null; // "CONSENT AGENDA"
  text: string;
  relevant: boolean; // about blighted / nuisance property
  substatus: string | null; // suggested action
  targets: AgendaTarget[];
  /** Minutes only: whether the council adopted it (null when the vote couldn't be read). */
  adopted?: boolean | null;
  vote?: string | null;
  /** Minutes only: the PDF pages (1-based) this order spans. */
  pages?: number[];
}

export interface ReadAgenda {
  kind: "agenda" | "minutes";
  meetingDate: string | null; // YYYY-MM-DD
  title: string | null;
  items: AgendaItem[];
}

// ---------------------------------------------------------------------------------------
// PDF -> lines
// ---------------------------------------------------------------------------------------

// Council minutes reprint every adopted order in full; a year's busiest meetings run past 400 pages.
const MAX_PAGES = 600;

/** Text lines in reading order, with the x position of each line's first word. */
export async function pdfLines(buf: Uint8Array, maxPages = MAX_PAGES): Promise<PdfLine[]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(buf);
  if (pdf.numPages > maxPages) throw new Error(`That PDF has ${pdf.numPages} pages; documents over ${maxPages} pages aren't supported.`);
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

/** "November 17, 2026" -> "2026-11-17". Tolerates scanner misreads in the year ("202S", "2O25"). */
export function parseMeetingDate(s: string): string | null {
  const fixed = s.toUpperCase().replace(/\b(2[0O][0-9OSIl]{2})(?=\D|$)/g, (y) => y.replace(/O/g, "0").replace(/S/g, "5").replace(/[Il]/g, "1"));
  const m = fixed.match(new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2}),?\\s+(\\d{4})`));
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
    return { kind: "agenda", meetingDate, title, items: [describe({ number: null, section: null, text })] };
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
  return { kind: "agenda", meetingDate, title, items };
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

// ---------------------------------------------------------------------------------------
// Council minutes (pure; tested)
//
// Jackson's minutes reprint every order in full, separated by rows of asterisks: an all-caps title,
// WHEREAS paragraphs, the resolution, then the vote ("moved adoption ... Yeas- ... Nays- ...").
// Menace declarations include the hearing officer's findings case by case ("1) Case #24-473: Parcel
// #9-210-1 located at 1746 Myrtle St.: ... recommends that the property be adjudicated ...").
// ---------------------------------------------------------------------------------------

const SEPARATOR = (t: string) => (t.match(/\*/g)?.length ?? 0) >= 5 && /^[\s*·.,'`-]*$/.test(t);
const PAGE_FURNITURE = [
  /^(REGULAR|SPECIAL)( ZONING)?( COUNCIL)? MEETING OF THE (JACKSON )?CITY COUNCIL/i,
  /^(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY),?\s+[A-Z]+\s+\d/i,
  /^MINUTE BOOK/i,
  /^\d{1,4}$/,
];
const BODY_START = /^\s*(WHEREAS|BE IT|IT IS|NOW,? (BE IT )?THEREFORE|THEREFORE|(Council ?Member|President|Vice President|Mayor)\b|Yeas|Nays|Absent|.?aid item|Note:|The motion)/i;

/** Minutes: several asterisk separators and the council-meeting page header. */
export function looksLikeMinutes(lines: PdfLine[]): boolean {
  return lines.filter((l) => SEPARATOR(l.text)).length >= 3 && lines.filter((l) => PAGE_FURNITURE[0].test(l.text)).length >= 2;
}

/** Did the council adopt this order? Reads "moved adoption" and the Yeas/Nays lists. */
export function readVote(body: string): { adopted: boolean | null; vote: string | null } {
  const t = body.replace(/\s+/g, " ");
  // Scans misread "Said" ("~aid", "$aid"), so match from "aid item".
  const notAdopted = /motion failed|failed (for|due to) (a )?lack|lack of a majority|motion to table (carried|passed)|aid item was (pulled|tabled|held|withdrawn|deferred|removed|continued)|item was (pulled|tabled|withdrawn|deferred)|was pulled (by|from)|removed from the agenda/i;
  if (notAdopted.test(t)) {
    const why = t.match(/(The motion failed[^.]*\.|.aid item was [^.]*\.|[^.]*lack of a majority[^.]*\.|[^.]*(?:pulled|tabled|withdrawn|deferred|removed from the agenda)[^.]*\.)/i)?.[1];
    return { adopted: false, vote: (why ?? "Not adopted").replace(/^.aid item/, "Said item").trim() };
  }
  const yeas = t.match(/Yeas?\s*[-:–]\s*([^.]*?)\.\s*Nays?/i)?.[1];
  const nays = t.match(/Nays?\s*[-:–]\s*([^.]*?)\./i)?.[1];
  const moved = /moved adoption|moved approval|moved to adopt/i.test(t);
  if (!moved) return { adopted: null, vote: null };
  if (yeas === undefined) return { adopted: null, vote: "moved; the vote isn't printed" };
  const count = (s: string | undefined) => (!s || /^\s*no\w{0,3}[;.]?\s*$/i.test(s) ? 0 : s.split(/,|\band\b/).filter((x) => x.trim()).length);
  const y = count(yeas);
  const n = count(nays);
  return { adopted: y > n, vote: `${y}–${n}` };
}

/** "1) Case #24-473: Parcel #9-210-1 located at 1746 Myrtle St.: ... recommends ... adjudicated ..." */
export function findingsTargets(body: string): AgendaTarget[] {
  const t = dashes(body.replace(/\s+/g, " "));
  const re = /(?:^|\s)\d{1,3}\s*[).]\s*Case\s*(?:#|No\.?)?\s*((?:CE-?)?[0-9O]{2}\s*-\s*\d{1,6})\s*[:;.,]?\s*Parcels?\s*(?:#|No\.?)?\s*([0-9]{1,5}(?:\s*-\s*[0-9A-Z]{1,5}){1,3})\s*,?\s*(?:located\s+)?at\s+(.+?)\s*[:;](?=\s)/gi;
  const hits = [...t.matchAll(re)];
  return hits.map((m, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index! : t.length;
    const finding = t.slice(m.index!, end);
    // Word stems, not whole words: scans misread letters ("adjudicate4d").
    const adjudicated = /\bbe\s+adjudicat/i.test(finding) && !/\bnot\s+be\s+adjudicat/i.test(finding);
    const excluded = adjudicated
      ? null
      : /abeyance/i.test(finding) ? "Held in abeyance"
      : /dismiss/i.test(finding) ? "Hearing officer dismissed it"
      : /not (be )?adjudicated|not a menace/i.test(finding) ? "Not adjudicated"
      : /continu|reset|rescheduled/i.test(finding) ? "Continued to a later hearing"
      : "No adjudication recommended";
    return {
      caseNo: normalizeCaseNo(m[1].replace(/O/g, "0").replace(/\s/g, "")),
      parcelId: m[2].replace(/\s/g, ""),
      address: m[3].replace(/\.$/, "").replace(/\s+/g, " ").trim().toUpperCase(),
      excluded,
    };
  });
}

/** What a minutes order did, judged from its title only (the WHEREAS text cites earlier actions). */
export function minutesAction(title: string): string | null {
  const t = title.toUpperCase();
  if (/RELEASE OF LIEN|RESTRICTION ON TRANSFER/.test(t)) return null; // housing-program liens, not blight
  if (/DECLARING .*MENACE/.test(t)) return "adjudicated";
  if (/ADJUDICATING THE ACTUAL COSTS|IMPOSING A PENALTY AND LIEN|ASSESSING (THE )?(ACTUAL )?COSTS/.test(t)) return "lien_filed";
  const onProperty = /21-19-11|MENACE|PRIVATE PROPERTY|STATE-OWNED PROPERTY|LOCATED AT|PARCEL/.test(t);
  if (/DEMOLISH|DEMOLITION OF/.test(t) && onProperty) return "demolition_ordered";
  if (/BOARD UP|CUT GRASS|REMOVE TRASH/.test(t) && onProperty) return "lot_cleanup_ordered";
  return null;
}

export function splitMinutes(lines: PdfLine[]): ReadAgenda {
  let meetingDate: string | null = null;
  for (const l of lines.slice(0, 40)) if (!meetingDate && PAGE_FURNITURE[1].test(l.text)) meetingDate = parseMeetingDate(l.text);
  const head = lines.find((l) => PAGE_FURNITURE[0].test(l.text));
  const title = head ? sentenceCase(head.text.replace(/\s+\d+$/, "")) : null;

  // Orders are normally fenced by asterisks, but some meetings run one order straight into the next:
  // a new all-caps ORDER/RESOLUTION title after the current block's body has started also splits.
  const blocks: PdfLine[][] = [[]];
  let inBody = false;
  for (const l of lines) {
    const t = l.text.trim();
    if (SEPARATOR(t)) {
      blocks.push([]);
      inBody = false;
    } else if (!PAGE_FURNITURE.some((re) => re.test(t))) {
      if (inBody && /^(ORDER|RESOLUTION|ORDINANCE)\s+[A-Z]/.test(t) && t === t.toUpperCase()) {
        blocks.push([]);
        inBody = false;
      }
      if (BODY_START.test(t)) inBody = true;
      blocks[blocks.length - 1].push(l);
    }
  }
  const items: AgendaItem[] = [];
  blocks.forEach((block, i) => {
    if (!block.length) return;
    const b = block.map((l) => l.text);
    const split = b.findIndex((l) => BODY_START.test(l));
    // Pages worth keeping as the source: the title, any case-by-case findings, and the vote. Contract
    // exhibits (scope of work, insurance forms) can run dozens of scanned pages and are left out.
    const pages = [...new Set(block.filter((l, j) =>
      j < (split < 0 ? block.length : Math.max(split, 1)) || /\d\s*[).]\s*Case\s*#?|moved adoption|^\s*(Yeas|Nays)\b/i.test(l.text),
    ).map((l) => l.page))].sort((x, y) => x - y);
    const head = (split < 0 ? b : b.slice(0, split)).join(" ").replace(/\s+/g, " ").trim();
    const body = (split < 0 ? [] : b.slice(split)).join(" ");
    const substatus = minutesAction(head);
    // The whole order: a scan-garbled "~aid item was pulled" can land in the title lines.
    const { adopted, vote } = readVote(b.join(" "));
    let targets: AgendaTarget[] = [];
    if (substatus === "adjudicated") {
      targets = findingsTargets(body);
      // Cases in the title's list that the findings didn't cover (or whose finding the scan garbled).
      const known = new Set(targets.map((x) => x.caseNo));
      for (const r of findRefs(head)) if (r.kind === "case" && !known.has(r.value)) targets.push({ caseNo: r.value, parcelId: null, address: null });
    } else if (substatus) {
      targets = groupTargets(findRefs(head));
    }
    items.push({
      number: String(i + 1), section: null, text: head.slice(0, 600), relevant: substatus !== null, substatus, targets, adopted, vote, pages,
    });
  });
  return { kind: "minutes", meetingDate, title, items: mergeRepeats(items) };
}

/**
 * Some minutes PDFs contain the same pages twice (scanned twice, read slightly differently each
 * time). A later order with the same action whose properties mostly repeat an earlier one is folded
 * into it, and each property (by case number, else parcel or address) is kept once per action.
 */
function mergeRepeats(items: AgendaItem[]): AgendaItem[] {
  const key = (sub: string, t: AgendaTarget) => `${sub}|${t.caseNo ?? t.parcelId ?? t.address}`;
  const seen = new Map<string, AgendaItem>();
  const out: AgendaItem[] = [];
  for (const it of items) {
    if (!it.relevant || !it.targets.length) {
      out.push(it);
      continue;
    }
    const keys = it.targets.map((t) => key(it.substatus!, t));
    const repeats = keys.filter((k) => seen.has(k));
    if (repeats.length >= keys.length * 0.6) {
      const earlier = seen.get(repeats[0])!;
      if (earlier.adopted == null && it.adopted != null) Object.assign(earlier, { adopted: it.adopted, vote: it.vote });
      it.targets.forEach((t, i) => {
        if (!seen.has(keys[i])) {
          earlier.targets.push(t);
          seen.set(keys[i], earlier);
        }
      });
      continue;
    }
    const fresh = it.targets.filter((t, i) => !seen.has(keys[i]) && keys.indexOf(keys[i]) === i);
    for (const t of fresh) seen.set(key(it.substatus!, t), it);
    out.push({ ...it, targets: fresh });
  }
  return out;
}

/** Whole pipeline. Throws a readable error for scanned PDFs with no text layer. */
export async function readAgendaPdf(buf: Uint8Array): Promise<ReadAgenda> {
  const lines = await pdfLines(buf);
  if (lines.length < 5) {
    throw new Error("This PDF has no readable text (it may be a scan). Paste the addresses or parcel numbers instead.");
  }
  return looksLikeMinutes(lines) ? splitMinutes(lines) : splitAgenda(lines);
}
