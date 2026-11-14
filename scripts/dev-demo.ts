/**
 * LOCAL DEVELOPMENT ONLY: fill the local database with fake status history and surveys so the
 * rankings, areas and counters have something to show.
 *   npm run dev:demo            add demo data (recorded_by 'dev-demo', note 'DEV DEMO DATA')
 *   npm run dev:demo -- --clear remove it
 * Refuses to run unless DATABASE_URL points at localhost.
 */
import { loadEnv } from "../sync/env";
loadEnv();
const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) || process.env.SUPABASE_URL || process.env.NODE_ENV === "production") {
  throw new Error("dev-demo only runs against a localhost database");
}
const { getPool } = await import("../src/lib/db");
const pool = getPool();
const NOTE = "DEV DEMO DATA";

if (process.argv.includes("--clear")) {
  await pool.query("ALTER TABLE app.status_events DISABLE TRIGGER status_events_append_only");
  await pool.query("ALTER TABLE app.parcel_surveys DISABLE TRIGGER parcel_surveys_append_only");
  const e = await pool.query("DELETE FROM app.status_events WHERE recorded_by = 'dev-demo'");
  const s = await pool.query("DELETE FROM app.parcel_surveys WHERE note = $1", [NOTE]);
  await pool.query("ALTER TABLE app.status_events ENABLE TRIGGER status_events_append_only");
  await pool.query("ALTER TABLE app.parcel_surveys ENABLE TRIGGER parcel_surveys_append_only");
  console.log(`removed ${e.rowCount} demo events and ${s.rowCount} demo surveys`);
} else {
  const admin = (await pool.query("SELECT id FROM app.staff WHERE role = 'admin' ORDER BY created_at LIMIT 1")).rows[0];
  if (!admin) throw new Error("create a staff admin first (npm run staff -- dev-accounts)");
  // ~400 parcels, biased toward low improvement value and unpaid taxes (more plausible demo).
  const picked = await pool.query(
    `INSERT INTO app.status_events (county, parcel_id, status, effective_date, source, recorded_by, note)
     SELECT county, parcel_id, 'verified_blighted', (now() AT TIME ZONE 'America/Chicago')::date - (random() * 120)::int,
            'admin_entry', 'dev-demo', $1
     FROM app.parcel_facts f
     WHERE f.in_city AND NOT EXISTS (SELECT 1 FROM app.status_events e WHERE e.county = f.county AND e.parcel_id = f.parcel_id)
     ORDER BY (COALESCE(f.delinquent, false)::int + (COALESCE(f.tv_imp, 0) < 20000)::int) * random() DESC
     LIMIT 400
     RETURNING county, parcel_id, effective_date`,
    [NOTE],
  );
  const ids = picked.rows;
  // A quarter get city action; a few of those are demolished, some this week.
  for (const [i, r] of ids.entries()) {
    if (i % 4 !== 0) continue;
    const cited = `('${r.effective_date}'::date + 7 + (random() * 20)::int)`;
    await pool.query(
      `INSERT INTO app.status_events (county, parcel_id, status, substatus, effective_date, source, recorded_by, note)
       VALUES ($1, $2, 'city_action', 'cited', LEAST(${cited}, (now() AT TIME ZONE 'America/Chicago')::date), 'city_record', 'dev-demo', $3)`,
      [r.county, r.parcel_id, NOTE],
    );
    if (i % 20 === 0) {
      await pool.query(
        `INSERT INTO app.status_events (county, parcel_id, status, substatus, effective_date, source, recorded_by, note)
         VALUES ($1, $2, 'resolved', 'demolished', (now() AT TIME ZONE 'America/Chicago')::date - $3::int, 'city_record', 'dev-demo', $4)`,
        [r.county, r.parcel_id, i % 40 === 0 ? 0 : 10, NOTE],
      );
    }
  }
  // Fully survey the three streets with the most demo blight (with at least 10 parcels).
  const streets = await pool.query(
    `SELECT f.street_name FROM app.parcel_facts f
     JOIN app.blighted_as_of((now() AT TIME ZONE 'America/Chicago')::date) b USING (county, parcel_id)
     WHERE f.in_city AND f.street_name IN (SELECT street_name FROM app.parcel_facts WHERE in_city GROUP BY 1 HAVING count(*) BETWEEN 10 AND 80)
     GROUP BY 1 ORDER BY count(*) DESC LIMIT 3`,
  );
  const sv = await pool.query(
    `INSERT INTO app.parcel_surveys (county, parcel_id, surveyed_on, result, surveyed_by, note)
     SELECT f.county, f.parcel_id, (now() AT TIME ZONE 'America/Chicago')::date - 3,
            CASE WHEN b.parcel_id IS NULL THEN 'not_blighted' ELSE 'blighted' END, $2, $3
     FROM app.parcel_facts f
     LEFT JOIN app.blighted_as_of((now() AT TIME ZONE 'America/Chicago')::date) b USING (county, parcel_id)
     WHERE f.in_city AND f.street_name = ANY($1)`,
    [streets.rows.map((r) => r.street_name), admin.id, NOTE],
  );
  console.log(`demo: ${ids.length} verified parcels, ${sv.rowCount} surveys on ${streets.rows.map((r) => r.street_name).join(", ")}`);
}
await pool.end();
