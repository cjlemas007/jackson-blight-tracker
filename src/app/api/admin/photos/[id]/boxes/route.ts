import { handle, HttpError, requireApiStaff } from "@/lib/auth/session";
import { audit } from "@/lib/auth/staff";
import { getPool } from "@/lib/db";
import { setManualBoxes } from "@/lib/photos/process";
import { clampBox, type Box } from "@/lib/photos/render";

export const PUT = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireApiStaff(req, "admin");
  const id = (await ctx.params).id;
  const { boxes } = (await req.json()) as { boxes?: Box[] };
  if (!Array.isArray(boxes) || boxes.length > 100) throw new HttpError(400, "Invalid boxes.");
  const clean = boxes
    .map((b) => clampBox({ x: Number(b.x), y: Number(b.y), w: Number(b.w), h: Number(b.h), kind: "manual" }))
    .filter((b): b is Box => b !== null);
  const { rows } = await getPool().query(
    "SELECT s.status FROM app.photos p JOIN app.submissions s ON s.id = p.submission_id WHERE p.id = $1",
    [id],
  );
  if (!rows[0]) throw new HttpError(404, "Photo not found.");
  await setManualBoxes(id, clean);
  await audit(getPool(), admin.id, "photo.blur_boxes", "photo", id, { boxes: clean.length, submission_status: rows[0].status });
  return Response.json({ ok: true, boxes: clean });
});
