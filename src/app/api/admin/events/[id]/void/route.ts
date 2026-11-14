import { handle, HttpError, requireApiStaff } from "@/lib/auth/session";
import { voidEvent } from "@/lib/parcelAdmin";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireApiStaff(req, "admin");
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Bad entry.");
  const { reason } = (await req.json()) as { reason?: string };
  await voidEvent(admin, id, String(reason ?? ""));
  return Response.json({ ok: true });
});
