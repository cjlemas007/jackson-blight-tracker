/** Weekly digest for the admin dashboard: what changed this week, and the biggest movers. */
import { getPool } from "./db";
import { SURVEY_VALID_DAYS } from "@/config";

export interface WeekCounts {
  verified: number;
  city_actions: number;
  demolished: number;
  resolved: number;
  submissions: number;
  approved: number;
  rejected: number;
  surveyed_parcels: number;
  corrections: number;
}

async function weekCounts(from: string): Promise<WeekCounts> {
  const { rows } = await getPool().query<WeekCounts>(
    `WITH w AS (SELECT $1::date AS s, $1::date + 7 AS e)
     SELECT
       (SELECT count(*) FROM app.first_entries('verified_blighted', NULL, (SELECT s FROM w), (SELECT e FROM w)))::int AS verified,
       (SELECT count(*) FROM app.status_events_live, w WHERE status = 'city_action' AND effective_date >= w.s AND effective_date < w.e)::int AS city_actions,
       (SELECT count(*) FROM app.first_entries('resolved', 'demolished', (SELECT s FROM w), (SELECT e FROM w)))::int AS demolished,
       (SELECT count(*) FROM app.status_events_live, w WHERE status = 'resolved' AND substatus <> 'rejected_on_recheck'
          AND effective_date >= w.s AND effective_date < w.e)::int AS resolved,
       (SELECT count(*) FROM app.submissions, w WHERE (submitted_at AT TIME ZONE 'America/Chicago')::date >= w.s
          AND (submitted_at AT TIME ZONE 'America/Chicago')::date < w.e)::int AS submissions,
       (SELECT count(*) FROM app.submissions, w WHERE status = 'approved' AND (reviewed_at AT TIME ZONE 'America/Chicago')::date >= w.s
          AND (reviewed_at AT TIME ZONE 'America/Chicago')::date < w.e)::int AS approved,
       (SELECT count(*) FROM app.submissions, w WHERE status = 'rejected' AND (reviewed_at AT TIME ZONE 'America/Chicago')::date >= w.s
          AND (reviewed_at AT TIME ZONE 'America/Chicago')::date < w.e)::int AS rejected,
       (SELECT count(DISTINCT parcel_id) FROM app.parcel_surveys, w WHERE surveyed_on >= w.s AND surveyed_on < w.e)::int AS surveyed_parcels,
       (SELECT count(*) FROM app.corrections, w WHERE (created_at AT TIME ZONE 'America/Chicago')::date >= w.s
          AND (created_at AT TIME ZONE 'America/Chicago')::date < w.e)::int AS corrections`,
    [from],
  );
  return rows[0];
}

export interface Mover {
  key: string;
  label: string;
  now: number;
  before: number;
  change: number;
}

/**
 * Change in blighted parcels over the last `days` days, by owner portfolio / street / ward /
 * neighborhood. Owners exclude homestead and estate parcels, as in the ranking.
 */
export async function movers(days = 7, limit = 8) {
  const pool = getPool();
  const q = (key: string, extra = "") =>
    pool.query<{ key: string; now: number; before: number }>(
      `WITH n AS (SELECT ${key} AS key, count(*) FILTER (WHERE blighted ${extra}) b FROM app.ranking_base((now() AT TIME ZONE 'America/Chicago')::date, $1) WHERE ${key} IS NOT NULL GROUP BY 1),
            p AS (SELECT ${key} AS key, count(*) FILTER (WHERE blighted ${extra}) b FROM app.ranking_base((now() AT TIME ZONE 'America/Chicago')::date - $2::int, $1) WHERE ${key} IS NOT NULL GROUP BY 1)
       SELECT n.key, n.b::int AS now, COALESCE(p.b, 0)::int AS before FROM n LEFT JOIN p USING (key)
       WHERE n.b <> COALESCE(p.b, 0) ORDER BY abs(n.b - COALESCE(p.b, 0)) DESC, n.b DESC LIMIT $3`,
      [SURVEY_VALID_DAYS, days, limit],
    );
  const [owners, streets, wards, nbhds] = await Promise.all([
    q("portfolio_id", "AND ranking_excluded_reason IS NULL"),
    q("street_name"),
    q("ward"),
    q("neighborhood"),
  ]);
  const ownerNames = new Map(
    (
      await pool.query<{ portfolio_id: string; name: string }>(
        `SELECT f.portfolio_id, COALESCE(max(p.display_name), mode() WITHIN GROUP (ORDER BY f.owner_name)) AS name
         FROM app.parcel_facts f LEFT JOIN app.portfolios p USING (portfolio_id)
         WHERE f.portfolio_id = ANY($1) GROUP BY 1`,
        [owners.rows.map((r) => r.key)],
      )
    ).rows.map((r) => [r.portfolio_id, r.name]),
  );
  const names = async (kind: string, keys: string[]) =>
    new Map(
      (await pool.query<{ code: string; name: string }>("SELECT code, name FROM data.boundaries WHERE kind = $1 AND code = ANY($2)", [kind, keys])).rows.map(
        (r) => [r.code, r.name],
      ),
    );
  const wardNames = await names("ward", wards.rows.map((r) => r.key));
  const nbNames = await names("neighborhood", nbhds.rows.map((r) => r.key));
  const shape = (rows: { key: string; now: number; before: number }[], label: (k: string) => string): Mover[] =>
    rows.map((r) => ({ key: r.key, label: label(r.key), now: r.now, before: r.before, change: r.now - r.before }));
  return {
    owners: shape(owners.rows, (k) => ownerNames.get(k) ?? k),
    streets: shape(streets.rows, (k) => k),
    wards: shape(wards.rows, (k) => wardNames.get(k) ?? `Ward ${k}`),
    neighborhoods: shape(nbhds.rows, (k) => nbNames.get(k) ?? k),
  };
}

export async function weeklyDigest() {
  const pool = getPool();
  const ws = (await pool.query<{ s: string }>("SELECT app.week_start()::text s")).rows[0].s;
  const prev = (await pool.query<{ s: string }>("SELECT ($1::date - 7)::text s", [ws])).rows[0].s;
  const [thisWeek, lastWeek, open] = await Promise.all([
    weekCounts(ws),
    weekCounts(prev),
    pool.query(
      `SELECT (SELECT count(*)::int FROM app.submissions WHERE status = 'pending') AS queue,
              (SELECT count(*)::int FROM app.submissions WHERE status = 'needs_photo') AS needs_photo,
              (SELECT count(*)::int FROM app.corrections WHERE status = 'open') AS corrections,
              (SELECT count(*)::int FROM app.suggestions WHERE status = 'open') AS suggestions,
              (SELECT count(*)::int FROM app.import_batches WHERE status IN ('mapping', 'review')) AS imports`,
    ),
  ]);
  return { week_start: ws, thisWeek, lastWeek, open: open.rows[0] };
}
