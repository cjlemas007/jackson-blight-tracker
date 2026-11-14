import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SurveyStart from "@/components/SurveyStart";
import { requirePageStaff } from "@/lib/auth/session";
import { recentSurveys } from "@/lib/surveys";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SurveyHome() {
  const staff = await requirePageStaff("contributor", "/survey");
  const [recent, areas] = await Promise.all([
    recentSurveys(),
    query<{ kind: string; code: string; name: string }>(
      `SELECT b.kind, b.code, b.name FROM data.boundaries b
       WHERE b.kind IN ('ward', 'neighborhood', 'tract')
         AND EXISTS (SELECT 1 FROM app.parcel_facts f WHERE f.in_city AND
               CASE b.kind WHEN 'ward' THEN f.ward WHEN 'neighborhood' THEN f.neighborhood ELSE f.tract END = b.code)
       ORDER BY b.kind, length(b.code), b.name`,
    ),
  ]);
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap">
        <h1>Survey mode</h1>
        <p className="muted" style={{ margin: 0 }}>
          Walk or drive a street and mark every parcel. This is what lets the site show a real blight rate instead of
          &ldquo;reported so far.&rdquo; Blighted parcels need a photo, which goes to the review queue like any submission.
        </p>
        <SurveyStart areas={areas} />
        <section className="card">
          <h2>Recent surveys</h2>
          {recent.length === 0 ? (
            <div className="muted">None yet.</div>
          ) : (
            <table className="table">
              <tbody>
                {recent.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/survey/${s.id}`}><strong>{s.scope_label}</strong></Link> <span className="muted small">{s.scope_kind}</span></td>
                    <td className="small">{s.created_by_name}</td>
                    <td className="small">{new Date(s.started_at).toLocaleDateString("en-US", { timeZone: "America/Chicago" })}</td>
                    <td className="small">{s.marked} marked{s.completed_at ? " · finished" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
