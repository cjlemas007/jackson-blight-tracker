import MapApp from "@/components/MapApp";
import { getFilterOptions } from "@/lib/parcels";
import { headline } from "@/lib/rankings";
import SiteHeader from "@/components/SiteHeader";
import { currentStaff } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [options, staff, h, sp] = await Promise.all([getFilterOptions(), currentStaff(), headline(), searchParams]);
  const search = Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  return (
    <MapApp
      header={<SiteHeader staff={staff && !staff.must_change_password ? staff : null} full />}
      options={options}
      headline={h}
      search={search}
    />
  );
}
