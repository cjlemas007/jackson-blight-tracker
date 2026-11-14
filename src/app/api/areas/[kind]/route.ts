import { AREA_KINDS, areaGeoJson, type AreaKind } from "@/lib/rankings";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(AREA_KINDS as readonly string[]).includes(kind)) return Response.json({ error: "unknown area kind" }, { status: 404 });
  return Response.json(await areaGeoJson(kind as AreaKind), { headers: { "Cache-Control": "public, max-age=300" } });
}
