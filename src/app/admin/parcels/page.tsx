import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { requirePageStaff } from "@/lib/auth/session";
import { searchParcels } from "@/lib/parcels";

export const dynamic = "force-dynamic";

export default async function ParcelSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const staff = await requirePageStaff("admin", "/admin/parcels");
  const { q = "" } = await searchParams;
  const hits = q.trim().length >= 2 ? await searchParcels(q) : [];
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap">
        <Link href="/admin/city" className="muted small">← City actions</Link>
        <h1>Update one parcel</h1>
        <form method="get" className="row">
          <input className="input" name="q" defaultValue={q} placeholder="Address or parcel ID" style={{ flex: 1 }} autoFocus />
          <button className="btn">Search</button>
        </form>
        {hits.length > 0 && (
          <ul className="results">
            {hits.map((h) => (
              <li key={h.parcel_id}>
                <Link href={`/admin/parcels/${encodeURIComponent(h.parcel_id)}`} style={{ display: "block", padding: "10px 12px", color: "inherit", textDecoration: "none", borderBottom: "1px solid var(--line)" }}>
                  <strong>{h.situs_address ?? "No address"}</strong>
                  <div className="muted small">{h.parcel_id} · {h.owner_name ?? "Owner unknown"}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && !hits.length && <div className="muted">No Jackson parcels match.</div>}
      </main>
    </div>
  );
}
