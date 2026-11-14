import { handle, requireApiStaff } from "@/lib/auth/session";
import { review, WorkflowError, type ReviewAction } from "@/lib/submissions";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireApiStaff(req, "admin");
  const body = (await req.json()) as ReviewAction;
  try {
    await review(admin, (await ctx.params).id, body);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof WorkflowError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
