/**
 * Rankings and headline counters. All figures are Jackson city parcels only, computed live from
 * the status history (no typed-in numbers). See db/migrations/logic/1005_rankings.sql for what
 * "blighted" and "surveyed" mean.
 */
import { getPool } from "./db";
import { FULLY_SURVEYED_SHARE, STREET_MIN_PARCELS, SURVEY_VALID_DAYS } from "@/config";

const today = "(now() AT TIME ZONE 'America/Chicago')::date";

export type OwnerTab = "private" | "state" | "public";
const TAB_TYPES: Record<OwnerTab, string[]> = {
  private: ["private"],
  state: ["state_forfeited"],
  public: ["city", "public"],
};

// ---------------------------------------------------------------------------------------
// Headline counters
// ---------------------------------------------------------------------------------------

export interface Headline {
  blighted: number;
  total_parcels: number;
  surveyed: number;
  state_owned_blighted: number;
  demolished_this_week: number;
  resolved_to_date: number;
  city_flagged: number; // City acted, newsroom hasn't verified: shown separately, never counted as blighted
  week_start: string;
}

export async function headline(): Promise<Headline> {
  const { rows } = await getPool().query<Headline>(
    `WITH b AS (SELECT * FROM app.ranking_base(${today}, $1)),
          wk AS (SELECT app.week_start() AS s)
     SELECT
       (SELECT count(*) FILTER (WHERE blighted) FROM b)::int AS blighted,
       (SELECT count(*) FROM b)::int AS total_parcels,
       (SELECT count(*) FILTER (WHERE surveyed) FROM b)::int AS surveyed,
       (SELECT count(*) FILTER (WHERE blighted AND owner_type = 'state_forfeited') FROM b)::int AS state_owned_blighted,
       (SELECT count(*) FILTER (WHERE city_flagged) FROM b)::int AS city_flagged,
       (SELECT count(*) FROM app.first_entries('resolved', 'demolished', (SELECT s FROM wk), (SELECT s FROM wk) + 7) e
          JOIN app.parcel_facts f USING (county, parcel_id) WHERE f.in_city)::int AS demolished_this_week,
       (SELECT count(DISTINCT (e.county, e.parcel_id)) FROM app.status_events_live e
          JOIN app.parcel_facts f USING (county, parcel_id)
          WHERE f.in_city AND e.status = 'resolved' AND e.substatus <> 'rejected_on_recheck')::int AS resolved_to_date,
       (SELECT s::text FROM wk) AS week_start`,
    [SURVEY_VALID_DAYS],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------------------
// Owners
// ---------------------------------------------------------------------------------------

export interface OwnerRow {
  portfolio_id: string;
  name: string;
  other_names: number;
  curated: boolean;
  total_parcels: number;
  blighted: number; // ranked: excludes homestead and estate/heirs parcels
  blighted_excluded: number; // blighted but excluded from the ranking
  share_blighted: number; // blighted / total_parcels
  taxes_owed: number; // known unpaid current taxes, all parcels in the portfolio
  surveyed: number;
  city_flagged: number; // shown beside the ranking; doesn't change the order
}

/**
 * Owners ranked by verified blighted parcels. Homestead-exempt and estate/heirs parcels are left
 * out of the ranked count (they still count in street and area totals).
 */
export async function ownerRankings(tab: OwnerTab, limit = 100): Promise<OwnerRow[]> {
  const { rows } = await getPool().query<OwnerRow>(
    `WITH b AS (SELECT * FROM app.ranking_base(${today}, $1) WHERE owner_type = ANY($2)),
     g AS (
       SELECT portfolio_id,
              count(*)::int AS total_parcels,
              count(*) FILTER (WHERE blighted AND ranking_excluded_reason IS NULL)::int AS blighted,
              count(*) FILTER (WHERE blighted AND ranking_excluded_reason IS NOT NULL)::int AS blighted_excluded,
              COALESCE(sum(current_due), 0)::float8 AS taxes_owed,
              count(*) FILTER (WHERE surveyed)::int AS surveyed,
              count(*) FILTER (WHERE city_flagged)::int AS city_flagged
       FROM b GROUP BY portfolio_id
       HAVING count(*) FILTER (WHERE blighted AND ranking_excluded_reason IS NULL) > 0
     ),
     names AS (
       SELECT f.portfolio_id, mode() WITHIN GROUP (ORDER BY f.owner_name) AS common_name,
              count(DISTINCT f.owner_name)::int AS n_names
       FROM app.parcel_facts f JOIN g USING (portfolio_id) WHERE f.in_city GROUP BY f.portfolio_id
     )
     SELECT g.portfolio_id, COALESCE(p.display_name, n.common_name, g.portfolio_id) AS name,
            GREATEST(n.n_names - 1, 0) AS other_names, (p.portfolio_id IS NOT NULL) AS curated,
            g.total_parcels, g.blighted, g.blighted_excluded,
            g.blighted::float8 / g.total_parcels AS share_blighted, g.taxes_owed, g.surveyed, g.city_flagged
     FROM g LEFT JOIN names n USING (portfolio_id) LEFT JOIN app.portfolios p USING (portfolio_id)
     ORDER BY g.blighted DESC, share_blighted DESC, g.total_parcels DESC, name
     LIMIT $3`,
    [SURVEY_VALID_DAYS, TAB_TYPES[tab], limit],
  );
  return rows;
}

export async function ownerDetail(portfolioId: string) {
  const pool = getPool();
  const { rows: parcels } = await pool.query(
    `SELECT f.parcel_id, f.situs_address, f.owner_name, f.owner_type, f.ranking_excluded_reason, f.current_due,
            f.delinquent, f.ward, f.owner_source,
            CASE WHEN s.status = 'city_action' AND NOT EXISTS (
                   SELECT 1 FROM app.status_events_live v WHERE v.county = f.county AND v.parcel_id = f.parcel_id AND v.status = 'verified_blighted')
                 THEN 'city_flagged' ELSE COALESCE(s.status::text, 'unreported') END AS status,
            s.substatus, s.status_since::text,
            sv.surveyed_on::text
     FROM app.parcel_facts f
     LEFT JOIN app.parcel_status_current s USING (county, parcel_id)
     LEFT JOIN app.surveyed_as_of(${today}, $2) sv USING (county, parcel_id)
     WHERE f.in_city AND f.portfolio_id = $1
     ORDER BY (s.status IN ('verified_blighted', 'city_action')) DESC NULLS LAST, f.situs_address NULLS LAST`,
    [portfolioId, SURVEY_VALID_DAYS],
  );
  if (!parcels.length) return null;
  const { rows: meta } = await pool.query(
    `SELECT p.display_name, p.principal, p.notes,
            (SELECT array_agg(DISTINCT f.owner_name ORDER BY f.owner_name) FROM app.parcel_facts f
              WHERE f.in_city AND f.portfolio_id = $1) AS owner_names,
            (SELECT array_agg(k.mailing_key ORDER BY k.mailing_key) FROM app.portfolio_mailing_keys k WHERE k.portfolio_id = $1) AS mailing_keys,
            (SELECT max(f.portfolio_source) FROM app.parcel_facts f WHERE f.portfolio_id = $1) AS source
     FROM (SELECT 1) x LEFT JOIN app.portfolios p ON p.portfolio_id = $1`,
    [portfolioId],
  );
  return { portfolio_id: portfolioId, ...meta[0], parcels };
}

// ---------------------------------------------------------------------------------------
// Streets
// ---------------------------------------------------------------------------------------

export interface StreetRow {
  street_name: string;
  total_parcels: number;
  blighted: number;
  share_blighted: number;
  surveyed: number;
  fully_surveyed: boolean;
  city_flagged: number;
}

export async function streetRankings(opts: {
  minParcels?: number;
  sort?: "count" | "pct";
  surveyedOnly?: boolean;
  limit?: number;
}): Promise<StreetRow[]> {
  const min = Math.max(1, Math.floor(opts.minParcels ?? STREET_MIN_PARCELS));
  const order = opts.sort === "pct" ? "share_blighted DESC, blighted DESC" : "blighted DESC, share_blighted DESC";
  const { rows } = await getPool().query<StreetRow>(
    `SELECT * FROM (
       SELECT street_name, count(*)::int AS total_parcels,
              count(*) FILTER (WHERE blighted)::int AS blighted,
              (count(*) FILTER (WHERE blighted))::float8 / count(*) AS share_blighted,
              count(*) FILTER (WHERE surveyed)::int AS surveyed,
              (count(*) FILTER (WHERE surveyed))::float8 / count(*) >= $3 AS fully_surveyed,
              count(*) FILTER (WHERE city_flagged)::int AS city_flagged
       FROM app.ranking_base(${today}, $1)
       WHERE street_name IS NOT NULL
       GROUP BY street_name
       HAVING count(*) >= $2
     ) s
     WHERE blighted > 0 AND ($4::boolean IS NOT TRUE OR fully_surveyed)
     ORDER BY ${order}, total_parcels DESC, street_name
     LIMIT $5`,
    [SURVEY_VALID_DAYS, min, FULLY_SURVEYED_SHARE, opts.surveyedOnly ?? false, opts.limit ?? 100],
  );
  return rows;
}

// ---------------------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------------------

export const AREA_KINDS = ["ward", "neighborhood", "tract"] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

export interface AreaRow {
  code: string;
  name: string;
  unofficial: boolean;
  total_parcels: number;
  blighted: number;
  share_blighted: number;
  surveyed: number;
  fully_surveyed: boolean;
  blighted_30d_ago: number;
  blighted_90d_ago: number;
  city_flagged: number;
}

/** Every area of a kind (including ones with nothing reported), with change over 30/90 days. */
export async function areaRankings(kind: AreaKind, surveyedOnly = false): Promise<AreaRow[]> {
  if (!AREA_KINDS.includes(kind)) throw new Error(`unknown area kind: ${kind}`); // interpolated into SQL below
  const { rows } = await getPool().query<AreaRow>(
    `WITH now_ AS (SELECT ${kind} AS code, count(*) n, count(*) FILTER (WHERE blighted) b, count(*) FILTER (WHERE surveyed) s,
                          count(*) FILTER (WHERE city_flagged) cf
                   FROM app.ranking_base(${today}, $1) WHERE ${kind} IS NOT NULL GROUP BY 1),
          d30 AS (SELECT ${kind} AS code, count(*) FILTER (WHERE blighted) b
                  FROM app.ranking_base(${today} - 30, $1) WHERE ${kind} IS NOT NULL GROUP BY 1),
          d90 AS (SELECT ${kind} AS code, count(*) FILTER (WHERE blighted) b
                  FROM app.ranking_base(${today} - 90, $1) WHERE ${kind} IS NOT NULL GROUP BY 1)
     SELECT a.code, a.name, a.unofficial,
            n.n::int AS total_parcels, n.b::int AS blighted, n.b::float8 / n.n AS share_blighted,
            n.s::int AS surveyed, n.s::float8 / n.n >= $2 AS fully_surveyed,
            COALESCE(d30.b, 0)::int AS blighted_30d_ago, COALESCE(d90.b, 0)::int AS blighted_90d_ago,
            n.cf::int AS city_flagged
     FROM data.boundaries a
     JOIN now_ n ON n.code = a.code
     LEFT JOIN d30 ON d30.code = a.code
     LEFT JOIN d90 ON d90.code = a.code
     WHERE a.kind = $3 AND ($4::boolean IS NOT TRUE OR n.s::float8 / n.n >= $2)
     ORDER BY n.b DESC, share_blighted DESC, a.name`,
    [SURVEY_VALID_DAYS, FULLY_SURVEYED_SHARE, kind, surveyedOnly],
  );
  return rows;
}

/** Boundaries as GeoJSON with each area's figures, for the choropleth. */
export async function areaGeoJson(kind: AreaKind) {
  const stats = await areaRankings(kind);
  const byCode = new Map(stats.map((s) => [s.code, s]));
  const { rows } = await getPool().query<{ code: string; name: string; geom: string }>(
    `SELECT code, name, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.00005), 6) AS geom
     FROM data.boundaries WHERE kind = $1 AND code = ANY($2)`,
    [kind, stats.map((s) => s.code)],
  );
  return {
    type: "FeatureCollection" as const,
    features: rows.map((r) => ({
      type: "Feature" as const,
      properties: { ...byCode.get(r.code) },
      geometry: JSON.parse(r.geom),
    })),
  };
}
