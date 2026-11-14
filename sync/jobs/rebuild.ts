import type { Job } from "../runner";

/** Logic-layer rebuild: spatial area assignment + parcel fact table. */
export const rebuildJob: Job = {
  name: "rebuild",
  description: "Assign ward/neighborhood/ZIP/tract/street and refresh app.parcel_facts",
  async run(ctx) {
    const { rows } = await ctx.pool.query<{ n: number }>("SELECT app.rebuild_parcel_facts() AS n");
    ctx.stats.parcels = rows[0].n;
    const s = await ctx.pool.query(`
      SELECT count(*) FILTER (WHERE in_city) in_city, count(*) FILTER (WHERE in_city AND ward IS NULL) in_city_no_ward,
             count(*) FILTER (WHERE location_source = 'none') unlocated
      FROM app.parcel_facts`);
    Object.assign(ctx.stats, s.rows[0]);
  },
};
