import { handle, HttpError, requireApiStaff } from "@/lib/auth/session";
import { resolveSuggestion } from "@/lib/suggestions";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireApiStaff(req, "admin");
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Bad suggestion.");
  const b = (await req.json()) as { action?: string; status?: string; substatus?: string; date?: string; note?: string };
  if (b.action === "dismiss") await resolveSuggestion(admin, id, { action: "dismiss" });
  else if (b.action === "record") {
    await resolveSuggestion(admin, id, { action: "record", status: String(b.status), substatus: b.substatus || null, date: String(b.date ?? ""), note: b.note });
  } else throw new HttpError(400, "Unknown action.");
  return Response.json({ ok: true });
});
