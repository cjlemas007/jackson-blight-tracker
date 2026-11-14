import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { requirePageStaff } from "@/lib/auth/session";
import { movers, weeklyDigest, type Mover } from "@/lib/digest";

export const dynamic = "force-dynamic";

const ROWS: { key: keyof Awaited<ReturnType<typeof weeklyDigest>>["thisWeek"]; label: string }[] = [
  { key: "verified", label: "Parcels newly verified blighted" },
  { key: "city_actions", label: "City actions recorded" },
  { key: "demolished", label: "Demolitions" },
  { key: "resolved", label: "Resolutions (any kind)" },
  { key: "submissions", label: "Photo submissions" },
  { key: "approved", label: "Submissions approved" },
  { key: "rejected", label: "Submissions rejected" },
  { key: "surveyed_parcels", label: "Parcels surveyed" },
  { key: "corrections", label: "Correction requests" },
];

function MoverTable({ title, rows, href }: { title: string; rows: Mover[]; href: (k: string) => string }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <div className="muted small">No change this week.</div>
      ) : (
        <table className="table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td><Link href={href(r.key)}>{r.label}</Link></td>
                <td className="num small muted">{r.before} → {r.now}</td>
                <td className="num"><span className={`change ${r.change > 0 ? "up" : "down"}`}>{r.change > 0 ? `+${r.change}` : r.change}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function Dashboard() {
  const staff = await requirePageStaff("admin", "/admin/dashboard");
  const [d, m] = await Promise.all([weeklyDigest(), movers(7)]);
  const open = [
    { n: d.open.queue, l: "photos waiting for review", href: "/admin" },
    { n: d.open.needs_photo, l: "waiting on a better photo", href: "/admin?status=needs_photo" },
    { n: d.open.corrections, l: "correction requests", href: "/admin/corrections" },
    { n: d.open.suggestions, l: "land roll suggestions", href: "/admin/suggestions" },
    { n: d.open.imports, l: "imports to finish", href: "/admin/imports" },
  ];
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap wide">
        <h1>Dashboard</h1>
        <div className="counters">
          {open.map((o) => (
            <Link key={o.l} href={o.href} className="counter" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="n">{o.n}</div><div className="l">{o.l}</div>
            </Link>
          ))}
        </div>
        <section className="card">
          <h2>This week (since Monday {d.week_start}) vs last week</h2>
          <table className="table">
            <thead><tr><th></th><th className="num">This week</th><th className="num">Last week</th></tr></thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.key}><td>{r.label}</td><td className="num"><strong>{d.thisWeek[r.key]}</strong></td><td className="num">{d.lastWeek[r.key]}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <h2 style={{ margin: "8px 0 0" }}>Biggest movers: change in verified blighted parcels, last 7 days</h2>
        <div className="review-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <MoverTable title="Owners" rows={m.owners} href={(k) => `/owners/${encodeURIComponent(k)}`} />
          <MoverTable title="Streets" rows={m.streets} href={() => "/streets"} />
          <MoverTable title="Wards" rows={m.wards} href={() => "/areas?kind=ward"} />
          <MoverTable title="Neighborhoods" rows={m.neighborhoods} href={() => "/areas?kind=neighborhood"} />
        </div>
      </main>
    </div>
  );
}
