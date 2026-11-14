import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import ReviewClient from "@/components/ReviewClient";
import { requirePageStaff } from "@/lib/auth/session";
import { submissionDetail } from "@/lib/submissions";
import { APPROVAL_STANDARD, CONDITIONS } from "@/lib/approval";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePageStaff("admin", `/admin/submissions/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await submissionDetail(id);
  if (!d) notFound();
  // Dates and Date objects -> strings for the client component.
  const data = JSON.parse(JSON.stringify(d));
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap wide">
        <ReviewClient data={data} standard={[...APPROVAL_STANDARD]} conditions={[...CONDITIONS]} />
      </main>
    </div>
  );
}
