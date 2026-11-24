import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { requirePageStaff } from "@/lib/auth/session";
import { queue } from "@/lib/submissions";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "pending", label: "Waiting for review" },
  { key: "needs_photo", label: "Photo requested" },
  { key: "processing", label: "Processing" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

const FAR_M = 75;

export default async function AdminQueue({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const staff = await requirePageStaff("admin", "/admin");
  const { status = "pending" } = await searchParams;
  const tab = TABS.some((t) => t.key === status) ? status : "pending";
  const rows = await queue([tab]);
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap wide">
        <h1>Review queue</h1>
        <nav className="tabs">
          {TABS.map((t) => (
            <Link key={t.key} href={`/admin?status=${t.key}`} aria-current={t.key === tab ? "page" : undefined}>{t.label}</Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <div className="card muted">Nothing here.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Sent</th><th>Property</th><th>Type</th><th>Photos</th><th>Camera location</th><th>By</th><th>Earlier</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.submitted_at ? new Date(r.submitted_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" }) : "—"}</td>
                    <td>
                      <Link href={`/admin/submissions/${r.id}`}><strong>{r.situs_address ?? r.parcel_id}</strong></Link>
                      <div className="muted small">{r.parcel_id} · {r.owner_name ?? "Owner unknown"}</div>
                    </td>
                    <td>{r.kind === "follow_up" ? "Follow-up" : "New report"}</td>
                    <td>{r.photo_count}</td>
                    <td>
                      {r.max_exif_distance_m === null ? (
                        <span className="pill">no GPS</span>
                      ) : (
                        <span className={r.max_exif_distance_m > FAR_M ? "pill rejected" : "pill approved"}>{r.max_exif_distance_m} m</span>
                      )}
                      {r.photos_without_gps > 0 && r.max_exif_distance_m !== null && <div className="muted small">{r.photos_without_gps} without GPS</div>}
                    </td>
                    <td>{r.submitted_by_name}</td>
                    <td>{r.prior_submissions > 0 ? r.prior_submissions : ""}</td>
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
