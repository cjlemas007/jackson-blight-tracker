import { handle, requireApiStaff } from "@/lib/auth/session";
import { addPhotoSlot, WorkflowError } from "@/lib/submissions";
import { storage } from "@/lib/storage";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireApiStaff(req);
  const { id } = await ctx.params;
  const { name, mime, bytes } = (await req.json()) as { name?: string; mime?: string; bytes?: number };
  try {
    const slot = await addPhotoSlot(staff, id, { name: String(name ?? "photo"), mime: String(mime ?? ""), bytes: Number(bytes ?? 0) });
    const upload = await storage().uploadTarget(slot.key, String(mime));
    return Response.json({ photoId: slot.photoId, upload });
  } catch (e) {
    if (e instanceof WorkflowError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
