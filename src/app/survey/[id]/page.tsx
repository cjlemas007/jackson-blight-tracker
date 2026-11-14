import Link from "next/link";
import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SurveyRun from "@/components/SurveyRun";
import { requirePageStaff } from "@/lib/auth/session";
import { getSurvey } from "@/lib/surveys";

export const dynamic = "force-dynamic";

export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePageStaff("contributor", `/survey/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await getSurvey(id);
  if (!s) notFound();
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap">
        <Link href="/survey" className="muted small">← Surveys</Link>
        <h1>{s.scope_label}</h1>
        <SurveyRun surveyId={id} finished={!!s.completed_at} />
      </main>
    </div>
  );
}
