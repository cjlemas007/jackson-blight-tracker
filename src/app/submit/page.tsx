import SiteHeader from "@/components/SiteHeader";
import SubmitFlow, { type ResumeInfo } from "@/components/SubmitFlow";
import { requirePageStaff } from "@/lib/auth/session";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SubmitPage({ searchParams }: { searchParams: Promise<{ resume?: string; parcel?: string }> }) {
  const { resume, parcel } = await searchParams;
  const staff = await requirePageStaff("contributor", resume ? `/submit?resume=${resume}` : "/submit");

  let info: ResumeInfo | null = null;
  if (resume && /^[0-9a-f-]{36}$/.test(resume)) {
    const rows = await query<{
      id: string; parcel_id: string; situs_address: string | null; owner_name: string | null; status: string;
      review_reason: string | null; conditions: string[]; note: string | null; photo_count: number;
    }>(
      `SELECT s.id, s.parcel_id, f.situs_address, f.owner_name, s.review_reason, s.conditions, s.note,
              COALESCE(cur.status::text, 'unreported') AS status,
              (SELECT count(*)::int FROM app.photos p WHERE p.submission_id = s.id) AS photo_count
       FROM app.submissions s
       LEFT JOIN app.parcel_facts f USING (county, parcel_id)
       LEFT JOIN app.parcel_status_current cur USING (county, parcel_id)
       WHERE s.id = $1 AND s.submitted_by = $2 AND s.status = 'needs_photo'`,
      [resume, staff.id],
    );
    const r = rows[0];
    if (r) {
      info = {
        submissionId: r.id,
        parcel: { parcel_id: r.parcel_id, situs_address: r.situs_address, owner_name: r.owner_name, status: r.status === "submitted" ? "unreported" : r.status },
        reason: r.review_reason,
        conditions: r.conditions,
        note: r.note,
        existingPhotos: r.photo_count,
      };
    }
  }

  let initial: ResumeInfo["parcel"] | null = null;
  if (!info && parcel) {
    const rows = await query<{ parcel_id: string; situs_address: string | null; owner_name: string | null; status: string }>(
      `SELECT parcel_id, situs_address, owner_name,
              CASE WHEN status = 'submitted' THEN 'unreported'
                   WHEN status = 'city_action' AND NOT ever_verified THEN 'city_flagged' ELSE status::text END AS status
       FROM app.parcels WHERE county = 'Hinds' AND parcel_id = $1 AND in_city`,
      [parcel],
    );
    initial = rows[0] ?? null;
  }

  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap">
        <h1>{info ? "Add a better photo" : "Submit a blighted property"}</h1>
        <SubmitFlow resume={info} initialParcel={initial} />
      </main>
    </div>
  );
}
