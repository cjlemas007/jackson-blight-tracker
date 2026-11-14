import { searchParcels } from "@/lib/parcels";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.trim().length < 2) return Response.json([]);
  return Response.json(await searchParcels(q));
}
