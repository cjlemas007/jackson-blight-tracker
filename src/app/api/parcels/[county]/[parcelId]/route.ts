import { getParcel } from "@/lib/parcels";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ county: string; parcelId: string }> }) {
  const { county, parcelId } = await params;
  const parcel = await getParcel(decodeURIComponent(county), decodeURIComponent(parcelId));
  if (!parcel) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(parcel);
}
