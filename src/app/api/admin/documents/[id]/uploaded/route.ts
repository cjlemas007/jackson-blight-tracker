import { handle, requireApiStaff } from "@/lib/auth/session";
import { markDocumentUploaded } from "@/lib/documents";
import { storage } from "@/lib/storage";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireApiStaff(req, "admin");
  await markDocumentUploaded((await ctx.params).id, (k) => storage().exists(k));
  return Response.json({ ok: true });
});
