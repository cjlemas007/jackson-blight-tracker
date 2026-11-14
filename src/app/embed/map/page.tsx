import EmbedMap from "@/components/embed/EmbedMapClient";

export const dynamic = "force-dynamic";

const STATUSES = ["verified_blighted", "city_action", "city_flagged", "resolved"];

/** /embed/map?ward=3&status=verified_blighted,city_action&parcel=401-98&z=16&c=32.30,-90.20 */
export default async function EmbedMapPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const statuses = (sp.status ?? "verified_blighted,city_action,resolved").split(",").filter((s) => STATUSES.includes(s));
  const [lat, lon] = (sp.c ?? "").split(",").map(Number);
  const center: [number, number] | null = Number.isFinite(lat) && Number.isFinite(lon) && sp.c ? [lon, lat] : null;
  const z = Number(sp.z);
  return (
    <div style={{ height: "100dvh" }}>
      <EmbedMap ward={sp.ward && /^\d+$/.test(sp.ward) ? sp.ward : null} statuses={statuses.length ? statuses : STATUSES}
        parcel={sp.parcel ?? null} zoom={Number.isFinite(z) && z > 0 ? z : null} center={center} />
    </div>
  );
}
