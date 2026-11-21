import { NextResponse, type NextRequest } from "next/server";

// Pre-launch lock. When SITE_PASSWORD is set (Netlify env var), visitors see a one-field password
// page; the right password sets a cookie for 30 days. Delete the variable to open the site.
// (Netlify's own password protection needs a paid plan. A cookie is used rather than the browser's
// basic-auth box because some browsers don't attach basic-auth to fetch() calls, which broke staff
// sign-in.)

const COOKIE = "site_lock";
const UNLOCK_PATH = "/__unlock";

async function lockToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`jbt-site-lock:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/");

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function lockPage(next: string, wrong: boolean): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Jackson Blight Tracker (preview)</title>
<style>
:root{color-scheme:light dark;--bg:#f6f3ec;--ink:#1a1a1a;--muted:#5b5b5b;--rule:#cfc8b8;--accent:#b3122a}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--ink:#e9e6df;--muted:#a3a7ad;--rule:#3a3f46;--accent:#ff5c6c}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 Georgia,serif;padding:16px}
form{width:100%;max-width:360px;border-top:3px solid var(--ink);padding-top:16px}
h1{font-size:26px;margin:0 0 6px}p{margin:0 0 16px;color:var(--muted);font:14px/1.5 system-ui,sans-serif}
label{display:block;font:600 13px system-ui,sans-serif;margin-bottom:6px}
input{width:100%;box-sizing:border-box;font:16px system-ui,sans-serif;padding:10px;border:1px solid var(--rule);background:transparent;color:inherit;border-radius:4px}
button{margin-top:12px;width:100%;font:600 15px system-ui,sans-serif;padding:11px;border:0;border-radius:4px;background:var(--ink);color:var(--bg);cursor:pointer}
.err{color:var(--accent);font:600 14px system-ui,sans-serif;margin:10px 0 0}
</style></head><body>
<form method="post" action="${UNLOCK_PATH}">
<h1>Jackson Blight Tracker</h1>
<p>This site isn't public yet. Enter the preview password to continue.</p>
<input type="hidden" name="next" value="${escapeHtml(next)}">
<label for="pw">Preview password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
${wrong ? '<p class="err" role="alert">That password isn\'t right.</p>' : ""}
<button type="submit">Continue</button>
</form></body></html>`;
  return new NextResponse(html, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function proxy(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();
  const expected = await lockToken(password);

  const { pathname, search } = req.nextUrl;
  if (pathname === UNLOCK_PATH && req.method === "POST") {
    const form = await req.formData().catch(() => null);
    const given = String(form?.get("password") ?? "");
    const next = safeNext(form?.get("next"));
    if (!sameText(await lockToken(given), expected)) return lockPage(next, true);
    const res = NextResponse.redirect(new URL(next, req.url), 303);
    res.cookies.set(COOKIE, expected, {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }

  if (sameText(req.cookies.get(COOKIE)?.value ?? "", expected)) return NextResponse.next();

  if (req.method === "GET" && !pathname.startsWith("/api/")) return lockPage(pathname + search, false);
  return NextResponse.json({ error: "This site isn't public yet." }, { status: 401 });
}

export const config = {
  // /.netlify/functions/* (photo worker) is called server-to-server and checks its own secret.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|\\.netlify/).*)"],
};
