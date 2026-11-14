import { handle, requireApiStaff } from "@/lib/auth/session";
import { applyBatch } from "@/lib/imports";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireApiStaff(req, "admin");
  return Response.json(await applyBatch(admin, (await ctx.params).id));
});
