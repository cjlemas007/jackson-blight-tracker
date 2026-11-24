import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import PageHead from "@/components/PageHead";
import HeadlineCounters from "@/components/HeadlineCounters";
import AreaMapClient from "@/components/AreaMapClient";
import { currentStaff } from "@/lib/auth/session";
import { AREA_KINDS, areaRankings, headline, type AreaKind } from "@/lib/rankings";
import { blightRateLabel, coverageLabel } from "@/lib/coverage";

export const dynamic = "force-dynamic";

const LABEL: Record<AreaKind, string> = { ward: "Wards", neighborhood: "Neighborhoods", tract: "Census tracts" };

function Change({ now, then }: { now: number; then: number }) {
  const d = now - then;
  if (d === 0) return <span className="muted">0</span>;
  return <span className={`change ${d > 0 ? "up" : "down"}`}>{d > 0 ? `+${d}` : d}</span>;
}

export default async function AreasPage({ searchParams }: { searchParams: Promise<{ kind?: string; coverage?: string }> }) {
  const sp = await searchParams;
  const kind = ((AREA_KINDS as readonly string[]).includes(sp.kind ?? "") ? sp.kind : "ward") as AreaKind;
  const surveyedOnly = sp.coverage === "surveyed";
  const [rows, h, staff] = await Promise.all([areaRankings(kind, surveyedOnly), headline(), currentStaff()]);
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap wide">
        <PageHead
          kicker="Wards & neighborhoods"
          title="Where blight is concentrated"
          dek="Blighted parcels by council ward, neighborhood and census tract, and how each has changed over the last 30 and 90 days."
        />
        <HeadlineCounters h={h} />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <nav className="tabs">
            {AREA_KINDS.map((k) => (
              <Link key={k} href={`/areas?kind=${k}${surveyedOnly ? "&coverage=surveyed" : ""}`} aria-current={k === kind ? "page" : undefined}>
                {LABEL[k]}
              </Link>
            ))}
          </nav>
          <nav className="tabs">
            <Link href={`/areas?kind=${kind}`} aria-current={!surveyedOnly ? "page" : undefined}>All areas</Link>
            <Link href={`/areas?kind=${kind}&coverage=surveyed`} aria-current={surveyedOnly ? "page" : undefined}>Fully surveyed only</Link>
          </nav>
        </div>
        {kind === "neighborhood" && (
          <p className="muted small" style={{ margin: 0 }}>
            Neighborhood lines are unofficial (Zillow neighborhoods); the City publishes none, and about a fifth of parcels
            fall outside them.
          </p>
        )}
        <AreaMapClient kind={kind} />
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>{LABEL[kind].replace(/s$/, "")}</th><th className="num">Blighted</th><th className="num hide-sm">Parcels</th><th>Share</th>
                <th className="num">30 days</th><th className="num hide-sm">90 days</th><th className="hide-sm">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td><strong>{r.name}</strong></td>
                  <td className="num">
                    <strong>{r.blighted}</strong>
                    {r.city_flagged > 0 && <div className="muted small">+{r.city_flagged} City-flagged</div>}
                  </td>
                  <td className="num hide-sm">{r.total_parcels.toLocaleString()}</td>
                  <td className={r.fully_surveyed ? "" : "floor"}>{blightRateLabel(r.blighted, r.total_parcels, r.surveyed)}</td>
                  <td className="num"><Change now={r.blighted} then={r.blighted_30d_ago} /></td>
                  <td className="num hide-sm"><Change now={r.blighted} then={r.blighted_90d_ago} /></td>
                  <td className="small muted hide-sm">{coverageLabel(r.surveyed, r.total_parcels)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <div className="card muted">No fully surveyed areas yet.</div>}
        <a className="small" href={`/api/export/areas.csv?kind=${kind}${surveyedOnly ? "&coverage=surveyed" : ""}`}>Download this table (CSV)</a>
        <p className="muted small" style={{ margin: 0 }}>
          30/90 days: change in the number of blighted parcels since then, from each parcel&apos;s dated status history.
        </p>
      </main>
    </div>
  );
}
