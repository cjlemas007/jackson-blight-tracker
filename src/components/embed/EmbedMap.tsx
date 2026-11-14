"use client";

import { useEffect, useRef, useState } from "react";
import type { ExpressionSpecification, FilterSpecification, MapLayerMouseEvent } from "maplibre-gl";
import { maplibregl } from "../maplibre";
import { BASEMAP_STYLE, MAP_CENTER, SITE_NAME } from "@/config";

const COLORS: Record<string, string> = {
  verified_blighted: "#c62828", city_action: "#f2a900", city_flagged: "#9b7bd4", resolved: "#2e7d32", unreported: "#d4cfc4",
};
const LABEL: Record<string, string> = {
  verified_blighted: "Verified blighted", city_action: "City action pending", city_flagged: "City-flagged (not verified)",
  resolved: "Resolved", unreported: "Not reported",
};
const color = ["match", ["get", "status"], ...Object.entries(COLORS).flat(), "#d4cfc4"] as unknown as ExpressionSpecification;

/** Map for embedding in stories. Shows reported parcels by status; optional ward, status and parcel focus. */
export default function EmbedMap({
  ward, statuses, parcel, zoom, center,
}: { ward: string | null; statuses: string[]; parcel: string | null; zoom: number | null; center: [number, number] | null }) {
  const el = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<{ id: string; address: string; status: string } | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current, style: BASEMAP_STYLE, center: center ?? MAP_CENTER, zoom: zoom ?? 11, attributionControl: { compact: true },
      cooperativeGestures: true, // don't hijack page scrolling inside an article
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const filter: FilterSpecification = ["all",
      ["in", ["get", "status"], ["literal", statuses]],
      ...(ward ? [["==", ["get", "ward"], ward]] : []),
    ] as unknown as FilterSpecification;
    m.on("load", async () => {
      m.addSource("parcels", { type: "vector", tiles: [`${window.location.origin}/api/tiles/{z}/{x}/{y}`], minzoom: 9, maxzoom: 16 });
      m.addLayer({ id: "dots", type: "circle", source: "parcels", "source-layer": "status_points", maxzoom: 14, filter,
        paint: { "circle-color": color, "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 13, 5], "circle-stroke-color": "#fff", "circle-stroke-width": 0.8 } });
      m.addLayer({ id: "fill", type: "fill", source: "parcels", "source-layer": "parcels", minzoom: 14, filter,
        paint: { "fill-color": color, "fill-opacity": 0.7 } });
      m.addLayer({ id: "focus", type: "line", source: "parcels", "source-layer": "parcels", minzoom: 14,
        filter: ["==", ["get", "parcel_id"], parcel ?? ""], paint: { "line-color": "#1d2433", "line-width": 3 } });
      for (const layer of ["dots", "fill"]) {
        m.on("click", layer, async (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.parcel_id as string | undefined;
          if (!id) return;
          const p = await fetch(`/api/parcels/Hinds/${encodeURIComponent(id)}`).then((r) => r.json());
          setPopup({ id, address: p.situs_address ?? id, status: p.status });
        });
      }
      if (ward && !center) {
        const fc = await fetch("/api/boundaries/ward").then((r) => r.json());
        const f = fc.features.find((x: { properties: { code: string } }) => x.properties.code === ward);
        if (f) {
          let [x0, y0, x1, y1] = [180, 90, -180, -90];
          const walk = (c: unknown): void => {
            if (Array.isArray(c) && typeof c[0] === "number") {
              x0 = Math.min(x0, c[0] as number); y0 = Math.min(y0, c[1] as number); x1 = Math.max(x1, c[0] as number); y1 = Math.max(y1, c[1] as number);
            } else if (Array.isArray(c)) c.forEach(walk);
          };
          walk(f.geometry.coordinates);
          m.fitBounds([[x0, y0], [x1, y1]], { padding: 16, duration: 0 });
        }
      }
      if (parcel && !center) {
        const p = await fetch(`/api/parcels/Hinds/${encodeURIComponent(parcel)}`).then((r) => (r.ok ? r.json() : null));
        if (p?.lon != null) m.jumpTo({ center: [p.lon, p.lat], zoom: zoom ?? 17 });
      }
    });
    return () => m.remove();
  }, [ward, statuses, parcel, zoom, center]);

  return (
    <div style={{ position: "relative", height: "100%", minHeight: 300 }}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", left: 8, bottom: 8, background: "rgba(255,255,255,0.94)", borderRadius: 8, padding: "6px 8px", fontSize: 12, fontFamily: "system-ui, sans-serif" }}>
        {statuses.map((s) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: COLORS[s], display: "inline-block" }} />{LABEL[s]}
          </div>
        ))}
        <div style={{ color: "#5f6675", marginTop: 2 }}><a href="/" target="_blank" rel="noreferrer" style={{ color: "#5f6675" }}>{SITE_NAME}</a></div>
      </div>
      {popup && (
        <div style={{ position: "absolute", left: 8, top: 8, right: 56, background: "#fff", borderRadius: 8, padding: "8px 10px", boxShadow: "0 4px 16px rgba(0,0,0,0.15)", fontFamily: "system-ui, sans-serif", fontSize: 13 }}>
          <strong>{popup.address}</strong> · {LABEL[popup.status] ?? popup.status}
          <div><a href={`/?parcel=${encodeURIComponent(popup.id)}`} target="_blank" rel="noreferrer">Photos, owner and history</a>{" "}
            <button onClick={() => setPopup(null)} style={{ border: 0, background: "none", cursor: "pointer", color: "#5f6675" }}>close</button></div>
        </div>
      )}
    </div>
  );
}
