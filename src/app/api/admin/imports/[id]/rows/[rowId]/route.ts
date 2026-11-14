import { handle, HttpError, requireApiStaff } from "@/lib/auth/session";
import { updateRow } from "@/lib/imports";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ rowId: string }> }) => {
  const admin = await requireApiStaff(req, "admin");
  const rowId = Number((await ctx.params).rowId);
  if (!Number.isInteger(rowId)) throw new HttpError(400, "Bad row.");
  const b = (await req.json()) as { parcelId?: string | null; decision?: "accepted" | "skipped" | "pending"; substatus?: string; date?: string };
  if (!b.decision || !["accepted", "skipped", "pending"].includes(b.decision)) throw new HttpError(400, "Pick accept or skip.");
  await updateRow(admin, rowId, { parcelId: b.parcelId, decision: b.decision, substatus: b.substatus || null, date: b.date || null });
  return Response.json({ ok: true });
});
