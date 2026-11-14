import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import NewImportForm from "@/components/admin/NewImportForm";
import { requirePageStaff } from "@/lib/auth/session";
import { KIND_DEFAULTS, listBatches, type ImportKind } from "@/lib/imports";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { mapping: "Pick columns", review: "In review", applied: "Applied", discarded: "Discarded" };

export default async function ImportsPage() {
  const staff = await requirePageStaff("admin", "/admin/imports");
  const batches = await listBatches();
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap wide">
        <Link href="/admin/city" className="muted small">← City actions</Link>
        <h1>Import city records</h1>
        <NewImportForm />
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Created</th><th>Import</th><th>Type</th><th className="num">Rows</th><th>Status</th><th>By</th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="small">{new Date(b.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short", timeStyle: "short" })}</td>
                  <td><Link href={`/admin/imports/${b.id}`}><strong>{b.title}</strong></Link></td>
                  <td className="small">{KIND_DEFAULTS[b.kind as ImportKind]?.label}</td>
                  <td className="num">{b.row_count}</td>
                  <td>
                    <span className={`pill ${b.status === "applied" ? "approved" : b.status === "discarded" ? "rejected" : "pending"}`}>{STATUS[b.status]}</span>
                    {b.status === "review" && b.pending > 0 && <div className="muted small">{b.pending} need a decision</div>}
                  </td>
                  <td className="small">{b.created_by_name}</td>
                </tr>
              ))}
              {!batches.length && <tr><td colSpan={6} className="muted">No imports yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
