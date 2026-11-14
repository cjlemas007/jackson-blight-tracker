import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import CorrectionsClient from "@/components/admin/CorrectionsClient";
import { requirePageStaff } from "@/lib/auth/session";
import { listCorrections } from "@/lib/corrections";

export const dynamic = "force-dynamic";

export default async function CorrectionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const staff = await requirePageStaff("admin", "/admin/corrections");
  const { status = "open" } = await searchParams;
  const s = ["open", "corrected", "declined"].includes(status) ? status : "open";
  const rows = await listCorrections(s);
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap">
        <h1>Correction requests</h1>
        <nav className="tabs">
          {["open", "corrected", "declined"].map((t) => (
            <Link key={t} href={`/admin/corrections?status=${t}`} aria-current={t === s ? "page" : undefined}>{t[0].toUpperCase() + t.slice(1)}</Link>
          ))}
        </nav>
        <CorrectionsClient rows={JSON.parse(JSON.stringify(rows))} open={s === "open"} />
      </main>
    </div>
  );
}
