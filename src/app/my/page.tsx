import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { requirePageStaff } from "@/lib/auth/session";
import { mySubmissions } from "@/lib/submissions";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  draft: "Not sent",
  processing: "Processing photos",
  pending: "Waiting for review",
  needs_photo: "Better photo requested",
  approved: "Approved",
  rejected: "Rejected",
};

export default async function MyPage() {
  const staff = await requirePageStaff("contributor", "/my");
  const rows = (await mySubmissions(staff)).filter((r) => r.status !== "draft" || r.photo_count > 0);
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>My submissions</h1>
          <Link className="btn" href="/submit">Submit a property</Link>
        </div>
        {rows.length === 0 && <div className="card muted">Nothing yet.</div>}
        {rows.map((r) => (
          <div key={r.id} className={`card stack${r.status === "needs_photo" ? " warn" : ""}`} style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{r.situs_address ?? r.parcel_id}</strong>
              <span className={`pill ${r.status}`}>{LABEL[r.status] ?? r.status}</span>
            </div>
            <div className="muted small">
              Parcel {r.parcel_id} · {r.photo_count} photo{r.photo_count === 1 ? "" : "s"}
              {r.kind === "follow_up" && " · follow-up"}
              {r.submitted_at && ` · sent ${new Date(r.submitted_at).toLocaleDateString("en-US", { timeZone: "America/Chicago" })}`}
            </div>
            {r.review_reason && (r.status === "needs_photo" || r.status === "rejected") && (
              <div style={{ fontSize: 14 }}>
                <strong>{r.status === "rejected" ? "Reason:" : "Reviewer asked:"}</strong> {r.review_reason}
              </div>
            )}
            {r.status === "needs_photo" && (
              <Link className="btn" href={`/submit?resume=${r.id}`} style={{ alignSelf: "flex-start" }}>Add a better photo</Link>
            )}
          </div>
        ))}
      </main>
    </div>
  );
}
