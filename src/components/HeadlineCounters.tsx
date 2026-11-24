import type { Headline } from "@/lib/rankings";
import { blightRateLabel, coverageLabel } from "@/lib/coverage";

/** The five headline counters from the spec. Server-rendered; numbers come from the status history. */
export default function HeadlineCounters({ h, compact = false }: { h: Headline; compact?: boolean }) {
  const rate = blightRateLabel(h.blighted, h.total_parcels, h.surveyed);
  const items = [
    { n: h.blighted.toLocaleString(), l: "blighted parcels" },
    { n: h.demolished_this_week.toLocaleString(), l: "demolished this week" },
    { n: h.state_owned_blighted.toLocaleString(), l: "state-owned blighted parcels" },
    {
      n: rate.replace(/^at least /, "≥ ").replace(" (reported so far)", ""),
      l: "of Jackson parcels blighted",
      q: rate.includes("reported so far") ? `Reported so far; ${coverageLabel(h.surveyed, h.total_parcels)}.` : undefined,
    },
    { n: h.resolved_to_date.toLocaleString(), l: "parcels resolved to date" },
    {
      n: h.city_flagged.toLocaleString(),
      l: "City-flagged, not yet checked by the newsroom",
      q: "Cited or adjudicated by the City; not counted as verified blight until our staff checks them.",
    },
  ];
  return (
    <div className="counters" aria-label="Headline figures">
      {items.map((i) => (
        <div className="counter" key={i.l}>
          <div className="n">{i.n}</div>
          <div className="l">{i.l}</div>
          {i.q && !compact && <div className="q">{i.q}</div>}
        </div>
      ))}
    </div>
  );
}
