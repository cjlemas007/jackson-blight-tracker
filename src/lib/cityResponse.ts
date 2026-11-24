/**
 * The accountability page: what the City has done about verified blight, all from the dated
 * status history. Jackson parcels only.
 */
import { getPool } from "./db";

export const STALE_DAYS_DEFAULT = 90;
const today = "(now() AT TIME ZONE 'America/Chicago')::date";

export interface CityResponse {
  demolished: { week: number; month: number; year: number };
  stages: { substatus: string; parcels: number }[];
  city_only: number; // City-flagged: city action with no council finding, on parcels the newsroom never verified
  median_days_to_action: number | null;
  n_with_action: number;
  median_days_to_resolution: number | null;
  n_resolved: number;
  verified_total: number;
}

export async function cityResponse(): Promise<CityResponse> {
  const pool = getPool();
  const demo = (from: string) =>
    `(SELECT count(*) FROM app.first_entries('resolved', 'demolished', ${from}, ${today} + 1) e
       JOIN app.parcel_facts f USING (county, parcel_id) WHERE f.in_city)::int`;
  const { rows } = await pool.query(
    `SELECT ${demo("app.week_start()")} AS week,
            ${demo(`date_trunc('month', ${today})::date`)} AS month,
            ${demo(`date_trunc('year', ${today})::date`)} AS year`,
  );
  const { rows: stages } = await pool.query(
    `SELECT s.substatus, count(*)::int AS parcels
     FROM app.parcel_status_current s JOIN app.parcel_facts f USING (county, parcel_id)
     WHERE f.in_city AND s.status = 'city_action' GROUP BY 1`,
  );
  const { rows: m } = await pool.query(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY first_action_on - verified_on) FILTER (WHERE first_action_on IS NOT NULL) AS to_action,
            count(*) FILTER (WHERE first_action_on IS NOT NULL)::int AS n_action,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY resolved_on - verified_on) FILTER (WHERE resolved_on IS NOT NULL) AS to_resolution,
            count(*) FILTER (WHERE resolved_on IS NOT NULL)::int AS n_resolved,
            count(*)::int AS verified_total
     FROM app.parcel_milestones pm JOIN app.parcel_facts f USING (county, parcel_id) WHERE f.in_city`,
  );
  const { rows: co } = await pool.query(
    `SELECT count(*)::int n FROM app.city_flagged_as_of(${today}) s JOIN app.parcel_facts f USING (county, parcel_id) WHERE f.in_city`,
  );
  const order = ["cited", "hearing_set", "adjudicated", "demolition_ordered", "lot_cleanup_ordered", "lien_filed"];
  return {
    demolished: rows[0],
    stages: order.map((s) => ({ substatus: s, parcels: stages.find((x) => x.substatus === s)?.parcels ?? 0 })),
    city_only: co[0].n,
    median_days_to_action: m[0].to_action === null ? null : Number(m[0].to_action),
    n_with_action: m[0].n_action,
    median_days_to_resolution: m[0].to_resolution === null ? null : Number(m[0].to_resolution),
    n_resolved: m[0].n_resolved,
    verified_total: m[0].verified_total,
  };
}

/** Verified at least `days` ago, still blighted, and the City has never acted. Oldest first. */
export async function waitingOnCity(days = STALE_DAYS_DEFAULT, limit = 200) {
  const { rows } = await getPool().query(
    `SELECT pm.parcel_id, f.situs_address, f.owner_name, f.portfolio_id, f.ward, pm.verified_on::text,
            (${today} - pm.verified_on)::int AS days_waiting, count(*) OVER ()::int AS total
     FROM app.parcel_milestones pm
     JOIN app.parcel_facts f USING (county, parcel_id)
     JOIN app.parcel_status_current s USING (county, parcel_id)
     WHERE f.in_city AND pm.first_action_on IS NULL AND s.status = 'verified_blighted'
       AND pm.verified_on <= ${today} - $1::int
     ORDER BY pm.verified_on, f.situs_address
     LIMIT $2`,
    [days, limit],
  );
  return rows;
}

/** Recent public status changes with their source documents. */
export async function recentChanges(limit = 50) {
  const { rows } = await getPool().query(
    `SELECT e.id, e.parcel_id, f.situs_address, e.status::text, e.substatus, e.effective_date::text, e.source::text,
            CASE WHEN d.public THEN d.id END AS document_id, CASE WHEN d.public THEN COALESCE(d.title, d.original_name) END AS document_title
     FROM app.status_events_live e
     JOIN app.parcel_facts f USING (county, parcel_id)
     LEFT JOIN app.documents d ON d.id = e.document_id AND d.uploaded_at IS NOT NULL
     WHERE f.in_city AND e.status IN ('verified_blighted', 'city_action', 'resolved')
     ORDER BY e.effective_date DESC, e.recorded_at DESC, e.id DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

/** Stage priority for the staff "needs a newsroom check" list: strongest City findings first. */
export const FLAG_PRIORITY = ["demolition_ordered", "adjudicated", "lot_cleanup_ordered", "hearing_set", "lien_filed", "cited"];

/** City-flagged parcels (City acted, newsroom never verified) for staff to go photograph. */
export async function needsNewsroomCheck(opts: { ward?: string | null; limit?: number } = {}) {
  const { rows } = await getPool().query(
    `SELECT cf.parcel_id, cf.substatus, cf.since::text, f.situs_address, f.owner_name, f.ward, f.neighborhood,
            ST_Y(f.pt) AS lat, ST_X(f.pt) AS lon,
            EXISTS (SELECT 1 FROM app.submissions s WHERE s.county = cf.county AND s.parcel_id = cf.parcel_id
                    AND s.status IN ('processing', 'pending', 'needs_photo')) AS submission_open,
            count(*) OVER ()::int AS total
     FROM app.city_flagged_as_of(${today}) cf
     JOIN app.parcel_facts f USING (county, parcel_id)
     WHERE f.in_city AND ($1::text IS NULL OR f.ward = $1)
     ORDER BY array_position($2::text[], cf.substatus), cf.since, f.situs_address
     LIMIT $3`,
    [opts.ward || null, FLAG_PRIORITY, opts.limit ?? 300],
  );
  return rows;
}
