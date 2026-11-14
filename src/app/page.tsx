import MapApp from "@/components/MapApp";
import { getFilterOptions } from "@/lib/parcels";
import { SITE_NAME } from "@/config";

export const dynamic = "force-dynamic";

export default async function Home() {
  const options = await getFilterOptions();
  return <MapApp siteName={SITE_NAME} options={options} />;
}
