import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import AgendaForm from "@/components/admin/AgendaForm";
import { requirePageStaff } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const staff = await requirePageStaff("admin", "/admin/agenda");
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap">
        <Link href="/admin/city" className="muted small">← City actions</Link>
        <h1>Council agenda quick entry</h1>
        <AgendaForm />
      </main>
    </div>
  );
}
