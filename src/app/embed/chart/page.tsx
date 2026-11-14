import EmbedFrame from "@/components/embed/EmbedFrame";
import { HBarChart, WeeklyColumns } from "@/components/embed/Charts";
import { AREA_KINDS, areaRankings, type AreaKind } from "@/lib/rankings";
import { weeklyTrend } from "@/lib/charts";
import { cityResponse } from "@/lib/cityResponse";

export const dynamic = "force-dynamic";

const STAGE: Record<string, string> = {
  cited: "Cited", hearing_set: "Hearing set", adjudicated: "Adjudicated", demolition_ordered: "Demolition ordered",
  lot_cleanup_ordered: "Lot cleanup ordered", lien_filed: "Lien filed",
};

/**
 * /embed/chart?type=areas&kind=ward|neighborhood|tract&top=10
 * /embed/chart?type=trend&weeks=12
 * /embed/chart?type=stages
 */
export default async function EmbedChart({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const title = sp.title?.slice(0, 120);
  if (sp.type === "trend") {
    const points = await weeklyTrend(Number(sp.weeks) || 12);
    return (
      <EmbedFrame title={title ?? "Each week in Jackson"} link="/city">
        <WeeklyColumns points={points as unknown as { week: string; [k: string]: number | string }[]} series={[
          { key: "verified", label: "Newly verified blighted", color: "#c62828" },
          { key: "city_actions", label: "City actions", color: "#f2a900" },
          { key: "demolished", label: "Demolished", color: "#2e7d32" },
        ]} />
      </EmbedFrame>
    );
  }
  if (sp.type === "stages") {
    const r = await cityResponse();
    return (
      <EmbedFrame title={title ?? "Parcels at each stage of City action"} link="/city">
        <HBarChart color="#f2a900" rows={r.stages.map((s) => ({ label: STAGE[s.substatus], value: s.parcels }))} />
      </EmbedFrame>
    );
  }
  const kind = ((AREA_KINDS as readonly string[]).includes(sp.kind ?? "") ? sp.kind : "ward") as AreaKind;
  const top = Math.min(30, Math.max(3, Number(sp.top) || 10));
  const rows = (await areaRankings(kind)).slice(0, top);
  const label = kind === "ward" ? "ward" : kind === "neighborhood" ? "neighborhood" : "census tract";
  return (
    <EmbedFrame title={title ?? `Verified blighted parcels by ${label}`} link={`/areas?kind=${kind}`}>
      <HBarChart
        rows={rows.map((r) => ({ label: r.name, value: r.blighted }))}
        note={(i) => (rows[i].fully_surveyed ? `${(rows[i].share_blighted * 100).toFixed(1)}% of parcels` : "reported so far")}
      />
      {kind === "neighborhood" && <div style={{ fontSize: 11, color: "#5f6675" }}>Neighborhood boundaries are unofficial.</div>}
    </EmbedFrame>
  );
}
