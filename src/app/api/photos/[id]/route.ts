import { getPool } from "@/lib/db";
import { currentStaff } from "@/lib/auth/session";
import { removePhoto, WorkflowError } from "@/lib/submissions";
import { handle, requireApiStaff } from "@/lib/auth/session";
import { storage } from "@/lib/storage";

/**
 * ?v=public (default): blurred copy, only once the submission is approved.
 * ?v=preview: blurred copy before approval, for the submitter and admins.
 * ?v=original: the untouched upload, admins only (to spot faces the detector missed).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("not found", { status: 404 });
  const v = new URL(req.url).searchParams.get("v") ?? "public";
  const { rows } = await getPool().query<{
    original_key: string; processed_key: string | null; mime_type: string; status: string; submitted_by: string;
  }>(
    `SELECT p.original_key, p.processed_key, p.mime_type, s.status, s.submitted_by
     FROM app.photos p JOIN app.submissions s ON s.id = p.submission_id WHERE p.id = $1`,
    [id],
  );
  const p = rows[0];
  if (!p) return new Response("not found", { status: 404 });

  let key: string | null = null;
  let cache = "private, no-store";
  if (v === "public") {
    if (p.status !== "approved" || !p.processed_key) return new Response("not found", { status: 404 });
    key = p.processed_key;
    cache = "public, max-age=3600";
  } else {
    const staff = await currentStaff();
    const isAdmin = staff?.role === "admin" && !staff.must_change_password;
    if (v === "preview" && (isAdmin || staff?.id === p.submitted_by)) key = p.processed_key;
    if (v === "original" && isAdmin) key = p.original_key;
    if (!staff) return new Response("sign in", { status: 401 });
    if (!key) return new Response("not found", { status: 404 });
  }
  const body = await storage().get(key);
  if (!body) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": key === p.original_key ? p.mime_type : "image/jpeg",
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const DELETE = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireApiStaff(req);
  try {
    await removePhoto(staff, (await ctx.params).id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof WorkflowError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
