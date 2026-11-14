import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SuggestionsClient from "@/components/admin/SuggestionsClient";
import { requirePageStaff } from "@/lib/auth/session";
import { openSuggestions } from "@/lib/suggestions";

export const dynamic = "force-dynamic";

export default async function SuggestionsPage() {
  const staff = await requirePageStaff("admin", "/admin/suggestions");
  const rows = await openSuggestions();
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap">
        <Link href="/admin/city" className="muted small">← City actions</Link>
        <h1>Land roll suggestions</h1>
        <p className="muted" style={{ margin: 0 }}>
          Changes the nightly sync found on verified parcels. A new owner or improvements valued at $0 can mean a sale, a
          repair, or a demolition, so check before recording anything.
        </p>
        <SuggestionsClient rows={JSON.parse(JSON.stringify(rows))} />
      </main>
    </div>
  );
}
