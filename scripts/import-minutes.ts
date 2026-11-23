/**
 * Bulk-import City Council minutes PDFs as council-agenda review batches.
 *
 *   npm run minutes:import -- --as admin@example.org ~/Downloads/2025            (dry run: report only)
 *   npm run minutes:import -- --as admin@example.org ~/Downloads/2025 --apply    (upload + create batches)
 *
 * For each meeting with nuisance orders (menace declarations, demolition and cleanup contracts, cost
 * liens) it uploads only the pages holding those orders (public, linked from each parcel's history)
 * and creates one review batch. Orders not adopted and cases the hearing officer didn't adjudicate
 * arrive skipped; nothing is recorded until an admin reviews and records the batch on the site.
 * Meetings that already have a batch with the same title are left alone, so re-running is safe.
 * Against the live site, run with: node --env-file=.env.production.local node_modules/.bin/tsx ...
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../sync/env";
loadEnv();

const { getPool } = await import("../src/lib/db");
const { readAgendaPdf, parseMeetingDate } = await import("../src/lib/agendaPdf");
const { excerptPages, pageRanges } = await import("../src/lib/pdfExcerpt");
const { createAgendaBatch } = await import("../src/lib/imports");
const { createDocumentSlot, markDocumentUploaded } = await import("../src/lib/documents");
const { storage } = await import("../src/lib/storage");
type Staff = import("../src/lib/auth/staff").Staff;
type AgendaEntry = import("../src/lib/imports").AgendaEntry;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const asIdx = args.indexOf("--as");
const asEmail = asIdx >= 0 ? args[asIdx + 1] : null;
const inputs = args.filter((a, i) => !a.startsWith("--") && i !== asIdx + 1);
if (!asEmail || !inputs.length) {
  console.error('usage: npm run minutes:import -- --as <admin email> <folder or PDF ...> [--apply]');
  process.exit(1);
}

const pool = getPool();
try {
  const { rows } = await pool.query<Staff>(
    "SELECT id, email, name, role, must_change_password FROM app.staff WHERE email = $1 AND active",
    [asEmail],
  );
  const staff = rows[0];
  if (!staff || staff.role !== "admin") throw new Error(`${asEmail} isn't an active admin account`);

  const files = inputs.flatMap((p) =>
    statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.toLowerCase().endsWith(".pdf")).map((f) => path.join(p, f)) : [p],
  );
  console.log(`${apply ? "IMPORTING" : "DRY RUN (add --apply to import)"}: ${files.length} PDF(s) against ${process.env.SUPABASE_URL ? "the live site" : "the local database"}\n`);

  const meetings = [];
  for (const file of files) {
    const buf = new Uint8Array(readFileSync(file));
    const r = await readAgendaPdf(buf.slice()); // the PDF reader takes over (empties) the buffer it's given
    const date = r.meetingDate ?? parseMeetingDate(path.basename(file).replace(/[-_]/g, " ").replace(/\.pdf$/i, ""));
    meetings.push({ file, buf, r, date });
  }
  meetings.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const totals = { meetings: 0, orders: 0, properties: 0, skipped: 0, batches: 0 };
  for (const { file, buf, r, date } of meetings) {
    const name = path.basename(file);
    const items = r.items.filter((i) => i.relevant && i.targets.length);
    if (!items.length) {
      console.log(`  ${String(date).padEnd(10)}  ${name}: no nuisance orders`);
      continue;
    }
    if (!date) {
      console.log(`  ??????????  ${name}: couldn't find the meeting date; skipped`);
      continue;
    }
    const entries: AgendaEntry[] = items.flatMap((it) =>
      it.targets.map((t) => ({
        item: r.kind === "minutes" ? `Order ${it.number}` : it.number,
        substatus: it.substatus!,
        caseNo: t.caseNo, parcelId: t.parcelId, address: t.address,
        skip: it.adopted === false ? `not adopted (${it.vote})` : t.excluded ?? null,
        note: it.adopted == null && r.kind === "minutes" ? "vote not printed: check the minutes" : null,
      })),
    );
    const skipped = entries.filter((e) => e.skip).length;
    const pages = [...new Set(items.flatMap((i) => i.pages ?? []))].sort((a, b) => a - b);
    const title = `${r.title ?? "City Council meeting"}, ${date} (${r.kind})`;
    totals.meetings++;
    totals.orders += items.length;
    totals.properties += entries.length;
    totals.skipped += skipped;
    const summary = `${items.length} orders, ${entries.length} properties${skipped ? ` (${skipped} arrive skipped)` : ""}, pages ${pageRanges(pages)}`;

    const existing = await pool.query("SELECT id FROM app.import_batches WHERE title = $1 AND status <> 'discarded' LIMIT 1", [title]);
    if (existing.rows[0]) {
      console.log(`  ${date}  ${name}: already imported (batch ${existing.rows[0].id}); left alone`);
      continue;
    }
    if (!apply) {
      console.log(`  ${date}  ${name}: ${summary}`);
      continue;
    }
    const excerpt = await excerptPages(buf, pages);
    const docTitle = `${title}: excerpt, pages ${pageRanges(excerpt.pages)} of the original`;
    const slot = await createDocumentSlot(staff, {
      name, mime: "application/pdf", bytes: excerpt.bytes.byteLength, public: true, title: docTitle, date,
    });
    await storage().put(slot.key, Buffer.from(excerpt.bytes), "application/pdf");
    await markDocumentUploaded(slot.documentId, (k) => storage().exists(k));
    const batchId = await createAgendaBatch(staff, { title, meetingDate: date, entries, documentId: slot.documentId });
    totals.batches++;
    console.log(`  ${date}  ${name}: ${summary}; excerpt ${(excerpt.bytes.byteLength / 1048576).toFixed(1)} MB -> /admin/imports/${batchId}`);
  }
  console.log(`\n${totals.meetings} meetings, ${totals.orders} orders, ${totals.properties} properties (${totals.skipped} arrive skipped)` +
    (apply ? `; ${totals.batches} review batches created` : ""));
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
