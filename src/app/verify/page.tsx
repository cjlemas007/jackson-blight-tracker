import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { requirePageStaff } from "@/lib/auth/session";
import { needsNewsroomCheck } from "@/lib/cityResponse";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const STAGE: Record<string, string> = {
  demolition_ordered: "Demolition ordered", adjudicated: "Adjudicated by council", lot_cleanup_ordered: "Lot cleanup ordered",
  hearing_set: "Hearing set", lien_filed: "Lien filed", cited: "Cited",
};

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ ward?: string }> }) {
  const staff = await requirePageStaff("contributor", "/verify");
  const { ward } = await searchParams;
  const [rows, wards] = await Promise.all([
    needsNewsroomCheck({ ward: ward || null }),
    query<{ code: string; name: string }>("SELECT code, name FROM data.boundaries WHERE kind = 'ward' ORDER BY length(code), code"),
  ]);
  const total = rows[0]?.total ?? 0;
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap wide">
        <h1>Needs a newsroom check ({total})</h1>
        <p className="muted" style={{ margin: 0 }}>
          The City has acted on these parcels, but nobody on staff has verified them, so they don&apos;t count as verified
          blight yet. Photograph one from the street, and once an admin approves it, it counts (and keeps its City status).
          Strongest City findings first.
        </p>
        <form method="get" className="filters">
          <label>Ward{" "}
            <select name="ward" defaultValue={ward ?? ""}>
              <option value="">All wards</option>
              {wards.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
            </select>
          </label>
          <button className="btn secondary">Filter</button>
        </form>
        {rows.length === 0 ? (
          <div className="card muted">Nothing waiting{ward ? " in this ward" : ""}.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Address</th><th>City action</th><th>Since</th><th>Ward</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.parcel_id}>
                    <td>
                      <strong>{r.situs_address ?? r.parcel_id}</strong>
                      <div className="muted small">{r.parcel_id} · {r.owner_name}</div>
                    </td>
                    <td>{STAGE[r.substatus] ?? r.substatus}</td>
                    <td className="small">{r.since}</td>
                    <td>{r.ward ?? "—"}</td>
                    <td>
                      {r.submission_open ? (
                        <span className="pill pending">Photo in review</span>
                      ) : (
                        <div className="row" style={{ gap: 6 }}>
                          <Link className="btn" style={{ padding: "6px 10px", fontSize: 13 }} href={`/submit?parcel=${encodeURIComponent(r.parcel_id)}`}>Submit photos</Link>
                          {r.lat !== null && (
                            <a className="btn secondary" style={{ padding: "6px 10px", fontSize: 13 }} target="_blank" rel="noreferrer"
                              href={`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}`}>Directions</a>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > rows.length && <p className="muted small">Showing the first {rows.length} of {total}.</p>}
      </main>
    </div>
  );
}
