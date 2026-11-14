"use client";

import { useEffect, useRef, useState } from "react";
import type { MapLayerMouseEvent } from "maplibre-gl";
import { initialBasemap, maplibregl, useMapTheme } from "./maplibre";
import { MAP_CENTER } from "@/config";
import { ACCENT, INK, MAP_INK, type Theme } from "@/lib/palette";

/** Small map for choosing a parcel by tapping it. Parcels appear from zoom 14. */
export default function ParcelPickerMap({
  center,
  selected,
  onPick,
}: {
  center?: [number, number] | null;
  selected?: string | null;
  onPick: (parcelId: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  useMapTheme(map, ready, ["parcels"], (t: Theme) => ({
    "pick-fill": { "fill-color": MAP_INK[t].ink },
    "pick-line": { "line-color": MAP_INK[t].ink },
    "pick-selected": { "fill-color": MAP_INK[t].accent },
  }));
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: initialBasemap(),
      center: center ?? MAP_CENTER,
      zoom: center ? 17 : 12,
      attributionControl: { compact: true },
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    m.on("load", () => {
      m.addSource("parcels", {
        type: "vector",
        tiles: [`${window.location.origin}/api/tiles/{z}/{x}/{y}`],
        minzoom: 14,
        maxzoom: 16,
      });
      m.addLayer({
        id: "pick-fill", type: "fill", source: "parcels", "source-layer": "parcels",
        paint: { "fill-color": INK, "fill-opacity": 0.06 },
      });
      m.addLayer({
        id: "pick-line", type: "line", source: "parcels", "source-layer": "parcels",
        paint: { "line-color": INK, "line-width": 0.6, "line-opacity": 0.45 },
      });
      m.addLayer({
        id: "pick-selected", type: "fill", source: "parcels", "source-layer": "parcels",
        filter: ["==", ["get", "parcel_id"], ""],
        paint: { "fill-color": ACCENT, "fill-opacity": 0.45 },
      });
      m.on("click", "pick-fill", (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.parcel_id as string | undefined;
        if (id) pick.current(id);
      });
      m.on("mouseenter", "pick-fill", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "pick-fill", () => (m.getCanvas().style.cursor = ""));
      setReady(true);
    });
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => m.getLayer("pick-selected") && m.setFilter("pick-selected", ["==", ["get", "parcel_id"], selected ?? ""]);
    if (m.isStyleLoaded()) apply();
    else m.once("idle", apply);
  }, [selected]);

  useEffect(() => {
    if (center && map.current) map.current.jumpTo({ center, zoom: Math.max(map.current.getZoom(), 17) });
  }, [center]);

  return (
    <div className="picker-map">
      <div ref={el} className="map-canvas" />
    </div>
  );
}
