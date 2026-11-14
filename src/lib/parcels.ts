import "server-only";
import { query } from "./db";
import { publicPhotos } from "./submissions";

export const STATUS_LABELS: Record<string, string> = {
  unreported: "Not reported",
  submitted: "Submitted, awaiting review",
  verified_blighted: "Verified blighted",
  city_action: "City action pending",
  resolved: "Resolved",
};

export const SUBSTATUS_LABELS: Record<string, string> = {
  cited: "Cited",
  hearing_set: "Hearing set",
  adjudicated: "Adjudicated by council",
  demolition_ordered: "Demolition ordered",
  lot_cleanup_ordered: "Lot cleanup ordered",
  lien_filed: "Lien filed",
  demolished: "Demolished",
  repaired: "Repaired",
  lot_cleared: "Lot cleared",
  rejected_on_recheck: "Rejected on re-check",
};

export const OWNER_TYPE_LABELS: Record<string, string> = {
  private: "Private owner",
  state_forfeited: "State of Mississippi (tax-forfeited)",
  city: "City of Jackson",
  public: "Other public body",
};

/**
 * Public view of a parcel's status. A pending submission is not public until an admin
 * approves it, so it shows as unreported (or as the parcel's prior public state once
 * follow-up submissions exist; handled in step 3 with the submissions table).
 */
const PUBLIC_STATUS = "(CASE WHEN p.status = 'submitted' THEN 'unreported' ELSE p.status::text END)";

export async function getMapTile(z: number, x: number, y: number): Promise<Buffer> {
  // Coarser grid at low zoom: snapping to 1024 drops near-duplicate vertices and cuts
  // z13 tiles roughly in half; full 4096 detail from z15.
  const extent = z >= 15 ? 4096 : 1024;
  const rows = await query<{ mvt: Buffer }>(
    `WITH b AS (SELECT ST_TileEnvelope($1, $2, $3) AS env, ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS env4326),
     poly AS (
       SELECT ST_AsMVTGeom(g.geom_3857, b.env, $4, 16, true) AS geom,
              p.parcel_id, p.owner_type, p.delinquent, ${PUBLIC_STATUS} AS status, p.ward, p.neighborhood,
              p.homestead, p.owner_estate_heirs AS estate
       FROM b
       JOIN data.gis_parcels g ON g.geom_3857 && b.env AND g.retired_at IS NULL
       JOIN app.parcels p ON p.county = g.county AND p.parcel_id = g.parcel_id
       WHERE p.in_city
     ),
     pts AS (
       SELECT ST_AsMVTGeom(ST_Transform(p.pt, 3857), b.env, $4, 16, true) AS geom,
              p.parcel_id, p.owner_type, p.delinquent, ${PUBLIC_STATUS} AS status, p.ward, p.neighborhood,
              p.homestead, p.owner_estate_heirs AS estate
       FROM b JOIN app.parcels p ON p.pt && b.env4326
       WHERE p.in_city AND NOT p.has_polygon
     )
     SELECT COALESCE((SELECT ST_AsMVT(poly.*, 'parcels', $4, 'geom') FROM poly), ''::bytea)
         || COALESCE((SELECT ST_AsMVT(pts.*, 'parcel_points', $4, 'geom') FROM pts), ''::bytea) AS mvt`,
    [z, x, y, extent],
  );
  return rows[0]?.mvt ?? Buffer.alloc(0);
}

export interface FilterOptions {
  wards: { code: string; name: string }[];
  neighborhoods: { code: string; name: string }[];
  totals: { parcels: number; state_forfeited: number; delinquent: number; not_on_roll: number; landroll_as_of: string | null };
}

export async function getFilterOptions(): Promise<FilterOptions> {
  const [wards, neighborhoods, totals] = await Promise.all([
    query<{ code: string; name: string }>(
      "SELECT code, name FROM data.boundaries WHERE kind = 'ward' ORDER BY length(code), code",
    ),
    query<{ code: string; name: string }>(
      `SELECT DISTINCT b.code, b.name FROM data.boundaries b
       WHERE b.kind = 'neighborhood' AND EXISTS (SELECT 1 FROM app.parcel_facts f WHERE f.in_city AND f.neighborhood = b.code)
       ORDER BY b.name`,
    ),
    query<FilterOptions["totals"]>(
      `SELECT count(*) AS parcels,
              count(*) FILTER (WHERE owner_type = 'state_forfeited') AS state_forfeited,
              count(*) FILTER (WHERE delinquent) AS delinquent,
              count(*) FILTER (WHERE NOT on_tax_roll) AS not_on_roll,
              to_char(max(owner_as_of) FILTER (WHERE on_tax_roll) AT TIME ZONE 'America/Chicago', 'Mon DD, YYYY') AS landroll_as_of
       FROM app.parcel_facts WHERE in_city`,
    ),
  ]);
  return { wards, neighborhoods, totals: totals[0] };
}

export async function getParcel(county: string, parcelId: string) {
  const rows = await query(
    `SELECT p.county, p.parcel_id, p.situs_address, p.street_name, p.owner_name, p.owner_type,
            p.owner_estate_heirs, p.homestead, p.portfolio_id, p.portfolio_source, p.attributed_owner,
            p.appraised_total, p.assessed_total, p.tv_land, p.tv_imp, p.acreage, p.year_built, p.deed_date,
            p.current_due, p.latest_tax_year, p.delinquent, t.current_due_estimated, t.tax_conflict, t.unpaid_years,
            p.in_city, p.ward, nb.name AS neighborhood_name, p.zip, tr.name AS tract_name, p.location_source,
            ${PUBLIC_STATUS} AS status,
            CASE WHEN p.status = 'submitted' THEN NULL ELSE p.substatus END AS substatus,
            CASE WHEN p.status = 'submitted' THEN NULL ELSE p.status_since END AS status_since,
            p.owner_source, p.on_tax_roll,
            to_char(p.owner_as_of AT TIME ZONE 'America/Chicago', 'Mon DD, YYYY') AS owner_as_of,
            ST_X(p.pt) AS lon, ST_Y(p.pt) AS lat
     FROM app.parcels p
     LEFT JOIN data.parcel_tax t ON t.county = p.county AND t.parcel_id = p.parcel_id
     LEFT JOIN data.boundaries nb ON nb.kind = 'neighborhood' AND nb.code = p.neighborhood
     LEFT JOIN data.boundaries tr ON tr.kind = 'tract' AND tr.code = p.tract
     WHERE p.county = $1 AND p.parcel_id = $2`,
    [county, parcelId],
  );
  if (!rows.length) return null;
  const history = await query(
    `SELECT e.id, e.status::text AS status, e.substatus, e.effective_date, e.source::text AS source, e.note,
            e.document_id, (v.event_id IS NOT NULL) AS voided
     FROM app.status_events e LEFT JOIN app.status_event_voids v ON v.event_id = e.id
     WHERE e.county = $1 AND e.parcel_id = $2
       AND e.status NOT IN ('submitted', 'unreported') -- nothing is public until an admin approves
       AND v.event_id IS NULL
     ORDER BY e.effective_date DESC, e.recorded_at DESC, e.id DESC`,
    [county, parcelId],
  );
  const photos = await publicPhotos(county, parcelId);
  return { ...rows[0], history, photos };
}

export async function getBoundaryGeoJson(kind: string) {
  const rows = await query<{ fc: unknown }>(
    `SELECT json_build_object('type', 'FeatureCollection', 'features', COALESCE(json_agg(json_build_object(
        'type', 'Feature', 'properties', json_build_object('code', code, 'name', name, 'unofficial', unofficial),
        'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.00005), 6)::json)), '[]'::json)) AS fc
     FROM data.boundaries WHERE kind = $1`,
    [kind],
  );
  return rows[0].fc;
}

export interface ParcelHit {
  parcel_id: string;
  situs_address: string | null;
  owner_name: string | null;
  status: string;
  distance_m?: number;
}

/** Address or parcel-id search, Jackson parcels only. "522 burns" matches 522 BURNS ST. */
export async function searchParcels(q: string): Promise<ParcelHit[]> {
  const s = q.trim().toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ");
  const m = s.match(/^(\d+)\s+(.+)$/);
  const looksLikeId = /^\d+(-[\dA-Z]+)+$/.test(s) || /^\d+-?$/.test(s);
  return query<ParcelHit>(
    `SELECT p.parcel_id, p.situs_address, p.owner_name,
            ${PUBLIC_STATUS} AS status
     FROM app.parcels p
     WHERE p.in_city AND (
       ($1::text IS NOT NULL AND p.parcel_id LIKE $1 || '%')
       OR ($2::int IS NOT NULL AND p.situs_number = $2 AND p.street_name LIKE '%' || $3 || '%')
       OR ($2::int IS NULL AND $1::text IS NULL AND p.situs_address LIKE '%' || $4 || '%')
     )
     ORDER BY (p.situs_address LIKE $4 || '%') DESC, p.situs_address
     LIMIT 12`,
    [looksLikeId ? s : null, m ? Number(m[1]) : null, m ? m[2] : null, s],
  );
}

/** Closest Jackson parcels to a point ("near me"). */
export async function nearestParcels(lat: number, lon: number): Promise<ParcelHit[]> {
  return query<ParcelHit>(
    `SELECT p.parcel_id, p.situs_address, p.owner_name, ${PUBLIC_STATUS} AS status,
            round(ST_Distance(p.pt::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography))::int AS distance_m
     FROM app.parcels p
     WHERE p.in_city AND p.pt IS NOT NULL
     ORDER BY p.pt <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)
     LIMIT 10`,
    [lat, lon],
  );
}
