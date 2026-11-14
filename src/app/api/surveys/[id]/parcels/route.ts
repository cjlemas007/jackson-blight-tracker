import { handle, requireApiStaff } from "@/lib/auth/session";
import { surveyParcels, surveyProgress } from "@/lib/surveys";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireApiStaff(req);
  const id = (await ctx.params).id;
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  const near = sp.has("lat") && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  const [rows, progress] = await Promise.all([
    surveyParcels(id, { near, todoOnly: sp.get("todo") === "1", offset: Math.max(0, Number(sp.get("offset")) || 0) }),
    surveyProgress(id),
  ]);
  return Response.json({ rows, progress });
});
