import type { Job } from "../runner";
import { tx } from "../runner";
import { fetchAllGeoJson } from "../arcgis";
import { BOUNDARY_SOURCES } from "../sources";

/** Loads city limits, wards, neighborhoods, ZCTAs and tracts. Checkpoints per layer. */
export const boundariesJob: Job = {
  name: "boundaries",
  description: "City limits, wards, neighborhoods, ZIP (ZCTA), census tracts",
  async run(ctx) {
    const done = new Set((ctx.cursor.done as string[] | undefined) ?? []);
    for (const src of BOUNDARY_SOURCES) {
      if (done.has(src.kind)) continue;
      const features = (await fetchAllGeoJson(src.url, src.where, { envelope: src.envelope })).filter((f) => f.geometry);
      if (!features.length) throw new Error(`${src.kind}: source returned no features (${src.url})`);

      const rows = features.map((f) => ({
        code: src.code(f.properties),
        name: src.name(f.properties),
        props: f.properties,
        geom: JSON.stringify(f.geometry),
      }));

      await tx(ctx.pool, async (c) => {
        await c.query("DELETE FROM data.boundaries WHERE kind = $1", [src.kind]);
        await c.query(
          `INSERT INTO data.boundaries (kind, code, name, unofficial, source, source_url, props, geom)
           SELECT $1, r.code, min(r.name), $2, $3, $4, (array_agg(r.props))[1],
                  ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(ST_SetSRID(ST_GeomFromGeoJSON(r.geom), 4326))), 3))
           FROM json_to_recordset($5::json) AS r(code text, name text, props jsonb, geom text)
           GROUP BY r.code`,
          [src.kind, !!src.unofficial, src.label, src.url, JSON.stringify(rows)],
        );
        done.add(src.kind);
        await ctx.checkpoint(c, { done: [...done] }, features.length);
      });
      ctx.stats[src.kind] = new Set(rows.map((r) => r.code)).size;
      ctx.log(`${src.kind}: ${features.length} features -> ${ctx.stats[src.kind]} boundaries`);
    }
  },
};
