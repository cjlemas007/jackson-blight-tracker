import type { Job } from "../runner";
import { fetchJson, num, str, tx } from "../runner";
import { queryUrl, type GeoJsonFeature } from "../arcgis";
import { PARCELS_LAYER } from "../sources";
import { cleanText, normalizeStreetName } from "@/lib/normalize/address";
import { classifyOwner, isEstateOrHeirs } from "@/lib/normalize/owner";

const PAGE = 2000;
/** The layer's objectIdField. Not "OBJECTID": that attribute exists but has duplicate values. */
const OID = "FID";

/** Normalized attributes kept from the assessor fields (all space-padded text upstream). */
export function normalizeGisAttrs(p: Record<string, unknown>) {
  const ns = str(p.loc_ns);
  const alpha = str(p.loc_alpha);
  const locNum = num(p.loc_num);
  const bldgYear = num(p.bm_year);
  const owner = cleanText([str(p.name1), str(p.name2)].filter(Boolean).join(" ")) || null;
  return {
    parcel_id: str(p.PARCEL_F) ?? str(p.parcel_f_1),
    dpin: str(p.DPIN) ?? str(p.parcel),
    owner_name_gis: owner,
    owner_type: classifyOwner(owner),
    owner_estate_heirs: isEstateOrHeirs(owner),
    tv_land: num(p.tv_land),
    tv_imp: num(p.tv_imp),
    ass_land: num(p.ass_land),
    ass_imp: num(p.ass_imp),
    homestead_app: str(p.he_1),
    tax_dist: str(p.tax_dist),
    land_use_code: str(p.lv_use_cod),
    bldg_cond: str(p.bm_cond),
    bldg_year: bldgYear && bldgYear > 1700 ? bldgYear : null,
    sales_date: str(p.sales_date),
    sales_amt: num(p.sales_amt),
    loc_num: locNum && locNum > 0 ? locNum : null,
    loc_street: alpha ? normalizeStreetName([ns, alpha].filter(Boolean).join(" ")) : null,
    acres_gis: num(p.acres_gis),
  };
}

interface Cursor {
  phase?: "pages" | "finalized";
  lastOid?: number;
}

/**
 * Pulls the countywide parcel polygon layer page by page (resumable by FID), then
 * merges multi-part parcels and upserts data.gis_parcels with a change log for improvement value.
 */
export const gisParcelsJob: Job = {
  name: "gis_parcels",
  description: "Parcel polygons + assessor attributes from the City of Jackson parcel layer",
  async run(ctx) {
    const cur = ctx.cursor as Cursor;
    let lastOid = cur.lastOid ?? 0;

    if (cur.phase !== "finalized") {
      for (;;) {
        const fc = await fetchJson<{ features: GeoJsonFeature[] }>(
          queryUrl(PARCELS_LAYER, {
            where: `${OID} > ${lastOid}`,
            outFields: "*",
            orderByFields: `${OID} ASC`,
            resultRecordCount: PAGE,
            returnGeometry: true,
            outSR: 4326,
            f: "geojson",
          }),
        );
        if (!fc.features.length) break;
        const rows = fc.features.map((f) => {
          const oid = Number(f.properties[OID] ?? f.id);
          const norm = normalizeGisAttrs(f.properties);
          return { objectid: oid, parcel_id: norm.parcel_id, attrs: norm, geom: f.geometry ? JSON.stringify(f.geometry) : null };
        });
        const maxOid = Math.max(...rows.map((r) => r.objectid));
        await tx(ctx.pool, async (c) => {
          await c.query(
            `INSERT INTO data.gis_parcels_stage (run_id, objectid, parcel_id, attrs, geom)
             SELECT $1, r.objectid, r.parcel_id, r.attrs,
                    CASE WHEN r.geom IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON(r.geom), 4326) END
             FROM json_to_recordset($2::json) AS r(objectid int, parcel_id text, attrs jsonb, geom text)
             ON CONFLICT DO NOTHING`,
            [ctx.runId, JSON.stringify(rows)],
          );
          await ctx.checkpoint(c, { phase: "pages", lastOid: maxOid }, rows.length);
        });
        lastOid = maxOid;
        ctx.log(`staged through FID ${lastOid} (${fc.features.length})`);
        // Don't stop on a short page: the server trims pages by transfer size. Only an empty page ends it.
      }
    }

    // The layer's last edit date is the "owner as of" date for parcels only on the parcel map.
    const meta = await fetchJson<{ editingInfo?: { lastEditDate?: number } }>(`${PARCELS_LAYER}?f=json`);
    const editedAt = meta.editingInfo?.lastEditDate ? new Date(meta.editingInfo.lastEditDate).toISOString() : null;
    ctx.stats.layer_edited_at = editedAt;

    // Finalize: merge parts, log changes, upsert, retire missing.
    await tx(ctx.pool, async (c) => {
      const staged = (
        await c.query<{ n: number; with_id: number }>(
          "SELECT count(*) n, count(parcel_id) with_id FROM data.gis_parcels_stage WHERE run_id = $1",
          [ctx.runId],
        )
      ).rows[0];
      ctx.stats.features = staged.n;
      ctx.stats.features_without_parcel_id = staged.n - staged.with_id;

      // CREATE TABLE AS can't take bind parameters; runId is a UUID this process generated.
      await c.query(`CREATE TEMP TABLE gis_new ON COMMIT DROP AS
        WITH parts AS (
          SELECT parcel_id, objectid, attrs, ST_MakeValid(geom) AS geom
          FROM data.gis_parcels_stage
          WHERE run_id = '${ctx.runId}' AND parcel_id IS NOT NULL AND geom IS NOT NULL
        ), agg AS (
          SELECT parcel_id,
                 ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(geom)), 3)) AS geom,
                 (array_agg(attrs ORDER BY objectid DESC))[1] AS a,
                 count(*)::int AS parts
          FROM parts GROUP BY parcel_id
        )
        SELECT 'Hinds'::text AS county, parcel_id, geom, a, parts, md5(a::text || ST_AsBinary(geom)::text) AS row_hash
        FROM agg WHERE NOT ST_IsEmpty(geom)`);

      const changes = await c.query(
        `INSERT INTO data.parcel_field_changes (county, parcel_id, source, field, old_value, new_value, run_id)
         SELECT g.county, g.parcel_id, 'gis', 'tv_imp', g.tv_imp::text, (n.a->>'tv_imp'), $1
         FROM gis_new n JOIN data.gis_parcels g USING (county, parcel_id)
         WHERE g.tv_imp IS DISTINCT FROM (n.a->>'tv_imp')::numeric`,
        [ctx.runId],
      );
      ctx.stats.tv_imp_changes = changes.rowCount;

      const up = await c.query(
        `INSERT INTO data.gis_parcels AS t (county, parcel_id, dpin, geom, geom_3857, pt, owner_name_gis,
           owner_type, owner_estate_heirs, source_edited_at,
           tv_land, tv_imp, ass_land, ass_imp, homestead_app, tax_dist, land_use_code, bldg_cond, bldg_year,
           sales_date, sales_amt, loc_num, loc_street, acres_gis, part_count, row_hash, last_seen_at, retired_at)
         SELECT county, parcel_id, a->>'dpin', geom, ST_Transform(geom, 3857), ST_PointOnSurface(geom), a->>'owner_name_gis',
           COALESCE(a->>'owner_type', 'private'), COALESCE((a->>'owner_estate_heirs')::boolean, false), $1::timestamptz,
           (a->>'tv_land')::numeric, (a->>'tv_imp')::numeric, (a->>'ass_land')::numeric, (a->>'ass_imp')::numeric,
           a->>'homestead_app', a->>'tax_dist', a->>'land_use_code', a->>'bldg_cond', (a->>'bldg_year')::int,
           a->>'sales_date', (a->>'sales_amt')::numeric, (a->>'loc_num')::int, a->>'loc_street', (a->>'acres_gis')::numeric,
           parts, row_hash, now(), NULL
         FROM gis_new
         ON CONFLICT (county, parcel_id) DO UPDATE SET
           dpin = EXCLUDED.dpin, geom = EXCLUDED.geom, geom_3857 = EXCLUDED.geom_3857, pt = EXCLUDED.pt,
           owner_name_gis = EXCLUDED.owner_name_gis, owner_type = EXCLUDED.owner_type,
           owner_estate_heirs = EXCLUDED.owner_estate_heirs, source_edited_at = EXCLUDED.source_edited_at, tv_land = EXCLUDED.tv_land, tv_imp = EXCLUDED.tv_imp,
           ass_land = EXCLUDED.ass_land, ass_imp = EXCLUDED.ass_imp, homestead_app = EXCLUDED.homestead_app,
           tax_dist = EXCLUDED.tax_dist, land_use_code = EXCLUDED.land_use_code, bldg_cond = EXCLUDED.bldg_cond,
           bldg_year = EXCLUDED.bldg_year, sales_date = EXCLUDED.sales_date, sales_amt = EXCLUDED.sales_amt,
           loc_num = EXCLUDED.loc_num, loc_street = EXCLUDED.loc_street, acres_gis = EXCLUDED.acres_gis,
           part_count = EXCLUDED.part_count, row_hash = EXCLUDED.row_hash, last_seen_at = now(), retired_at = NULL
         -- Unchanged rows aren't rewritten: every rewrite leaves a dead copy behind, and doing that to
         -- the whole county each night doubled the table on the size-capped database.
         WHERE t.row_hash IS DISTINCT FROM EXCLUDED.row_hash OR t.retired_at IS NOT NULL`,
        [editedAt],
      );
      const seen = Number((await c.query("SELECT count(*) n FROM gis_new")).rows[0].n);
      ctx.stats.parcels = seen;
      ctx.stats.changed = up.rowCount;

      // Guard: a truncated upstream response must not retire most of the county.
      const active = Number(
        (await c.query("SELECT count(*) n FROM data.gis_parcels WHERE retired_at IS NULL")).rows[0].n,
      );
      if (seen >= active * 0.9) {
        const r = await c.query(
          `UPDATE data.gis_parcels g SET retired_at = now()
           WHERE g.retired_at IS NULL AND NOT EXISTS (SELECT 1 FROM gis_new n WHERE n.county = g.county AND n.parcel_id = g.parcel_id)`,
        );
        ctx.stats.retired = r.rowCount;
      } else {
        ctx.stats.retire_skipped = `only ${seen} of ${active} seen`;
      }
      // TRUNCATE (not DELETE) hands the staging table's space back; runs never overlap (one job at a time).
      await c.query("TRUNCATE data.gis_parcels_stage");
      await ctx.checkpoint(c, { phase: "finalized", lastOid });
    });
  },
};
