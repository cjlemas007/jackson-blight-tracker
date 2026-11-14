import { handle, requireApiStaff } from "@/lib/auth/session";
import { mapBatch, type Mapping } from "@/lib/imports";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireApiStaff(req, "admin");
  const b = (await req.json()) as { mapping?: Mapping; defaultDate?: string; substatus?: string };
  return Response.json(await mapBatch(admin, (await ctx.params).id, { mapping: b.mapping ?? {}, defaultDate: b.defaultDate || null, substatus: b.substatus || null }));
});
