import { logout } from "@/lib/auth/staff";
import { clearSessionCookie, sessionToken } from "@/lib/auth/session";

export async function POST() {
  await logout(await sessionToken());
  await clearSessionCookie();
  return Response.json({ ok: true });
}
