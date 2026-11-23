import type pg from "pg";

/**
 * Drop a finished run's rows from data.sync_seen. When no other run is mid-way (one that died and
 * will resume), TRUNCATE instead so the table's space goes back to the size-capped database.
 */
export async function clearSeen(pool: pg.Pool, runId: string) {
  await pool.query("DELETE FROM data.sync_seen WHERE run_id = $1", [runId]);
  const { rows } = await pool.query("SELECT 1 FROM data.sync_seen LIMIT 1");
  if (!rows.length) await pool.query("TRUNCATE data.sync_seen");
}
