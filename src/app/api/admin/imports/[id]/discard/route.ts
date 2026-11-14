import { handle, requireApiStaff } from "@/lib/auth/session";
import { discardBatch } from "@/lib/imports";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireApiStaff(req, "admin");
  await discardBatch(admin, (await ctx.params).id);
  return Response.json({ ok: true });
});
