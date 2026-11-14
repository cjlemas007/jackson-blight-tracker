/** Data for embeddable charts. */
import { getPool } from "./db";

export interface WeekPoint { week: string; verified: number; demolished: number; city_actions: number }

/** New verifications, demolitions and City actions per week (Monday start, Central), oldest first. */
export async function weeklyTrend(weeks = 12): Promise<WeekPoint[]> {
  const n = Math.min(104, Math.max(2, Math.floor(weeks)));
  const { rows } = await getPool().query<WeekPoint>(
    `WITH w AS (SELECT generate_series(app.week_start() - ($1::int - 1) * 7, app.week_start(), interval '7 days')::date AS s)
     SELECT w.s::text AS week,
       (SELECT count(*) FROM app.first_entries('verified_blighted', NULL, w.s, w.s + 7) e JOIN app.parcel_facts f USING (county, parcel_id) WHERE f.in_city)::int AS verified,
       (SELECT count(*) FROM app.first_entries('resolved', 'demolished', w.s, w.s + 7) e JOIN app.parcel_facts f USING (county, parcel_id) WHERE f.in_city)::int AS demolished,
       (SELECT count(*) FROM app.status_events_live e JOIN app.parcel_facts f USING (county, parcel_id)
          WHERE f.in_city AND e.status = 'city_action' AND e.effective_date >= w.s AND e.effective_date < w.s + 7)::int AS city_actions
     FROM w ORDER BY w.s`,
    [n],
  );
  return rows;
}
