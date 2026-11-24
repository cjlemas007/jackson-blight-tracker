import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import PageHead from "@/components/PageHead";
import { currentStaff } from "@/lib/auth/session";
import { cityResponse, recentChanges, STALE_DAYS_DEFAULT, waitingOnCity } from "@/lib/cityResponse";
import { HBarChart, WeeklyBars } from "@/components/embed/Charts";
import { weeklyTrend } from "@/lib/charts";
import { STATUS_COLORS } from "@/lib/palette";

export const dynamic = "force-dynamic";

const STAGE: Record<string, string> = {
  cited: "Cited", hearing_set: "Hearing set", adjudicated: "Adjudicated by council",
  demolition_ordered: "Demolition ordered", lot_cleanup_ordered: "Lot cleanup ordered", lien_filed: "Lien filed",
};
const CHANGE: Record<string, string> = {
  verified_blighted: "Verified blighted", ...STAGE, demolished: "Demolished", repaired: "Repaired", lot_cleared: "Lot cleared",
  rejected_on_recheck: "Not blighted on re-check",
};
const SOURCE: Record<string, string> = {
  user_photo: "newsroom photo", admin_entry: "newsroom", city_record: "city record", council_agenda: "council agenda",
  survey: "newsroom survey", land_roll: "land roll",
};
const days = (n: number | null) => (n === null ? "—" : `${Math.round(n)} days`);

export default async function CityPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  const n = Math.min(3650, Math.max(1, Number(sp.days) || STALE_DAYS_DEFAULT));
  const [r, waiting, recent, staff, weeks] = await Promise.all([cityResponse(), waitingOnCity(n), recentChanges(), currentStaff(), weeklyTrend(12)]);
  const total = waiting[0]?.total ?? 0;
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap wide">
        <PageHead
          kicker="Accountability"
          title="What the City is doing about it"
          dek="Demolitions, citations and council actions on verified blighted property, and how long the City takes to act, from each parcel’s dated history."
        />

        <div className="counters">
          <div className="counter"><div className="n">{r.demolished.week}</div><div className="l">demolished this week</div></div>
          <div className="counter"><div className="n">{r.demolished.month}</div><div className="l">demolished this month</div></div>
          <div className="counter"><div className="n">{r.demolished.year}</div><div className="l">demolished this year</div></div>
          <div className="counter">
            <div className="n">{days(r.median_days_to_action)}</div>
            <div className="l">median from verification to first city action</div>
            <div className="q">{r.n_with_action} of {r.verified_total} verified parcels have seen action</div>
          </div>
          <div className="counter">
            <div className="n">{days(r.median_days_to_resolution)}</div>
            <div className="l">median from verification to resolution</div>
            <div className="q">{r.n_resolved} resolved</div>
          </div>
        </div>

        <section className="card">
          <h2>Demolitions each week</h2>
          <WeeklyBars label="Demolitions of verified blighted parcels per week, last 12 weeks" points={weeks.map((w) => ({ week: w.week, value: w.demolished }))} />
          <p className="note" style={{ marginTop: 10 }}>Weeks start Monday. The highlighted week is the current one, so far.</p>
        </section>

        <section className="card">
          <h2>Parcels at each stage of city action</h2>
          <div style={{ maxWidth: 760 }}>
            <HBarChart color={STATUS_COLORS.city_action} rows={r.stages.map((s) => ({ label: STAGE[s.substatus], value: s.parcels }))} />
          </div>
          {r.city_only > 0 && (
            <p className="muted small" style={{ marginBottom: 0 }}>
              Includes {r.city_only} parcel{r.city_only > 1 ? "s" : ""} the City acted on that the newsroom hasn&apos;t verified
              (these aren&apos;t counted as verified blight elsewhere on the site).
            </p>
          )}
        </section>

        <section className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Verified more than {n} days ago, no city action yet ({total})</h2>
            <form method="get" className="filters">
              <label>Older than <input name="days" type="number" min={1} defaultValue={n} style={{ width: 70 }} /> days</label>
              <button className="btn secondary">Update</button>
            </form>
          </div>
          {waiting.length === 0 ? (
            <div className="muted">None.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Address</th><th className="hide-sm">Owner</th><th className="hide-sm">Ward</th><th>Verified</th><th className="num">Waiting</th></tr></thead>
                <tbody>
                  {waiting.map((w) => (
                    <tr key={w.parcel_id}>
                      <td><a href={`/?parcel=${encodeURIComponent(w.parcel_id)}`}>{w.situs_address ?? w.parcel_id}</a></td>
                      <td className="small hide-sm">{w.portfolio_id ? <Link href={`/owners/${encodeURIComponent(w.portfolio_id)}`}>{w.owner_name}</Link> : "Owner unknown"}</td>
                      <td className="hide-sm">{w.ward ?? "—"}</td>
                      <td className="small nowrap">{w.verified_on}</td>
                      <td className="num nowrap"><strong>{w.days_waiting}</strong> days</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {total > waiting.length && <p className="muted small">Showing the {waiting.length} longest-waiting of {total}.</p>}
              <a className="small" href={`/api/export/waiting.csv?days=${n}`}>Download the full list (CSV)</a>
            </div>
          )}
        </section>

        <section className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Recent changes</h2>
            <a className="small" href="/api/export/recent.csv">Download (CSV)</a>
          </div>
          <table className="table">
            <thead><tr><th>Date</th><th>Address</th><th>Change</th><th className="hide-sm">Source</th></tr></thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id}>
                  <td className="small nowrap">{e.effective_date}</td>
                  <td><a href={`/?parcel=${encodeURIComponent(e.parcel_id)}`}>{e.situs_address ?? e.parcel_id}</a></td>
                  <td>{CHANGE[e.substatus ?? e.status] ?? e.status}</td>
                  <td className="small hide-sm">
                    {SOURCE[e.source] ?? e.source}
                    {e.document_id && <> · <a href={`/api/documents/${e.document_id}`} target="_blank" rel="noreferrer">{e.document_title ?? "document"}</a></>}
                  </td>
                </tr>
              ))}
              {!recent.length && <tr><td colSpan={4} className="muted">Nothing recorded yet.</td></tr>}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
