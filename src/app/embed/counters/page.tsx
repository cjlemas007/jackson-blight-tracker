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
    blighted: { n: h.blighted.toLocaleString(), l: "verified blighted parcels in Jackson" },
    demolished_week: { n: h.demolished_this_week.toLocaleString(), l: "demolished this week" },
    state_owned: { n: h.state_owned_blighted.toLocaleString(), l: "blighted parcels held by the State" },
    share: { n: share.replace(/^at least /, "≥ ").replace(" (reported so far)", ""), l: "of Jackson parcels verified blighted", q: share.includes("reported") ? "reported so far" : undefined },
    resolved: { n: h.resolved_to_date.toLocaleString(), l: "parcels resolved to date" },
    city_flagged: { n: h.city_flagged.toLocaleString(), l: "City-flagged, not yet verified" },
  };
  return (
    <EmbedFrame title={sp.title?.slice(0, 120)}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(140px, 1fr))`, gap: 10 }}>
        {want.map((k) => (
          <div key={k} style={{ border: "1px solid #e2ded5", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>{items[k].n}</div>
            <div style={{ fontSize: 13, color: "#5f6675" }}>{items[k].l}</div>
            {items[k].q && <div style={{ fontSize: 11, color: "#5f6675", fontStyle: "italic" }}>{items[k].q}</div>}
          </div>
        ))}
      </div>
    </EmbedFrame>
  );
}
