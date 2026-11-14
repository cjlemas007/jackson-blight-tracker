import Link from "next/link";
import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import ImportClient from "@/components/admin/ImportClient";
import { requirePageStaff } from "@/lib/auth/session";
import { batchDetail, KIND_DEFAULTS, type ImportKind } from "@/lib/imports";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePageStaff("admin", `/admin/imports/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const b = await batchDetail(id);
  if (!b) notFound();
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap wide">
        <Link href="/admin/imports" className="muted small">← Imports</Link>
        <h1>{b.title}</h1>
        <div className="muted">
          {KIND_DEFAULTS[b.kind as ImportKind].label}
          {b.document_id && <> · <a href={`/api/documents/${b.document_id}`}>{b.document_name}</a></>}
        </div>
        <ImportClient batch={JSON.parse(JSON.stringify(b))} />
      </main>
    </div>
  );
}
