import type { Job } from "../runner";
import { tx } from "../runner";
import { parseCsv, toCsv } from "@/lib/csv";
import { CENSUS_BATCH_GEOCODER } from "../sources";
import { COUNTY } from "@/config";

const BATCH = 1000;

/**
 * Locates land roll parcels that have no GIS polygon, cheapest method first:
 *   1. same house number + street as exactly one GIS parcel        -> gis_situs_match
 *   2. parent parcel id (4854-104-6 -> 4854-104) has a polygon      -> gis_parent_parcel
 *   3. Census batch geocoder (Jackson, MS)                          -> census
 *   4. otherwise                                                    -> none
 * Results are kept until the parcel's situs address changes.
 */
export const geocodeJob: Job = {
  name: "geocode",
  description: "Fallback locations for land roll parcels without a GIS polygon",
  async run(ctx) {
    // Drop stale geocodes (address changed, or the parcel now has a polygon).
    await ctx.pool.query(`
      DELETE FROM data.geocodes gc USING data.landroll_parcels l
      WHERE gc.county = l.county AND gc.parcel_id = l.parcel_id
        AND (gc.input_address IS DISTINCT FROM COALESCE(l.situs_address, '')
             OR EXISTS (SELECT 1 FROM data.gis_parcels g WHERE g.county = l.county AND g.parcel_id = l.parcel_id AND g.retired_at IS NULL))`);

    const pending = `
      SELECT l.county, l.parcel_id, l.situs_number, l.situs_street, COALESCE(l.situs_address, '') AS situs_address
      FROM data.landroll_parcels l
      WHERE l.county = '${COUNTY}' AND l.retired_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM data.gis_parcels g WHERE g.county = l.county AND g.parcel_id = l.parcel_id AND g.retired_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM data.geocodes gc WHERE gc.county = l.county AND gc.parcel_id = l.parcel_id)`;

    const s1 = await ctx.pool.query(`
      INSERT INTO data.geocodes (county, parcel_id, method, input_address, matched, pt)
      SELECT p.county, p.parcel_id, 'gis_situs_match', p.situs_address, m.parcel_id, m.pt
      FROM (${pending}) p
      JOIN LATERAL (
        SELECT min(g.parcel_id) AS parcel_id, (array_agg(g.pt))[1] AS pt
        FROM data.gis_parcels g
        WHERE g.county = p.county AND g.retired_at IS NULL AND g.loc_num = p.situs_number AND g.loc_street = p.situs_street
        HAVING count(*) = 1
      ) m ON true
      WHERE p.situs_number IS NOT NULL`);
    ctx.stats.gis_situs_match = s1.rowCount;

    const s2 = await ctx.pool.query(`
      INSERT INTO data.geocodes (county, parcel_id, method, input_address, matched, pt)
      SELECT p.county, p.parcel_id, 'gis_parent_parcel', p.situs_address, g.parcel_id, g.pt
      FROM (${pending}) p
      JOIN data.gis_parcels g
        ON g.county = p.county AND g.retired_at IS NULL
       AND g.parcel_id = regexp_replace(p.parcel_id, '-[^-]+$', '')
      WHERE p.parcel_id ~ '-.*-'`);
    ctx.stats.gis_parent_parcel = s2.rowCount;

    // Census batches, resumable: each batch commits its results + cursor together.
    let census = 0;
    for (;;) {
      const batch = (
        await ctx.pool.query<{ county: string; parcel_id: string; situs_number: number; situs_street: string; situs_address: string }>(
          `${pending} AND l.situs_number IS NOT NULL AND l.situs_street IS NOT NULL ORDER BY l.parcel_id LIMIT ${BATCH}`,
        )
      ).rows;
      if (!batch.length) break;
      const form = new FormData();
      form.append("benchmark", "Public_AR_Current");
      form.append(
        "addressFile",
        new Blob([toCsv(batch.map((b, i) => [i, `${b.situs_number} ${b.situs_street}`, "Jackson", "MS", ""]))], { type: "text/csv" }),
        "batch.csv",
      );
      const res = await fetch(CENSUS_BATCH_GEOCODER, { method: "POST", body: form, signal: AbortSignal.timeout(600_000) });
      if (!res.ok) throw new Error(`Census geocoder HTTP ${res.status}`);
      const results = new Map<number, { matched: string; lon: number; lat: number }>();
      for (const r of parseCsv(await res.text())) {
        if (r[2] === "Match" && r[5]) {
          const [lon, lat] = r[5].split(",").map(Number);
          results.set(Number(r[0]), { matched: r[4], lon, lat });
        }
      }
      const rows = batch.map((b, i) => {
        const hit = results.get(i);
        return {
          county: b.county,
          parcel_id: b.parcel_id,
          method: hit ? "census" : "none",
          input_address: b.situs_address,
          matched: hit?.matched ?? null,
          lon: hit?.lon ?? null,
          lat: hit?.lat ?? null,
        };
      });
      await tx(ctx.pool, async (c) => {
        await c.query(
          `INSERT INTO data.geocodes (county, parcel_id, method, input_address, matched, pt)
           SELECT county, parcel_id, method, input_address, matched,
                  CASE WHEN lon IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(lon, lat), 4326) END
           FROM json_to_recordset($1::json) AS r(county text, parcel_id text, method text, input_address text,
                                                matched text, lon float8, lat float8)`,
          [JSON.stringify(rows)],
        );
        await ctx.checkpoint(c, { lastParcel: batch[batch.length - 1].parcel_id }, rows.length);
      });
      census += results.size;
      ctx.log(`census batch: ${results.size}/${batch.length} matched`);
    }
    ctx.stats.census = census;

    // Everything left (no house number, etc.) is recorded as unlocatable until its address changes.
    const s4 = await ctx.pool.query(`
      INSERT INTO data.geocodes (county, parcel_id, method, input_address)
      SELECT county, parcel_id, 'none', situs_address FROM (${pending}) p`);
    ctx.stats.none = s4.rowCount;
  },
};
