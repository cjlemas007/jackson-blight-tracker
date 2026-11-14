import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { currentStaff } from "@/lib/auth/session";
import { ownerRankings, type OwnerTab } from "@/lib/rankings";
import { coverageLabel, fmtPct } from "@/lib/coverage";

export const dynamic = "force-dynamic";

const TABS: { key: OwnerTab; label: string; blurb: string }[] = [
  { key: "private", label: "Private owners & LLCs", blurb: "Grouped into portfolios by shared mailing address or newsroom research, not by name spelling." },
  { key: "state", label: "State of Mississippi", blurb: "Tax-forfeited land held by the State (owner of record: State of Mississippi)." },
  { key: "public", label: "City & public bodies", blurb: "City of Jackson, housing authorities, schools, and other public owners." },
];

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function OwnersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: t } = await searchParams;
  const tab = (TABS.find((x) => x.key === t)?.key ?? "private") as OwnerTab;
  const [rows, staff] = await Promise.all([ownerRankings(tab), currentStaff()]);
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap wide">
        <h1>Who owns the most blighted property</h1>
        <nav className="tabs">
          {TABS.map((x) => (
            <Link key={x.key} href={`/owners?tab=${x.key}`} aria-current={x.key === tab ? "page" : undefined}>{x.label}</Link>
          ))}
        </nav>
        <p className="muted" style={{ margin: 0 }}>
          {TABS.find((x) => x.key === tab)!.blurb} Ranked by verified blighted parcels in Jackson. Homestead-exempt and
          heirs/estate parcels are left out of these counts. They still count in street and area totals.
        </p>
        {rows.length === 0 ? (
          <div className="card muted">No verified blighted parcels for this group yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th><th>Owner</th><th className="num">Blighted</th><th className="num">Parcels in Jackson</th>
                  <th className="num">Share blighted</th><th className="num">Unpaid taxes</th><th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.portfolio_id}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <Link href={`/owners/${encodeURIComponent(r.portfolio_id)}`}><strong>{r.name}</strong></Link>
                      {r.other_names > 0 && (
                        <div className="muted small">
                          + {r.other_names} other owner name{r.other_names > 1 ? "s" : ""}
                          {!r.curated && r.portfolio_id.startsWith("MK:") && " · grouped automatically by shared mailing address, not yet verified"}
                        </div>
                      )}
                      {r.blighted_excluded > 0 && <div className="muted small">{r.blighted_excluded} more blighted, excluded (homestead/estate)</div>}
                      {r.city_flagged > 0 && <div className="muted small">plus {r.city_flagged} City-flagged, not yet verified</div>}
                    </td>
                    <td className="num"><strong>{r.blighted}</strong></td>
                    <td className="num">{r.total_parcels.toLocaleString()}</td>
                    <td className="num">{fmtPct(r.share_blighted)}</td>
                    <td className="num">{r.taxes_owed > 0 ? usd(r.taxes_owed) : "—"}</td>
                    <td className="small muted">{coverageLabel(r.surveyed, r.total_parcels)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          Unpaid taxes: current-year balances known from county tax records; parcels known only from the county parcel map
          have no tax data. Ownership per the Hinds County land roll and parcel map.
        </p>
      </main>
    </div>
  );
}
