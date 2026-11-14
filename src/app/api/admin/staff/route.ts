import { handle, HttpError, requireApiStaff } from "@/lib/auth/session";
import { createStaff } from "@/lib/auth/staff";

export const POST = handle(async (req: Request) => {
  const admin = await requireApiStaff(req, "admin");
  const { email, name, role } = (await req.json()) as { email?: string; name?: string; role?: string };
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Enter a valid email.");
  if (!name?.trim()) throw new HttpError(400, "Enter a name.");
  if (role !== "admin" && role !== "contributor") throw new HttpError(400, "Pick a role.");
  try {
    const r = await createStaff({ email, name, role }, admin.id);
    return Response.json({ staff: r.staff, temporaryPassword: r.temporaryPassword });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "There's already an account for that email.");
    throw e;
  }
});
