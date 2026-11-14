import MapApp from "@/components/MapApp";
import { getFilterOptions } from "@/lib/parcels";
import { SITE_NAME } from "@/config";
import { currentStaff } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [options, staff] = await Promise.all([getFilterOptions(), currentStaff()]);
  return (
    <MapApp
      siteName={SITE_NAME}
      options={options}
      staff={staff && !staff.must_change_password ? { name: staff.name, role: staff.role } : null}
    />
  );
}
