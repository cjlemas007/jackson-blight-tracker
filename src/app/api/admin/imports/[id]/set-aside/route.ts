import { handle, requireApiStaff } from "@/lib/auth/session";
import { setAsidePending } from "@/lib/imports";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireApiStaff(req, "admin");
  return Response.json({ batchId: await setAsidePending(admin, (await ctx.params).id) });
});
