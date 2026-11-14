import { handle, requireApiStaff } from "@/lib/auth/session";
import { submit, WorkflowError } from "@/lib/submissions";
import { storage } from "@/lib/storage";
import { enqueueProcessing } from "@/lib/photos/queue";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireApiStaff(req);
  const { id } = await ctx.params;
  const body = (await req.json()) as { conditions?: string[]; note?: string; vantageConfirmed?: boolean };
  try {
    await submit(
      staff,
      id,
      { conditions: body.conditions ?? [], note: body.note, vantageConfirmed: !!body.vantageConfirmed },
      (key) => storage().exists(key),
    );
  } catch (e) {
    if (e instanceof WorkflowError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  enqueueProcessing(id);
  return Response.json({ ok: true });
});
