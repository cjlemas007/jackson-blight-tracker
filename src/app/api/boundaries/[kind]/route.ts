import { getBoundaryGeoJson } from "@/lib/parcels";

export const dynamic = "force-dynamic";
const KINDS = new Set(["city_limits", "ward", "neighborhood", "zip", "tract"]);

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!KINDS.has(kind)) return Response.json({ error: "unknown boundary kind" }, { status: 404 });
  return Response.json(await getBoundaryGeoJson(kind), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
