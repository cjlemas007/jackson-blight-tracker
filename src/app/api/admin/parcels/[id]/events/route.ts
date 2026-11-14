import { handle, requireApiStaff } from "@/lib/auth/session";
import { addEvent, type EventInput } from "@/lib/parcelAdmin";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireApiStaff(req, "admin");
  const b = (await req.json()) as Omit<EventInput, "parcelId">;
  const id = await addEvent(admin, { ...b, parcelId: decodeURIComponent((await ctx.params).id) });
  return Response.json({ id });
});
