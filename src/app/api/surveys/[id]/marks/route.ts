import { handle, requireApiStaff } from "@/lib/auth/session";
import { markParcel, type SurveyResult } from "@/lib/surveys";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireApiStaff(req);
  const b = (await req.json()) as { parcelId?: string; result?: SurveyResult; submissionId?: string; note?: string };
  await markParcel(staff, (await ctx.params).id, {
    parcelId: String(b.parcelId ?? ""), result: b.result as SurveyResult, submissionId: b.submissionId || null, note: b.note || null,
  });
  return Response.json({ ok: true });
});
