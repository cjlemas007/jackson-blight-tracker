import Link from "next/link";
import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import ParcelAdminClient from "@/components/admin/ParcelAdminClient";
import { requirePageStaff } from "@/lib/auth/session";
import { adminParcel } from "@/lib/parcelAdmin";

export const dynamic = "force-dynamic";

export default async function ParcelAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const staff = await requirePageStaff("admin", `/admin/parcels/${encodeURIComponent(id)}`);
  const p = await adminParcel(id);
  if (!p) notFound();
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap wide">
        <Link href="/admin/parcels" className="muted small">← Parcels</Link>
        <h1>{p.situs_address ?? id}</h1>
        <div className="muted">
          Parcel {id} · {p.owner_name ?? "Owner unknown"} · Ward {p.ward ?? "—"} · <a href={`/?parcel=${encodeURIComponent(id)}`}>map</a> ·{" "}
          <a href={`/owners/${encodeURIComponent(p.portfolio_id)}`}>owner</a>
          {p.on_state_list && ` · on the SOS tax-forfeited list (${p.state_list_date})`}
        </div>
        <ParcelAdminClient parcel={JSON.parse(JSON.stringify(p))} />
      </main>
    </div>
  );
}
