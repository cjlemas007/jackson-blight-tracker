import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { requirePageStaff } from "@/lib/auth/session";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CityAdmin() {
  const staff = await requirePageStaff("admin", "/admin/city");
  const [counts] = await query<{ review: number; suggestions: number; applied: number }>(
    `SELECT (SELECT count(*)::int FROM app.import_batches WHERE status IN ('mapping', 'review')) AS review,
            (SELECT count(*)::int FROM app.suggestions WHERE status = 'open') AS suggestions,
            (SELECT count(*)::int FROM app.import_batches WHERE status = 'applied') AS applied`,
  );
  const cards = [
    { href: "/admin/agenda", title: "Council agenda quick entry", text: "Paste the addresses adjudicated at a meeting, attach the agenda PDF, set the date." },
    { href: "/admin/imports", title: "Import city records (CSV)", text: `Demolition lists, code-enforcement case logs, the Secretary of State forfeited list. ${counts.review} open, ${counts.applied} applied.` },
    { href: "/admin/parcels", title: "Update one parcel", text: "Record a single city action or resolution with its source, or void a mistaken entry." },
    { href: "/admin/suggestions", title: `Land roll suggestions (${counts.suggestions})`, text: "Ownership changes and improvement values dropping to zero on verified parcels. Never applied automatically." },
  ];
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap">
        <h1>City actions</h1>
        <p className="muted" style={{ margin: 0 }}>Everything here writes dated entries to parcel histories, which feed the public City response page.</p>
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <h2 style={{ margin: "0 0 4px" }}>{c.title}</h2>
            <div className="muted">{c.text}</div>
          </Link>
        ))}
      </main>
    </div>
  );
}
