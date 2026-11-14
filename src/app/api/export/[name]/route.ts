import { currentStaff } from "@/lib/auth/session";
import { buildExport, exportToCsv, EXPORTS, STAFF_EXPORTS, type ExportName } from "@/lib/exports";

export const dynamic = "force-dynamic";

/** /api/export/<table>.csv?<same filters as the page> */
export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const name = (await ctx.params).name.replace(/\.csv$/, "") as ExportName;
  if (!EXPORTS.includes(name)) return new Response("unknown export", { status: 404 });
  if (STAFF_EXPORTS.includes(name)) {
    const s = await currentStaff();
    if (!s || s.must_change_password) return new Response("sign in", { status: 401 });
  }
  const e = await buildExport(name, new URL(req.url).searchParams);
  if (!e) return new Response("not found", { status: 404 });
  return new Response(exportToCsv(e), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${e.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
