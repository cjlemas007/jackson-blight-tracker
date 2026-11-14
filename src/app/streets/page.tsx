import SiteHeader from "@/components/SiteHeader";
import { currentStaff } from "@/lib/auth/session";
import { streetRankings } from "@/lib/rankings";
import { blightRateLabel, coverageLabel, fmtPct } from "@/lib/coverage";
import { STREET_MIN_PARCELS } from "@/config";

export const dynamic = "force-dynamic";

export default async function StreetsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; min?: string; coverage?: string }>;
}) {
  const sp = await searchParams;
  const sort = sp.sort === "pct" ? "pct" : "count";
  const min = Math.min(500, Math.max(1, Number(sp.min) || STREET_MIN_PARCELS));
  const surveyedOnly = sp.coverage === "surveyed";
  const [rows, staff] = await Promise.all([streetRankings({ sort, minParcels: min, surveyedOnly }), currentStaff()]);
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap wide">
        <h1>Streets with the most blight</h1>
        <form className="filters" method="get">
          <label>Sort by{" "}
            <select name="sort" defaultValue={sort}>
              <option value="count">Number of blighted parcels</option>
              <option value="pct">Share of parcels blighted</option>
            </select>
          </label>
          <label>Streets with at least{" "}
            <input name="min" type="number" min={1} max={500} defaultValue={min} style={{ width: 70 }} /> parcels
          </label>
          <label>
            <select name="coverage" defaultValue={surveyedOnly ? "surveyed" : "all"}>
              <option value="all">All streets</option>
              <option value="surveyed">Fully surveyed streets only</option>
            </select>
          </label>
          <button className="btn secondary">Apply</button>
        </form>
        <p className="muted small" style={{ margin: 0 }}>
          Verified blighted parcels divided by all parcels on the street (Jackson only). Streets with fewer than {min} parcels
          are left out so a three-lot street can&apos;t top the list. Unless a street has been fully surveyed, its share is a
          floor: &ldquo;reported so far.&rdquo;
        </p>
        {rows.length === 0 ? (
          <div className="card muted">{surveyedOnly ? "No fully surveyed streets have verified blight yet." : "No streets have verified blight yet."}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr><th>#</th><th>Street</th><th className="num">Blighted</th><th className="num">Parcels</th><th>Share</th><th>Coverage</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.street_name}>
                    <td className="num">{i + 1}</td>
                    <td><strong>{r.street_name}</strong></td>
                    <td className="num">
                      <strong>{r.blighted}</strong>
                      {r.city_flagged > 0 && <div className="muted small">+{r.city_flagged} City-flagged</div>}
                    </td>
                    <td className="num">{r.total_parcels}</td>
                    <td>
                      <div className="bar" aria-hidden><span style={{ width: fmtPct(r.share_blighted) }} /></div>
                      <span className={r.fully_surveyed ? "" : "floor"}>{blightRateLabel(r.blighted, r.total_parcels, r.surveyed)}</span>
                    </td>
                    <td className="small muted">{coverageLabel(r.surveyed, r.total_parcels)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
