import type { Job } from "../runner";
import { clearSeen } from "../seen";
import { tx } from "../runner";
import { pageQuery, table } from "../bigquery";
import { COUNTY } from "@/config";

/**
 * Per-parcel tax summary from tax_history. Uses only the latest load of each parcel-year
 * (the table holds several overlapping loads). See data.parcel_tax for field meanings.
 */
export const TAX_SQL = `
WITH t AS (
  SELECT county, parcel_id, SAFE_CAST(tax_year AS INT64) AS yr, IFNULL(status, '') AS status,
         SAFE_CAST(REPLACE(amount_billed, ',', '') AS NUMERIC) AS billed,
         SAFE_CAST(REPLACE(amount_paid, ',', '') AS NUMERIC) AS paid,
         SAFE_CAST(REPLACE(balance_due, ',', '') AS NUMERIC) AS balance,
         SAFE_CAST(REPLACE(amount_still_owed, ',', '') AS NUMERIC) AS owed,
         SAFE_CAST(loaded_at AS TIMESTAMP) AS ts
  FROM ${table("tax_history")} WHERE county = @county
),
latest_load AS (SELECT county, parcel_id, yr, MAX(ts) AS ts FROM t GROUP BY 1, 2, 3),
cur AS (
  SELECT DISTINCT t.county, t.parcel_id, t.yr, t.status, t.billed, t.paid, t.balance, t.owed
  FROM t JOIN latest_load USING (county, parcel_id, yr, ts)
),
maxyr AS (SELECT MAX(yr) AS y FROM t),
due AS (
  SELECT *, (yr = (SELECT y FROM maxyr)) AS is_latest,
         CASE WHEN status = '' AND IFNULL(billed, 0) > 0
              THEN COALESCE(owed, balance, GREATEST(billed - IFNULL(paid, 0), 0)) END AS unpaid_amt,
         (status = '' AND IFNULL(billed, 0) > 0 AND owed IS NULL) AS unpaid_estimated
  FROM cur
)
SELECT county, parcel_id, MAX(yr) AS latest_tax_year,
  IFNULL(SUM(IF(is_latest, unpaid_amt, 0)), 0) AS current_due,
  LOGICAL_OR(is_latest AND unpaid_estimated) AS current_due_estimated,
  SUM(IF(is_latest, billed, NULL)) AS current_billed,
  ARRAY_AGG(DISTINCT IF(status = '' AND IFNULL(billed, 0) > 0, yr, NULL) IGNORE NULLS) AS unpaid_years,
  ARRAY_AGG(DISTINCT IF(status = 'Redeemed', yr, NULL) IGNORE NULLS) AS redeemed_years,
  (LOGICAL_OR(is_latest AND status = 'Paid') AND LOGICAL_OR(is_latest AND IFNULL(unpaid_amt, 0) > 0)) AS tax_conflict
FROM due GROUP BY 1, 2`;

interface TaxRow {
  county: string;
  parcel_id: string;
  latest_tax_year: number | null;
  current_due: { value: string } | string | number;
  current_due_estimated: boolean | null;
  current_billed: { value: string } | string | number | null;
  unpaid_years: number[];
  redeemed_years: number[];
  tax_conflict: boolean | null;
}

/** BigQuery NUMERIC arrives as a Big.js object (or {value}); stringify before Number(). */
export const bqNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const raw = typeof v === "object" && v !== null && "value" in v ? (v as { value: unknown }).value : v;
  const x = Number(String(raw));
  if (!Number.isFinite(x)) throw new Error(`unparseable BigQuery number: ${String(raw)}`);
  return x;
};
const n = bqNum;

export const taxJob: Job = {
  name: "tax",
  description: "Per-parcel tax delinquency summary from BigQuery tax_history",
  async run(ctx) {
    await pageQuery<TaxRow>(ctx, TAX_SQL, { county: COUNTY }, async (bqRows, nextCursor) => {
      const rows = bqRows.map((r) => ({
        county: r.county,
        parcel_id: r.parcel_id.trim(),
        latest_tax_year: r.latest_tax_year === null ? null : Number(r.latest_tax_year),
        current_due: n(r.current_due) ?? 0,
        current_due_estimated: !!r.current_due_estimated,
        current_billed: n(r.current_billed),
        unpaid_years: (r.unpaid_years ?? []).map(Number),
        redeemed_years: (r.redeemed_years ?? []).map(Number),
        tax_conflict: !!r.tax_conflict,
      }));
      await tx(ctx.pool, async (c) => {
        await c.query(
          `INSERT INTO data.parcel_tax (county, parcel_id, latest_tax_year, current_due, current_due_estimated,
             current_billed, unpaid_years, redeemed_years, tax_conflict, synced_at)
           SELECT county, parcel_id, latest_tax_year, current_due, current_due_estimated, current_billed,
                  unpaid_years, redeemed_years, tax_conflict, now()
           FROM json_populate_recordset(NULL::data.parcel_tax, $1::json)
           ON CONFLICT (county, parcel_id) DO UPDATE SET
             latest_tax_year = EXCLUDED.latest_tax_year, current_due = EXCLUDED.current_due,
             current_due_estimated = EXCLUDED.current_due_estimated, current_billed = EXCLUDED.current_billed,
             unpaid_years = EXCLUDED.unpaid_years, redeemed_years = EXCLUDED.redeemed_years,
             tax_conflict = EXCLUDED.tax_conflict, synced_at = now()
           WHERE (data.parcel_tax.latest_tax_year, data.parcel_tax.current_due, data.parcel_tax.current_due_estimated,
                  data.parcel_tax.current_billed, data.parcel_tax.unpaid_years, data.parcel_tax.redeemed_years, data.parcel_tax.tax_conflict)
             IS DISTINCT FROM
                 (EXCLUDED.latest_tax_year, EXCLUDED.current_due, EXCLUDED.current_due_estimated,
                  EXCLUDED.current_billed, EXCLUDED.unpaid_years, EXCLUDED.redeemed_years, EXCLUDED.tax_conflict)`,
          [JSON.stringify(rows)],
        );
        await c.query(
          `INSERT INTO data.sync_seen (run_id, county, parcel_id)
           SELECT $1, r.county, r.parcel_id FROM json_to_recordset($2::json) AS r(county text, parcel_id text) ON CONFLICT DO NOTHING`,
          [ctx.runId, JSON.stringify(rows.map((r) => ({ county: r.county, parcel_id: r.parcel_id })))],
        );
        await ctx.checkpoint(c, nextCursor, rows.length);
      });
    });
    // Parcels absent from this run no longer have tax rows upstream.
    // Same guard as the other jobs: a truncated upstream response must not wipe most of the county.
    const { rows: seenRows } = await ctx.pool.query<{ seen: number; total: number }>(
      `SELECT (SELECT count(*) FROM data.sync_seen WHERE run_id = $1 AND county = $2)::int seen,
              (SELECT count(*) FROM data.parcel_tax WHERE county = $2)::int total`,
      [ctx.runId, COUNTY],
    );
    if (seenRows[0].seen >= seenRows[0].total * 0.9) {
      const r = await ctx.pool.query(
        `DELETE FROM data.parcel_tax t WHERE t.county = $1
           AND NOT EXISTS (SELECT 1 FROM data.sync_seen s WHERE s.run_id = $2 AND s.county = t.county AND s.parcel_id = t.parcel_id)`,
        [COUNTY, ctx.runId],
      );
      ctx.stats.removed = r.rowCount;
    } else {
      ctx.stats.remove_skipped = `only ${seenRows[0].seen} of ${seenRows[0].total} seen`;
    }
    await clearSeen(ctx.pool, ctx.runId);
  },
};
