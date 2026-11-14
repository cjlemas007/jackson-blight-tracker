import { handle, HttpError, requireApiStaff } from "@/lib/auth/session";
import { resetPassword, setRoleAndActive } from "@/lib/auth/staff";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireApiStaff(req, "admin");
  const id = (await ctx.params).id;
  const body = (await req.json()) as { action?: string; role?: string; active?: boolean };
  if (body.action === "reset") {
    return Response.json({ temporaryPassword: await resetPassword(id, admin.id) });
  }
  if (body.action === "update") {
    if (body.role !== "admin" && body.role !== "contributor") throw new HttpError(400, "Pick a role.");
    if (id === admin.id && (body.role !== "admin" || body.active === false)) {
      throw new HttpError(400, "You can't remove your own admin access.");
    }
    await setRoleAndActive(id, body.role, body.active !== false, admin.id);
    return Response.json({ ok: true });
  }
  throw new HttpError(400, "Unknown action.");
});
