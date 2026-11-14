import { changePassword } from "@/lib/auth/staff";
import { currentStaff } from "@/lib/auth/session";

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
    return Response.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  // Allowed while must_change_password is set (that's the point of this route).
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { current, next } = (await req.json().catch(() => ({}))) as { current?: string; next?: string };
  const problem = await changePassword(staff.id, current ?? "", next ?? "");
  if (problem) return Response.json({ error: problem }, { status: 400 });
  return Response.json({ ok: true });
}
