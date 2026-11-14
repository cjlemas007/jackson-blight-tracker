"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { maplibregl } from "./maplibre";
import type { ExpressionSpecification, FilterSpecification, LngLatBoundsLike, MapLayerMouseEvent } from "maplibre-gl";
import { BASEMAP_STYLE, MAP_CENTER } from "@/config";
import type { FilterOptions } from "@/lib/parcels";
import ParcelPanel from "./ParcelPanel";

type ColorBy = "owner" | "status";

const OWNER_TYPES = [
  { key: "state_forfeited", label: "State of Mississippi (forfeited)", color: "var(--state)", hex: "#7b3fb5" },
  { key: "city", label: "City of Jackson", color: "var(--city)", hex: "#1f6fd1" },
  { key: "public", label: "Other public body", color: "var(--public)", hex: "#2a9d8f" },
  { key: "private", label: "Private owner", color: "var(--private)", hex: "#b8b2a7" },
] as const;

const STATUSES = [
  { key: "verified_blighted", label: "Verified blighted", hex: "#c62828" },
  { key: "city_action", label: "City action pending", hex: "#f2a900" },
  { key: "resolved", label: "Resolved", hex: "#2e7d32" },
  { key: "unreported", label: "Not reported", hex: "#d4cfc4" },
] as const;

const DELINQUENT_HEX = "#e07a1f";

// Captured when this module first loads, before hydration or a dev double-mount can rewrite the URL.
const INITIAL_HASH = typeof window === "undefined" ? "" : window.location.hash;

const MIN_PARCEL_ZOOM = 14;

function fillColor(colorBy: ColorBy): ExpressionSpecification {
  if (colorBy === "status") {
    return ["match", ["get", "status"], ...STATUSES.flatMap((s) => [s.key, s.hex]), "#d4cfc4"] as unknown as ExpressionSpecification;
  }
  return [
    "case",
    ["==", ["get", "owner_type"], "state_forfeited"], "#7b3fb5",
    ["==", ["get", "owner_type"], "city"], "#1f6fd1",
    ["==", ["get", "owner_type"], "public"], "#2a9d8f",
    ["==", ["get", "delinquent"], true], DELINQUENT_HEX,
    "#b8b2a7",
  ];
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
  siteName,
  options,
  staff,
}: {
  siteName: string;
  options: FilterOptions;
  staff: { name: string; role: string } | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const boundaryCache = useRef<Record<string, GeoJSON.FeatureCollection>>({});
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(12);
  const [colorBy, setColorBy] = useState<ColorBy>("owner");
  const [selected, setSelected] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    ward: "",
    neighborhood: "",
    ownerTypes: OWNER_TYPES.map((o) => o.key),
    statuses: STATUSES.map((s) => s.key),
    delinquentOnly: false,
  });

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
      style: BASEMAP_STYLE,
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
        minzoom: MIN_PARCEL_ZOOM,
        maxzoom: 16, // overzoom beyond 16; tiles at 16 carry full detail
        attribution: "Parcels: City of Jackson / Hinds County · Land roll: Hinds County",
      });

      map.addLayer({ id: "city-mask", type: "line", source: "city", paint: { "line-color": "#1d2433", "line-width": 2, "line-opacity": 0.6 } });
      map.addLayer({
        id: "parcels-fill", type: "fill", source: "parcels", "source-layer": "parcels",
        paint: { "fill-color": fillColor("owner"), "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.55, 17, 0.7] },
      });
      map.addLayer({
        id: "parcels-line", type: "line", source: "parcels", "source-layer": "parcels",
        paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.2, 17, 1] },
      });
      map.addLayer({
        id: "parcel-points", type: "circle", source: "parcels", "source-layer": "parcel_points",
        paint: { "circle-color": fillColor("owner"), "circle-radius": 4, "circle-stroke-color": "#fff", "circle-stroke-width": 1 },
      });
      map.addLayer({
        id: "selected-line", type: "line", source: "parcels", "source-layer": "parcels",
        filter: ["==", ["get", "parcel_id"], ""],
        paint: { "line-color": "#1d2433", "line-width": 3 },
      });
      map.addLayer({ id: "ward-lines", type: "line", source: "wards", paint: { "line-color": "#1d2433", "line-width": 1.2, "line-dasharray": [3, 2] } });
      map.addLayer({
        id: "ward-labels", type: "symbol", source: "wards", maxzoom: 14,
        layout: { "text-field": ["get", "name"], "text-size": 13, "text-font": ["Noto Sans Bold"] },
        paint: { "text-color": "#1d2433", "text-halo-color": "#fff", "text-halo-width": 1.5 },
      });

      for (const layer of ["parcels-fill", "parcel-points"]) {
        map.on("click", layer, (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.parcel_id as string | undefined;
          if (id) setSelected(id);
        });
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }
      setZoom(map.getZoom());
      setReady(true);
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
    map.setPaintProperty("parcels-fill", "fill-color", fillColor(colorBy));
    map.setPaintProperty("parcel-points", "circle-color", fillColor(colorBy));
  }, [filters, colorBy, ready]);

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
            { label: "Private, current", hex: "#b8b2a7" },
          ]
        : STATUSES.map((s) => ({ label: s.label, hex: s.hex })),
    [colorBy],
  );

  const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  const t = options.totals;

  return (
    <div className="app">
      <div className="topbar">
        <button className="filters-toggle" onClick={() => setSidebarOpen((o) => !o)} aria-expanded={sidebarOpen}>
          Filters
        </button>
        <h1>{siteName}</h1>
        <span className="sub">Jackson, Mississippi</span>
        <span className="spacer" />
        <nav>
          {staff ? (
            <>
              <a href="/submit">Submit</a>
              {staff.role === "admin" && <a href="/admin">Review queue</a>}
              <a href="/my">{staff.name}</a>
            </>
          ) : (
            <a href="/login">Staff sign in</a>
          )}
        </nav>
      </div>
      <div className="stage">
        <aside className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="Map filters">
          <div className="totals">
            <strong>{t.parcels.toLocaleString()}</strong> parcels inside Jackson city limits ·{" "}
            <strong>{t.state_forfeited.toLocaleString()}</strong> held by the State as tax-forfeited ·{" "}
            <strong>{t.delinquent.toLocaleString()}</strong> with unpaid current-year taxes.
            {t.landroll_as_of && <> Land roll as of {t.landroll_as_of}.</>}{" "}
            {t.not_on_roll > 0 && (
              <>{t.not_on_roll.toLocaleString()} parcels come only from the county parcel map and have no tax data.</>
            )}
          </div>

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
                  <span className="swatch" style={{ background: l.hex }} /> {l.label}
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
                  <span className="swatch" style={{ background: o.hex }} /> {o.label}
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
                  <span className="swatch" style={{ background: s.hex }} /> {s.label}
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
          <div ref={container} />
          {ready && zoom < MIN_PARCEL_ZOOM && <div className="zoomhint">Zoom in to see parcels</div>}
          {selected && <ParcelPanel county="Hinds" parcelId={selected} onClose={() => setSelected(null)} />}
        </div>
      </div>
    </div>
  );
}
