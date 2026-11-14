import { getMapTile, getStatusPointsTile } from "@/lib/parcels";

export const dynamic = "force-dynamic";

const MIN_ZOOM = 14; // parcels are too dense to be useful below this

export async function GET(_req: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const [zi, xi, yi] = [z, x, y].map((v) => Number.parseInt(v, 10));
  if (![zi, xi, yi].every(Number.isInteger) || zi < 0 || zi > 22 || xi < 0 || yi < 0 || xi >= 2 ** zi || yi >= 2 ** zi) {
    return new Response("bad tile", { status: 400 });
  }
  const body = zi < MIN_ZOOM ? await getStatusPointsTile(zi, xi, yi) : await getMapTile(zi, xi, yi);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.mapbox-vector-tile",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
