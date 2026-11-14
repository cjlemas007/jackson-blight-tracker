import { fetchJson } from "./runner";
import { HINDS_ENVELOPE } from "./sources";

export interface GeoJsonFeature {
  type: "Feature";
  id?: number;
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown>;
}

interface FeatureCollection {
  features: GeoJsonFeature[];
  exceededTransferLimit?: boolean;
  properties?: { exceededTransferLimit?: boolean };
}

export function queryUrl(layer: string, params: Record<string, string | number | boolean>): string {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return `${layer}/query?${qs}`;
}

/** Fetch every feature of a (small) layer as GeoJSON in WGS84, paging by offset. */
export async function fetchAllGeoJson(
  layer: string,
  where: string,
  opts: { envelope?: boolean; pageSize?: number } = {},
): Promise<GeoJsonFeature[]> {
  const pageSize = opts.pageSize ?? 500;
  const out: GeoJsonFeature[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const params: Record<string, string | number | boolean> = {
      where,
      outFields: "*",
      returnGeometry: true,
      outSR: 4326,
      f: "geojson",
      resultOffset: offset,
      resultRecordCount: pageSize,
    };
    if (opts.envelope) {
      const e = HINDS_ENVELOPE;
      Object.assign(params, {
        geometry: `${e.xmin},${e.ymin},${e.xmax},${e.ymax}`,
        geometryType: "esriGeometryEnvelope",
        inSR: 4326,
        spatialRel: "esriSpatialRelIntersects",
      });
    }
    const fc = await fetchJson<FeatureCollection>(queryUrl(layer, params));
    out.push(...fc.features);
    const more = fc.exceededTransferLimit || fc.properties?.exceededTransferLimit;
    if (!more || fc.features.length === 0) break;
  }
  return out;
}
