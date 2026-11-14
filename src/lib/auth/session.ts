import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_DAYS, staffForToken, type Role, type Staff } from "./staff";
import { WorkflowError } from "../submissions";

export const SESSION_COOKIE = "jbt_session";

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function currentStaff(): Promise<Staff | null> {
  return staffForToken(await sessionToken());
}

/** For pages: redirect to sign-in (or password change) unless the staff member qualifies. */
export async function requirePageStaff(role: Role = "contributor", next = "/"): Promise<Staff> {
  const s = await currentStaff();
  if (!s) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (s.must_change_password) redirect(`/account/password?next=${encodeURIComponent(next)}`);
  if (role === "admin" && s.role !== "admin") redirect("/");
  return s;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * For API routes: the caller must be signed in (and an admin if asked), and a state-changing
 * request must come from this site (Origin check on top of SameSite=Lax cookies).
 */
export async function requireApiStaff(req: Request, role: Role = "contributor"): Promise<Staff> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!origin || !host || new URL(origin).host !== host) throw new HttpError(403, "Cross-site request refused.");
  }
  const s = await currentStaff();
  if (!s) throw new HttpError(401, "Sign in first.");
  if (s.must_change_password) throw new HttpError(403, "Change your temporary password first.");
  if (role === "admin" && s.role !== "admin") throw new HttpError(403, "Admins only.");
  return s;
}

/** Wrap a route handler so HttpErrors become JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof WorkflowError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }
  };
}
