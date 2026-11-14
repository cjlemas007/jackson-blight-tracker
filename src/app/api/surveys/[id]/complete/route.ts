import { handle, requireApiStaff } from "@/lib/auth/session";
import { completeSurvey } from "@/lib/surveys";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireApiStaff(req);
  await completeSurvey(staff, (await ctx.params).id);
  return Response.json({ ok: true });
});
