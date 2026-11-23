import { createHash } from "node:crypto";
import type { Job } from "../runner";
import { clearSeen } from "../seen";
import { tx } from "../runner";
import { pageQuery, table } from "../bigquery";
import { COUNTY } from "@/config";
import { cleanText, mailingKey, normalizeMailingStreet, parseSitus, repairMailing } from "@/lib/normalize/address";
import { classifyOwner, isEstateOrHeirs } from "@/lib/normalize/owner";

export interface BqLandrollRow {
  county: string;
  parcel_id: string;
  owner_name: string | null;
  mailing_street: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
  property_address: string | null;
  appraised_total: string | null;
  assessed_total: string | null;
  acreage: string | null;
  legal_description: string | null;
  deed_date: string | null;
  year_built: string | null;
  loaded_at: string | null;
}

const money = (v: string | null) => {
  const s = (v ?? "").replace(/[$,\s]/g, "");
  return s && Number.isFinite(Number(s)) ? Number(s) : null;
};

/** "12/28/1953" -> "1953-12-28"; anything unparseable -> null. */
export function parseUsDate(v: string | null): string | null {
  const m = (v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, d, y] = m.map(Number);
  if (y < 1800) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Reject impossible dates the roll contains (e.g. 09/31/1990) instead of letting JS roll them over.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** BigQuery land roll row -> data.landroll_parcels row. Pure; tested in tests/landroll.test.ts. */
export function transformLandrollRow(r: BqLandrollRow) {
  const m = repairMailing({ street: r.mailing_street, city: r.mailing_city, state: r.mailing_state, zip: r.mailing_zip });
  const situs = parseSitus(r.property_address);
  const yb = Number((r.year_built ?? "").trim());
  const owner = cleanText(r.owner_name) || null;
  const row = {
    county: r.county,
    parcel_id: r.parcel_id.trim(),
    owner_name: owner,
    owner_type: classifyOwner(owner),
    owner_estate_heirs: isEstateOrHeirs(owner),
    mailing_care_of: m.careOf,
    mailing_street: m.street || null,
    mailing_city: m.city || null,
    mailing_state: m.state || null,
    mailing_zip: m.zip || null,
    mailing_repaired: m.repaired,
    mailing_key: mailingKey({ street: r.mailing_street, city: r.mailing_city, state: r.mailing_state }),
    mailing_street_key: normalizeMailingStreet(m.street),
    situs_address: cleanText(r.property_address) || null,
    situs_number: situs.number,
    situs_street: situs.street,
    appraised_total: money(r.appraised_total),
    assessed_total: money(r.assessed_total),
    acreage: money(r.acreage),
    legal_description: (r.legal_description ?? "").trim() || null,
    deed_date: parseUsDate(r.deed_date),
    year_built: Number.isFinite(yb) && yb > 1700 ? yb : null,
    source_loaded_at: r.loaded_at ? new Date(/[Z+]/.test(r.loaded_at.slice(19)) ? r.loaded_at : `${r.loaded_at}Z`).toISOString() : null,
  };
  const { source_loaded_at: _ignored, ...hashed } = row;
  return { ...row, row_hash: createHash("md5").update(JSON.stringify(hashed)).digest("hex") };
}

/** Fields whose changes are logged for admin review (ownership transfer etc.). */
const TRACKED = ["owner_name", "mailing_key", "appraised_total", "assessed_total", "deed_date"] as const;

const COLS = [
  "county", "parcel_id", "owner_name", "owner_type", "owner_estate_heirs", "mailing_care_of", "mailing_street",
  "mailing_city", "mailing_state", "mailing_zip", "mailing_repaired", "mailing_key", "mailing_street_key",
  "situs_address", "situs_number", "situs_street", "appraised_total", "assessed_total", "acreage",
  "legal_description", "deed_date", "year_built", "source_loaded_at", "row_hash",
];

export const landrollJob: Job = {
  name: "landroll",
  description: "Hinds land roll from BigQuery (deduped to the latest load per parcel)",
  async run(ctx) {
    const sql = `
      SELECT * EXCEPT (rn) FROM (
        SELECT county, parcel_id, owner_name, mailing_street, mailing_city, mailing_state, mailing_zip,
               property_address, appraised_total, assessed_total, acreage, legal_description, deed_date,
               year_built, loaded_at,
               ROW_NUMBER() OVER (PARTITION BY county, parcel_id ORDER BY SAFE_CAST(loaded_at AS TIMESTAMP) DESC) AS rn
        FROM ${table("properties")}
        WHERE county = @county AND parcel_id IS NOT NULL AND TRIM(parcel_id) != ''
      ) WHERE rn = 1`;

    await pageQuery<BqLandrollRow>(ctx, sql, { county: COUNTY }, async (bqRows, nextCursor) => {
      // Dedupe within the page defensively (PK collisions would abort the page).
      const rows = [...new Map(bqRows.map((r) => [r.parcel_id.trim(), transformLandrollRow(r)])).values()];
      await tx(ctx.pool, async (c) => {
        await c.query(`CREATE TEMP TABLE lr_page ON COMMIT DROP AS
          SELECT ${COLS.join(", ")} FROM data.landroll_parcels WITH NO DATA`);
        await c.query(
          `INSERT INTO lr_page (${COLS.join(", ")})
           SELECT ${COLS.join(", ")} FROM json_populate_recordset(NULL::lr_page, $1::json)`,
          [JSON.stringify(rows)],
        );
        for (const f of TRACKED) {
          await c.query(
            `INSERT INTO data.parcel_field_changes (county, parcel_id, source, field, old_value, new_value, run_id)
             SELECT p.county, p.parcel_id, 'landroll', $1, o.${f}::text, p.${f}::text, $2
             FROM lr_page p JOIN data.landroll_parcels o USING (county, parcel_id)
             WHERE o.row_hash <> p.row_hash AND o.${f} IS DISTINCT FROM p.${f}`,
            [f, ctx.runId],
          );
        }
        await c.query(
          `INSERT INTO data.sync_seen (run_id, county, parcel_id) SELECT $1, county, parcel_id FROM lr_page ON CONFLICT DO NOTHING`,
          [ctx.runId],
        );
        // Only rows that changed (or came back) are written; see db/migrations/data/0002_sync_seen.sql.
        await c.query(
          `INSERT INTO data.landroll_parcels AS t (${COLS.join(", ")}, last_seen_at, retired_at)
           SELECT ${COLS.join(", ")}, now(), NULL FROM lr_page
           ON CONFLICT (county, parcel_id) DO UPDATE SET
           ${COLS.filter((c) => c !== "county" && c !== "parcel_id").map((c) => `${c} = EXCLUDED.${c}`).join(", ")},
           last_seen_at = now(), retired_at = NULL
           WHERE t.row_hash IS DISTINCT FROM EXCLUDED.row_hash OR t.retired_at IS NOT NULL`,
        );
        await ctx.checkpoint(c, nextCursor, rows.length);
      });
      ctx.log(`upserted ${rows.length} (page ${nextCursor.pages})`);
    });

    // Retire parcels that dropped off the roll, unless this run saw suspiciously few.
    const { rows } = await ctx.pool.query<{ seen: number; active: number }>(
      `SELECT (SELECT count(*) FROM data.sync_seen WHERE run_id = $1 AND county = $2)::int seen,
              (SELECT count(*) FROM data.landroll_parcels WHERE county = $2 AND retired_at IS NULL)::int active`,
      [ctx.runId, COUNTY],
    );
    ctx.stats.seen = rows[0].seen;
    if (rows[0].seen >= rows[0].active * 0.9) {
      const r = await ctx.pool.query(
        `UPDATE data.landroll_parcels l SET retired_at = now()
         WHERE l.county = $1 AND l.retired_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM data.sync_seen s WHERE s.run_id = $2 AND s.county = l.county AND s.parcel_id = l.parcel_id)`,
        [COUNTY, ctx.runId],
      );
      ctx.stats.retired = r.rowCount;
    } else {
      ctx.stats.retire_skipped = `only ${rows[0].seen} of ${rows[0].active} seen`;
    }
    await clearSeen(ctx.pool, ctx.runId);
  },
};
