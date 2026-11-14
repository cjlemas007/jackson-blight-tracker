import Link from "next/link";
import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { currentStaff } from "@/lib/auth/session";
import { ownerDetail } from "@/lib/rankings";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  unreported: "Not reported", submitted: "Not reported", verified_blighted: "Verified blighted",
  city_action: "City action pending", resolved: "Resolved",
};
const usd = (n: number | null) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function OwnerPage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const [d, staff] = await Promise.all([ownerDetail(id), currentStaff()]);
  if (!d) notFound();
  type P = (typeof d.parcels)[number];
  const blighted = d.parcels.filter((p: P) => p.status === "verified_blighted" || p.status === "city_action");
  const title = d.display_name ?? (d.owner_names?.[0] ?? id);
  const OTHER_LIMIT = 300;
  const others = d.parcels.filter((p: P) => !(p.status === "verified_blighted" || p.status === "city_action"));
  const shown = [...blighted, ...others.slice(0, OTHER_LIMIT)];
  const hidden = others.length - Math.min(others.length, OTHER_LIMIT);
  const due = d.parcels.reduce((s: number, p: P) => s + (Number(p.current_due) || 0), 0);
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap wide">
        <Link href="/owners" className="muted small">← Owners</Link>
        <h1>{title}</h1>
        <div className="counters">
          <div className="counter"><div className="n">{blighted.length}</div><div className="l">verified blighted</div></div>
          <div className="counter"><div className="n">{d.parcels.length}</div><div className="l">parcels in Jackson</div></div>
          <div className="counter"><div className="n">{usd(due)}</div><div className="l">unpaid current taxes</div></div>
        </div>
        <div className="card stack" style={{ gap: 6 }}>
          {d.principal && <div><strong>Principal:</strong> {d.principal}</div>}
          {d.owner_names?.length > 1 && (
            <div><strong>Owner names in this portfolio:</strong> {d.owner_names.join("; ")}</div>
          )}
          {id.startsWith("MK:") && (d.owner_names?.length ?? 0) > 1 && (
            <div className="card warn small">
              These owner names share a mailing address, so they were grouped automatically. A shared address can also
              belong to a management company, lawyer, or tax agent, so confirm the grouping before reporting on it.
            </div>
          )}
          <div className="muted small">
            {id.startsWith("MK:")
              ? `Grouped automatically by the owners' shared mailing address (${id.slice(3).replaceAll("|", ", ").replace(/, ,/g, ",")}).`
              : id.startsWith("OWN:")
                ? "Owner from the county parcel map (no mailing address on file)."
                : d.display_name
                  ? "Portfolio grouped by newsroom research (mailing addresses and Secretary of State filings)."
                  : "Public owner."}
            {" "}Homestead-exempt and heirs/estate parcels are listed but excluded from the owner rankings.
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Address</th><th>Parcel</th><th>Status</th><th>Owner of record</th><th className="num">Unpaid taxes</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {shown.map((p: P) => (
                <tr key={p.parcel_id}>
                  <td><a href={`/?parcel=${encodeURIComponent(p.parcel_id)}`}>{p.situs_address ?? "—"}</a></td>
                  <td className="small">{p.parcel_id}</td>
                  <td>
                    <span className={`pill ${p.status === "verified_blighted" || p.status === "city_action" ? "rejected" : p.status === "resolved" ? "approved" : ""}`}>
                      {STATUS[p.status] ?? p.status}
                    </span>
                    {p.status_since && p.status !== "submitted" && <div className="muted small">since {p.status_since}</div>}
                  </td>
                  <td className="small">{p.owner_name}</td>
                  <td className="num">{p.delinquent === null ? <span className="muted small">no record</span> : usd(p.current_due)}</td>
                  <td className="small muted">
                    {p.ranking_excluded_reason === "homestead" && "Homestead (excluded from ranking)"}
                    {p.ranking_excluded_reason === "estate_heirs" && "Heirs/estate (excluded from ranking)"}
                    {p.surveyed_on && ` Surveyed ${p.surveyed_on}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hidden > 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            Showing every blighted parcel and the first {OTHER_LIMIT} others; {hidden.toLocaleString()} more parcels aren&apos;t listed.
          </p>
        )}
      </main>
    </div>
  );
}
