import { submitCorrection, submitterHash } from "@/lib/corrections";
import { WorkflowError } from "@/lib/submissions";

/** Public: anyone can request a correction. Honeypot field `website` must stay empty. */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
    return Response.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as Record<string, string | undefined>;
  if (b.website) return Response.json({ ok: true }); // bots fill every field; quietly drop
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  try {
    const id = await submitCorrection(
      {
        parcelId: b.parcelId || null, portfolioId: b.portfolioId || null, category: String(b.category ?? ""),
        details: String(b.details ?? ""), name: b.name || null, email: b.email || null, pageUrl: b.pageUrl || null,
      },
      submitterHash(ip, req.headers.get("user-agent") ?? ""),
    );
    return Response.json({ ok: true, id });
  } catch (e) {
    if (e instanceof WorkflowError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
