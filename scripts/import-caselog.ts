/**
 * Import a City Code Enforcement case log (the .xlsx or .csv from a records request) as review batches.
 *
 *   npm run caselog:import -- --as admin@example.org ~/Downloads/case-log.xlsx            (dry run: report only)
 *   npm run caselog:import -- --as admin@example.org ~/Downloads/case-log.xlsx --apply    (upload + create batches)
 *
 * Creates up to three batches (see planCaseLog in src/lib/caseLog.ts):
 *   property cases          "Cited" on the day each case was opened
 *   council adjudications   "Adjudicated by council" on each resolution date
 *   case numbers only       Grass & Weeds and Vehicle cases, pre-skipped; recording them only links case numbers to parcels
 * The log itself is stored as a private CSV. Nothing is recorded until an admin reviews and records
 * each batch on the site. Batches that already exist (same title) are left alone, so re-running is safe.
 * Add --date YYYY-MM-DD when the log's export date isn't in its sheet name.
 *
 * Also reads the City's Blight Action page, saved as .html (see cityPageTable in src/lib/caseLog.ts).
 *   --only-new        skip cases the app already knows (linked in app.code_cases by an earlier log)
 *   --title "<name>"  batch title prefix instead of "Code Enforcement case log, <date>"
 * e.g. npm run caselog:import -- --as admin@example.org blightaction.html --only-new --date 2026-11-24 \
 *        --title "City Blight Action page, retrieved 2026-11-24"
 * Against the live site, run with: node --env-file=.env.production.local node_modules/.bin/tsx ...
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../sync/env";
loadEnv();

const { default: readXlsxFile } = await import("read-excel-file/node");
const { getPool } = await import("../src/lib/db");
const { parseCsv } = await import("../src/lib/csv");
const { readCaseLog, planCaseLog, cityPageTable } = await import("../src/lib/caseLog");
const { createCaseLogBatch } = await import("../src/lib/imports");
const { createDocumentSlot, markDocumentUploaded } = await import("../src/lib/documents");
const { storage } = await import("../src/lib/storage");
type Staff = import("../src/lib/auth/staff").Staff;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const apply = args.includes("--apply");
const asEmail = flag("--as");
const dateArg = flag("--date");
const titleArg = flag("--title");
const onlyNew = args.includes("--only-new");
const file = args.find((a, i) => !a.startsWith("--") && !["--as", "--date", "--title"].includes(args[i - 1]));
if (!asEmail || !file) {
  console.error('usage: npm run caselog:import -- --as <admin email> <case log .xlsx, .csv or City page .html> [--date YYYY-MM-DD] [--title "..."] [--only-new] [--apply]');
  process.exit(1);
}

const cell = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? "" : String(v));
const toCsv = (table: unknown[][]) =>
  table.map((r) => r.map((v) => { const s = cell(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n") + "\n";

const pool = getPool();
try {
  const { rows: staffRows } = await pool.query<Staff>(
    "SELECT id, email, name, role, must_change_password FROM app.staff WHERE email = $1 AND active",
    [asEmail],
  );
  const staff = staffRows[0];
  if (!staff || staff.role !== "admin") throw new Error(`${asEmail} isn't an active admin account`);

  let table: unknown[][];
  let sheetName = "";
  if (/\.xlsx$/i.test(file)) {
    const sheets = await readXlsxFile(file);
    table = sheets[0].data as unknown[][];
    sheetName = sheets[0].sheet;
    if (sheets.length > 1) console.log(`Note: reading only the first sheet ("${sheetName.trim()}") of ${sheets.length}.`);
  } else if (/\.html?$/i.test(file)) {
    table = cityPageTable(readFileSync(file, "utf8"));
  } else {
    table = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, ""));
  }
  const read = readCaseLog(table);
  const problems = read.problems;
  let rows = read.rows;
  if (onlyNew) {
    const { rows: known } = await pool.query<{ case_no: string }>("SELECT case_no FROM app.code_cases WHERE case_no = ANY($1)", [
      rows.map((r) => r.caseNo).filter(Boolean),
    ]);
    const knownSet = new Set(known.map((k) => k.case_no));
    rows = rows.filter((r) => !r.caseNo || !knownSet.has(r.caseNo));
    console.log(`--only-new: ${knownSet.size} cases already in the app left out, ${rows.length} new.`);
  }
  const plan = planCaseLog(rows);
  const logDate = dateArg ?? sheetName.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? rows.map((r) => r.opened ?? "").sort().at(-1) ?? null;
  if (!logDate) throw new Error("Couldn't tell when the log was exported; add --date YYYY-MM-DD.");

  console.log(`${apply ? "IMPORTING" : "DRY RUN (add --apply to import)"}: ${path.basename(file)} against ${process.env.SUPABASE_URL ? "the live site" : "the local database"}`);
  console.log(`Log exported ${logDate}: ${rows.length} cases.`);
  const byCat = new Map<string, number>();
  for (const r of rows) byCat.set(r.category ?? "(none)", (byCat.get(r.category ?? "(none)") ?? 0) + 1);
  for (const [k, n] of [...byCat].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`);
  if (problems.length) {
    console.log(`\n${problems.length} row(s) left out:`);
    for (const p of problems.slice(0, 15)) console.log(`  ${p}`);
    if (problems.length > 15) console.log(`  ... and ${problems.length - 15} more`);
  }

  const base = titleArg ?? `Code Enforcement case log, ${logDate}`;
  const batches = [
    { title: `${base}: property cases`, entries: plan.cases },
    { title: `${base}: council adjudications`, entries: plan.adjudications },
    { title: `${base}: grass, weeds and vehicle cases (case numbers only)`, entries: plan.caseNumbers },
  ].filter((b) => b.entries.length);
  console.log("");

  let documentId: string | null = null;
  for (const b of batches) {
    const existing = await pool.query("SELECT id FROM app.import_batches WHERE title = $1 AND status <> 'discarded' LIMIT 1", [b.title]);
    if (existing.rows[0]) {
      console.log(`  ${b.title}: already imported (batch ${existing.rows[0].id}); left alone`);
      continue;
    }
    if (!apply) {
      console.log(`  ${b.title}: ${b.entries.length} rows`);
      continue;
    }
    if (!documentId) {
      const csv = Buffer.from(toCsv(table));
      const name = `${path.basename(file).replace(/\.[^.]+$/, "")}.csv`;
      const slot = await createDocumentSlot(staff, { name, mime: "text/csv", bytes: csv.byteLength, public: false, title: base, date: logDate });
      await storage().put(slot.key, csv, "text/csv");
      await markDocumentUploaded(slot.documentId, (k) => storage().exists(k));
      documentId = slot.documentId;
    }
    const started = Date.now();
    const id = await createCaseLogBatch(staff, { title: b.title, entries: b.entries, documentId, logDate });
    const { rows: s } = await pool.query("SELECT stats FROM app.import_batches WHERE id = $1", [id]);
    const st = s[0].stats;
    console.log(
      `  ${b.title}: ${b.entries.length} rows -> ${st.accepted} matched, ${st.review} to review, ${st.unmatched} unmatched` +
        `${st.preSkipped ? `, ${st.preSkipped} pre-skipped` : ""} (${((Date.now() - started) / 1000).toFixed(0)}s) -> /admin/imports/${id}`,
    );
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
