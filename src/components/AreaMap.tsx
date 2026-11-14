"use client";

import { useEffect, useRef, useState } from "react";
import type { MapLayerMouseEvent } from "maplibre-gl";
import { maplibregl } from "./maplibre";
import { BASEMAP_STYLE, MAP_CENTER } from "@/config";

const RAMP = ["#fbe9e7", "#f8bba8", "#ef8a6f", "#d9533b", "#a8231a"];

/**
 * Choropleth of blighted share by area. Quantile breaks over areas with any reports, so each
 * shade holds about a fifth of them; areas with none get the lightest shade.
 */
export function quantileBreaks(values: number[], classes: number): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  const breaks: number[] = [];
  for (let i = 1; i < classes; i++) breaks.push(v[Math.min(v.length - 1, Math.floor((i * v.length) / classes))]);
  return [...new Set(breaks)].filter((b) => b > 0);
}
export default function AreaMap({ kind }: { kind: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [max, setMax] = useState(0);
  const [breaks, setBreaks] = useState<number[]>([]);
  const [hover, setHover] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({ container: el.current, style: BASEMAP_STYLE, center: MAP_CENTER, zoom: 10.8, attributionControl: { compact: true } });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", async () => {
      const fc = await fetch(`/api/areas/${kind}`).then((r) => r.json());
      const shares: number[] = fc.features.map((f: { properties: { share_blighted: number } }) => f.properties.share_blighted);
      const top = Math.max(0, ...shares);
      const br = quantileBreaks(shares, RAMP.length - 1);
      setMax(top);
      setBreaks(br);
      m.addSource("areas", { type: "geojson", data: fc });
      m.addLayer({
        id: "areas-fill", type: "fill", source: "areas",
        paint: {
          // 0 -> lightest; first nonzero class starts just above 0, then quantile breaks.
          "fill-color": top > 0
            ? ["step", ["get", "share_blighted"], RAMP[0], 1e-9, RAMP[1], ...br.flatMap((b, i) => (RAMP[i + 2] ? [b, RAMP[i + 2]] : []))]
            : RAMP[0],
          "fill-opacity": 0.75,
        },
      } as maplibregl.AddLayerObject);
      m.addLayer({ id: "areas-line", type: "line", source: "areas", paint: { "line-color": "#1d2433", "line-width": 0.8 } });
      let [x0, y0, x1, y1] = [180, 90, -180, -90];
      const walk = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === "number") {
          x0 = Math.min(x0, c[0] as number); y0 = Math.min(y0, c[1] as number);
          x1 = Math.max(x1, c[0] as number); y1 = Math.max(y1, c[1] as number);
        } else if (Array.isArray(c)) c.forEach(walk);
      };
      fc.features.forEach((f: { geometry: { coordinates: unknown } }) => walk(f.geometry.coordinates));
      if (x0 < x1) m.fitBounds([[x0, y0], [x1, y1]], { padding: 20, duration: 0 });
      m.on("mousemove", "areas-fill", (e: MapLayerMouseEvent) => setHover(e.features?.[0]?.properties ?? null));
      m.on("mouseleave", "areas-fill", () => setHover(null));
      m.on("click", "areas-fill", (e: MapLayerMouseEvent) => setHover(e.features?.[0]?.properties ?? null));
    });
    return () => {
      m.remove();
      map.current = null;
    };
  }, [kind]);

  const pctTxt = (x: number) => `${(x * 100).toFixed(1)}%`;
  return (
    <div className="area-map">
      <div ref={el} className="map-canvas" />
      <div className="area-legend">
        {hover ? (
          <>
            <strong>{String(hover.name)}</strong>
            <div>{String(hover.blighted)} blighted of {String(hover.total_parcels)} parcels</div>
            <div>{pctTxt(Number(hover.share_blighted))}{hover.fully_surveyed ? "" : " (reported so far)"}</div>
          </>
        ) : (
          <>
            <div>Share of parcels verified blighted</div>
            <div className="ramp">{RAMP.map((c) => <span key={c} style={{ background: c }} />)}</div>
            <div className="row" style={{ justifyContent: "space-between", gap: 20 }}>
              <span>none</span><span>{breaks.length ? `${pctTxt(breaks[breaks.length - 1])}+` : ""}</span><span>max {pctTxt(max)}</span>
            </div>
            <div className="muted">Reported so far unless an area is fully surveyed</div>
          </>
        )}
      </div>
    </div>
  );
}
