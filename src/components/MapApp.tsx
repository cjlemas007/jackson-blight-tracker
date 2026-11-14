"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initialBasemap, maplibregl, useMapTheme } from "./maplibre";
import type { ExpressionSpecification, FilterSpecification, LngLatBoundsLike, MapLayerMouseEvent } from "maplibre-gl";
import { MAP_CENTER } from "@/config";
import type { FilterOptions } from "@/lib/parcels";
import ParcelPanel from "./ParcelPanel";
import HeadlineCounters from "./HeadlineCounters";
import { INK, MAP_INK, OWNER_COLORS, STATUS_COLORS, STATUS_LABELS, themed, type Theme } from "@/lib/palette";
import type { Headline } from "@/lib/rankings";

type ColorBy = "owner" | "status";

const OWNER_TYPES = [
  { key: "state_forfeited", label: "State of Mississippi (forfeited)", hex: OWNER_COLORS.state_forfeited },
  { key: "city", label: "City of Jackson", hex: OWNER_COLORS.city },
  { key: "public", label: "Other public body", hex: OWNER_COLORS.public },
  { key: "private", label: "Private owner", hex: OWNER_COLORS.private },
] as const;

const STATUSES = (Object.keys(STATUS_COLORS) as (keyof typeof STATUS_COLORS)[]).map((key) => ({
  key,
  label: STATUS_LABELS[key],
  hex: STATUS_COLORS[key],
}));

const DELINQUENT_HEX = OWNER_COLORS.private_delinquent;

// Captured when this module first loads, before hydration or a dev double-mount can rewrite the URL.
const INITIAL_HASH = typeof window === "undefined" ? "" : window.location.hash;
// Shareable view: filters live in the query string (?ward=3&st=verified_blighted,city_action&color=status), view in the hash.
// The page passes the query string in, so the server render and hydration agree.
const listParam = (qs: URLSearchParams, k: string, all: readonly { key: string }[]) => {
  const v = qs.get(k);
  if (!v) return all.map((x) => x.key);
  const keys = v.split(",").filter((x) => all.some((a) => a.key === x));
  return keys.length ? keys : all.map((x) => x.key);
};

const MIN_PARCEL_ZOOM = 14;

function fillColor(colorBy: ColorBy, theme: Theme): ExpressionSpecification {
  const c = (hex: string) => themed(hex, theme);
  if (colorBy === "status") {
    return ["match", ["get", "status"], ...STATUSES.flatMap((s) => [s.key, c(s.hex)]), c(STATUS_COLORS.unreported)] as unknown as ExpressionSpecification;
  }
  return [
    "case",
    ["==", ["get", "owner_type"], "state_forfeited"], c(OWNER_COLORS.state_forfeited),
    ["==", ["get", "owner_type"], "city"], c(OWNER_COLORS.city),
    ["==", ["get", "owner_type"], "public"], c(OWNER_COLORS.public),
    ["==", ["get", "delinquent"], true], c(DELINQUENT_HEX),
    c(OWNER_COLORS.private),
  ];
}

/** Paint that depends on the light/dark theme, by layer id. */
function themePaint(theme: Theme, colorBy: ColorBy): Record<string, Record<string, unknown>> {
  const t = MAP_INK[theme];
  return {
    "city-mask": { "line-color": t.ink },
    "parcels-fill": { "fill-color": fillColor(colorBy, theme) },
    "parcels-line": { "line-color": t.stroke },
    "parcel-points": { "circle-color": fillColor(colorBy, theme), "circle-stroke-color": t.stroke },
    "status-points": { "circle-color": fillColor("status", theme), "circle-stroke-color": t.stroke },
    "selected-line": { "line-color": theme === "dark" ? t.accent : t.ink },
    "ward-lines": { "line-color": t.ink },
    "ward-labels": { "text-color": t.ink, "text-halo-color": t.halo },
  };
}

interface Filters {
  ward: string;
  neighborhood: string;
  ownerTypes: string[];
  statuses: string[];
  delinquentOnly: boolean;
}

function buildFilter(f: Filters): FilterSpecification {
  const clauses: ExpressionSpecification[] = [
    ["in", ["get", "owner_type"], ["literal", f.ownerTypes]],
    ["in", ["get", "status"], ["literal", f.statuses]],
  ];
  if (f.ward) clauses.push(["==", ["get", "ward"], f.ward]);
  if (f.neighborhood) clauses.push(["==", ["get", "neighborhood"], f.neighborhood]);
  if (f.delinquentOnly) clauses.push(["==", ["get", "delinquent"], true]);
  return ["all", ...clauses] as FilterSpecification;
}

function bboxOf(geom: GeoJSON.Geometry): LngLatBoundsLike {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  walk((geom as GeoJSON.MultiPolygon).coordinates);
  return [[minX, minY], [maxX, maxY]];
}

export default function MapApp({
  header,
  options,
  headline,
  search,
}: {
  header: React.ReactNode;
  options: FilterOptions;
  headline: Headline;
  search: Record<string, string>;
}) {
  const [qs] = useState(() => new URLSearchParams(search));
  // ?parcel=<id> (links from owner pages) opens that parcel.
  const initialParcel = useRef(qs.get("parcel")).current;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const boundaryCache = useRef<Record<string, GeoJSON.FeatureCollection>>({});
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(12);
  const [colorBy, setColorBy] = useState<ColorBy>(qs.get("color") === "status" ? "status" : "owner");
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    ward: qs.get("ward") ?? "",
    neighborhood: qs.get("nbhd") ?? "",
    ownerTypes: listParam(qs, "own", OWNER_TYPES),
    statuses: listParam(qs, "st", STATUSES),
    delinquentOnly: qs.get("delinq") === "1",
  });
  const theme = useMapTheme(mapRef, ready, ["city", "wards", "parcels"], (t) => themePaint(t, colorBy));

  const loadBoundaries = useCallback(async (kind: string) => {
    if (!boundaryCache.current[kind]) {
      boundaryCache.current[kind] = await fetch(`/api/boundaries/${kind}`).then((r) => r.json());
    }
    return boundaryCache.current[kind];
  }, []);

  // Map setup (once).
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    // Read a shared view (#zoom/lat/lon) ourselves: in dev, React's double-mount lets the
    // first map instance rewrite the hash to the defaults before the second one reads it.
    const [hz, hlat, hlon] = INITIAL_HASH.slice(1).split("/").map(Number);
    const fromHash = [hz, hlat, hlon].every(Number.isFinite);
    const map = new maplibregl.Map({
      container: container.current,
      style: initialBasemap(),
      center: fromHash ? [hlon, hlat] : MAP_CENTER,
      zoom: fromHash ? hz : 11.3,
      minZoom: 9,
      maxZoom: 19,
      hash: true, // #zoom/lat/lon in the URL: shareable map views
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __map?: maplibregl.Map }).__map = map;
    map.on("error", (e) => console.error("map error:", e.error?.message ?? e));
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "bottom-right");
    map.on("zoomend", () => setZoom(map.getZoom()));

    map.on("load", async () => {
      const [city, wards] = await Promise.all([loadBoundaries("city_limits"), loadBoundaries("ward")]);
      map.addSource("city", { type: "geojson", data: city });
      map.addSource("wards", { type: "geojson", data: wards });
      map.addSource("parcels", {
        type: "vector",
        tiles: [`${window.location.origin}/api/tiles/{z}/{x}/{y}`],
        minzoom: 9,
        maxzoom: 16, // overzoom beyond 16; tiles at 16 carry full detail
        attribution: "Parcels: City of Jackson / Hinds County · Land roll: Hinds County",
      });

      map.addLayer({ id: "city-mask", type: "line", source: "city", paint: { "line-color": INK, "line-width": 2, "line-opacity": 0.6 } });
      map.addLayer({
        id: "parcels-fill", type: "fill", source: "parcels", "source-layer": "parcels",
        paint: { "fill-color": fillColor("owner", "light"), "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.55, 17, 0.7] },
      });
      map.addLayer({
        id: "parcels-line", type: "line", source: "parcels", "source-layer": "parcels",
        paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.2, 17, 1] },
      });
      map.addLayer({
        id: "parcel-points", type: "circle", source: "parcels", "source-layer": "parcel_points",
        paint: { "circle-color": fillColor("owner", "light"), "circle-radius": 4, "circle-stroke-color": "#fff", "circle-stroke-width": 1 },
      });
      // Below parcel zoom: verified / city action / resolved parcels as dots, always colored by status.
      map.addLayer({
        id: "status-points", type: "circle", source: "parcels", "source-layer": "status_points", maxzoom: MIN_PARCEL_ZOOM,
        paint: {
          "circle-color": fillColor("status", "light"),
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 13, 5],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 0.8,
        },
      });
      map.addLayer({
        id: "selected-line", type: "line", source: "parcels", "source-layer": "parcels",
        filter: ["==", ["get", "parcel_id"], ""],
        paint: { "line-color": INK, "line-width": 3 },
      });
      map.addLayer({ id: "ward-lines", type: "line", source: "wards", paint: { "line-color": INK, "line-width": 1.2, "line-dasharray": [3, 2] } });
      map.addLayer({
        id: "ward-labels", type: "symbol", source: "wards", maxzoom: 14,
        layout: { "text-field": ["get", "name"], "text-size": 13, "text-font": ["Noto Sans Bold"] },
        paint: { "text-color": INK, "text-halo-color": "#fff", "text-halo-width": 1.5 },
      });

      for (const layer of ["parcels-fill", "parcel-points", "status-points"]) {
        map.on("click", layer, (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.parcel_id as string | undefined;
          if (id) setSelected(id);
        });
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }
      setZoom(map.getZoom());
      setReady(true);
      if (initialParcel) {
        const p = await fetch(`/api/parcels/Hinds/${encodeURIComponent(initialParcel)}`).then((r) => (r.ok ? r.json() : null));
        if (p?.lon != null) map.jumpTo({ center: [p.lon, p.lat], zoom: 17 });
        if (p) setSelected(initialParcel);
      }
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [loadBoundaries]);

  // Filters and color mode.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const f = buildFilter(filters);
    map.setFilter("parcels-fill", f);
    map.setFilter("parcels-line", f);
    map.setFilter("parcel-points", f);
    map.setFilter("status-points", f);
    map.setPaintProperty("parcels-fill", "fill-color", fillColor(colorBy, theme));
    map.setPaintProperty("parcel-points", "circle-color", fillColor(colorBy, theme));
    // Keep the URL in step so any view can be shared.
    const qs = new URLSearchParams();
    if (filters.ward) qs.set("ward", filters.ward);
    if (filters.neighborhood) qs.set("nbhd", filters.neighborhood);
    if (filters.ownerTypes.length !== OWNER_TYPES.length) qs.set("own", filters.ownerTypes.join(","));
    if (filters.statuses.length !== STATUSES.length) qs.set("st", filters.statuses.join(","));
    if (filters.delinquentOnly) qs.set("delinq", "1");
    if (colorBy === "status") qs.set("color", "status");
    const q = qs.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`);
  }, [filters, colorBy, ready]); // theme changes are applied by useMapTheme

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter("selected-line", ["==", ["get", "parcel_id"], selected ?? ""]);
  }, [selected, ready]);

  // Zoom to a chosen ward or neighborhood.
  const zoomToArea = useCallback(
    async (kind: "ward" | "neighborhood", code: string) => {
      const map = mapRef.current;
      if (!map || !code) return;
      const fc = await loadBoundaries(kind);
      const feat = fc.features.find((f) => String(f.properties?.code) === code);
      if (feat) map.fitBounds(bboxOf(feat.geometry), { padding: 40, maxZoom: 15 });
    },
    [loadBoundaries],
  );

  const legend = useMemo(
    () =>
      colorBy === "owner"
        ? [
            ...OWNER_TYPES.slice(0, 3).map((o) => ({ label: o.label, hex: o.hex })),
            { label: "Private, taxes delinquent", hex: DELINQUENT_HEX },
            { label: "Private, current", hex: OWNER_COLORS.private },
          ]
        : STATUSES.map((s) => ({ label: s.label, hex: s.hex })),
    [colorBy],
  );

  const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  const t = options.totals;

  return (
    <div className="app">
      {header}
      <div className="stage">
        <aside className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="Map filters">
          <div className="sidebar-head">
            <button type="button" className="sidebar-close" onClick={() => setSidebarOpen(false)}>Close</button>
            <div className="kicker">Live map</div>
            <div className="sidebar-title">Blighted property in Jackson</div>
          </div>
          <HeadlineCounters h={headline} compact />
          <div className="totals">
            <strong>{t.parcels.toLocaleString()}</strong> parcels inside Jackson city limits ·{" "}
            <strong>{t.state_forfeited.toLocaleString()}</strong> held by the State as tax-forfeited ·{" "}
            <strong>{t.delinquent.toLocaleString()}</strong> with unpaid current-year taxes.
            {t.landroll_as_of && <> Land roll as of {t.landroll_as_of}.</>}{" "}
            {t.not_on_roll > 0 && (
              <>{t.not_on_roll.toLocaleString()} parcels come only from the county parcel map and have no tax data.</>
            )}
          </div>

          <button
            className="btn secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(window.location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Link copied" : "Copy link to this view"}
          </button>

          <div>
            <h2>Color parcels by</h2>
            <div className="seg" role="group">
              <button aria-pressed={colorBy === "owner"} onClick={() => setColorBy("owner")}>Owner</button>
              <button aria-pressed={colorBy === "status"} onClick={() => setColorBy("status")}>Status</button>
            </div>
          </div>

          <div>
            <h2>Legend</h2>
            <div className="checks">
              {legend.map((l) => (
                <div key={l.label} className="check" style={{ cursor: "default" }}>
                  <span className="swatch" style={{ background: themed(l.hex, theme) }} /> {l.label}
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="ward">Ward</label>
            <select
              id="ward"
              value={filters.ward}
              onChange={(e) => {
                setFilters({ ...filters, ward: e.target.value });
                void zoomToArea("ward", e.target.value);
              }}
            >
              <option value="">All wards</option>
              {options.wards.map((w) => (
                <option key={w.code} value={w.code}>{w.name}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="nbhd">Neighborhood (unofficial boundaries)</label>
            <select
              id="nbhd"
              value={filters.neighborhood}
              onChange={(e) => {
                setFilters({ ...filters, neighborhood: e.target.value });
                void zoomToArea("neighborhood", e.target.value);
              }}
            >
              <option value="">All neighborhoods</option>
              {options.neighborhoods.map((n) => (
                <option key={n.code} value={n.code}>{n.name}</option>
              ))}
            </select>
          </div>

          <div>
            <h2>Owner type</h2>
            <div className="checks">
              {OWNER_TYPES.map((o) => (
                <label key={o.key} className="check">
                  <input
                    type="checkbox"
                    checked={filters.ownerTypes.includes(o.key)}
                    onChange={() => setFilters({ ...filters, ownerTypes: toggle(filters.ownerTypes, o.key) })}
                  />
                  <span className="swatch" style={{ background: themed(o.hex, theme) }} /> {o.label}
                </label>
              ))}
              <label className="check">
                <input
                  type="checkbox"
                  checked={filters.delinquentOnly}
                  onChange={() => setFilters({ ...filters, delinquentOnly: !filters.delinquentOnly })}
                />
                Only parcels with unpaid current taxes
              </label>
            </div>
          </div>

          <div>
            <h2>Status</h2>
            <div className="checks">
              {STATUSES.map((s) => (
                <label key={s.key} className="check">
                  <input
                    type="checkbox"
                    checked={filters.statuses.includes(s.key)}
                    onChange={() => setFilters({ ...filters, statuses: toggle(filters.statuses, s.key) })}
                  />
                  <span className="swatch" style={{ background: themed(s.hex, theme) }} /> {s.label}
                </label>
              ))}
            </div>
          </div>

          <p className="note">
            Neighborhood lines are an unofficial set (Zillow neighborhoods); the city publishes none. Ward lines are
            the city&apos;s post-2020 council wards.
          </p>
        </aside>

        <div className="map">
          <div ref={container} className="map-canvas" />
          <button className="filters-toggle" onClick={() => setSidebarOpen((o) => !o)} aria-expanded={sidebarOpen}>
            {sidebarOpen ? "Close filters" : "Filters & legend"}
          </button>
          {ready && zoom < MIN_PARCEL_ZOOM && <div className="zoomhint">Dots show reported parcels. Zoom in to see every parcel</div>}
          {selected && <ParcelPanel county="Hinds" parcelId={selected} onClose={() => setSelected(null)} />}
        </div>
      </div>
    </div>
  );
}
