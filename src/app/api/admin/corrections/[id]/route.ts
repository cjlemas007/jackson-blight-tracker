import { handle, HttpError, requireApiStaff } from "@/lib/auth/session";
import { resolveCorrection } from "@/lib/corrections";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireApiStaff(req, "admin");
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Bad request.");
  const b = (await req.json()) as { status?: "corrected" | "declined"; resolution?: string };
  await resolveCorrection(admin, id, b.status as "corrected" | "declined", String(b.resolution ?? ""));
  return Response.json({ ok: true });
});
