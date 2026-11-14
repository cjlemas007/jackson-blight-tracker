import { currentStaff } from "@/lib/auth/session";
import { getDocument } from "@/lib/documents";
import { storage } from "@/lib/storage";

/** Public documents (agendas, city records) for everyone; private ones (records-request CSVs) for admins. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("not found", { status: 404 });
  const d = await getDocument(id);
  if (!d || !d.uploaded_at) return new Response("not found", { status: 404 });
  if (!d.public) {
    const s = await currentStaff();
    if (s?.role !== "admin" || s.must_change_password) return new Response("not found", { status: 404 });
  }
  const body = await storage().get(d.storage_key);
  if (!body) return new Response("not found", { status: 404 });
  const filename = (d.original_name || "document").replace(/[^\w.\- ]+/g, "_");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": d.mime_type,
      "Content-Disposition": `${d.mime_type === "application/pdf" ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": d.public ? "public, max-age=3600" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
