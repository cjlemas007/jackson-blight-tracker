import { login } from "@/lib/auth/staff";
import { setSessionCookie } from "@/lib/auth/session";

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
    return Response.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!email || !password) return Response.json({ error: "Enter your email and password." }, { status: 400 });
  const r = await login(email, password);
  if (!r.ok) return Response.json({ error: r.error }, { status: 401 });
  await setSessionCookie(r.token);
  return Response.json({ mustChangePassword: r.staff.must_change_password, role: r.staff.role });
}
