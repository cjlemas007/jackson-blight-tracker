import { handle, HttpError, requireApiStaff } from "@/lib/auth/session";
import { photoSlotForUpload, WorkflowError } from "@/lib/submissions";
import { storage } from "@/lib/storage";
import { MAX_PHOTO_BYTES } from "@/lib/approval";
import { documentSlotForUpload, MAX_DOC_BYTES } from "@/lib/documents";

/** Development upload target (production uploads go straight to Supabase signed URLs). */
export const PUT = handle(async (req: Request, ctx: { params: Promise<{ key: string[] }> }) => {
  if (process.env.SUPABASE_URL) throw new HttpError(404, "Not found.");
  const staff = await requireApiStaff(req);
  const key = (await ctx.params).key.join("/");
  try {
    const slot = key.startsWith("docs/")
      ? await documentSlotForUpload(staff, key)
      : await photoSlotForUpload(staff, key);
    const body = Buffer.from(await req.arrayBuffer());
    if (!body.length || body.length > (key.startsWith("docs/") ? MAX_DOC_BYTES : MAX_PHOTO_BYTES)) throw new HttpError(400, "Empty or oversized file.");
    await storage().put(key, body, slot.mime_type);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof WorkflowError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
