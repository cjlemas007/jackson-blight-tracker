import EmbedFrame from "@/components/embed/EmbedFrame";
import { headline } from "@/lib/rankings";
import { blightRateLabel } from "@/lib/coverage";

export const dynamic = "force-dynamic";

const ALL = ["blighted", "demolished_week", "state_owned", "share", "resolved", "city_flagged"] as const;

/** /embed/counters?items=blighted,demolished_week&title=... */
export default async function EmbedCounters({ searchParams }: { searchParams: Promise<{ items?: string; title?: string }> }) {
  const sp = await searchParams;
  const want = (sp.items ?? "blighted,demolished_week,state_owned,resolved").split(",").filter((x) => (ALL as readonly string[]).includes(x));
  const h = await headline();
  const share = blightRateLabel(h.blighted, h.total_parcels, h.surveyed);
  const items: Record<string, { n: string; l: string; q?: string }> = {
    blighted: { n: h.blighted.toLocaleString(), l: "blighted parcels in Jackson" },
    demolished_week: { n: h.demolished_this_week.toLocaleString(), l: "demolished this week" },
    state_owned: { n: h.state_owned_blighted.toLocaleString(), l: "blighted parcels held by the State" },
    share: { n: share.replace(/^at least /, "≥ ").replace(" (reported so far)", ""), l: "of Jackson parcels blighted", q: share.includes("reported") ? "reported so far" : undefined },
    resolved: { n: h.resolved_to_date.toLocaleString(), l: "parcels resolved to date" },
    city_flagged: { n: h.city_flagged.toLocaleString(), l: "City-flagged, not yet verified" },
  };
  return (
    <EmbedFrame title={sp.title?.slice(0, 120)}>
      <div className="counters">
        {want.map((k) => (
          <div key={k} className="counter">
            <div className="n">{items[k].n}</div>
            <div className="l">{items[k].l}</div>
            {items[k].q && <div className="q">{items[k].q}</div>}
          </div>
        ))}
      </div>
    </EmbedFrame>
  );
}
