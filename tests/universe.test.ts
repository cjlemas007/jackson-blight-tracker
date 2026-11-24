import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshTestDb } from "./helpers/testdb";

/**
 * Which parcels count. Land roll parcels always do; parcel-map-only parcels (often tax-exempt) count
 * unless they are the same property already on the roll under another ID, or have no owner of record.
 */
let pool: pg.Pool;
let universe: Record<string, string>;

async function roll(id: string, owner = "ROLL OWNER", situsNumber: number | null = null) {
  await pool.query(
    `INSERT INTO data.landroll_parcels (county, parcel_id, owner_name, owner_type, mailing_key, row_hash, situs_number)
     VALUES ('Hinds', $1, $2, 'private', '1 MAIN ST|JACKSON|MS', 'x', $3)`,
    [id, owner, situsNumber],
  );
}

async function map(id: string, owner: string | null, ownerType = "private", x = 0, locNum: number | null = null) {
  // 10m squares placed apart so nothing overlaps.
  await pool.query(
    `INSERT INTO data.gis_parcels (county, parcel_id, geom, geom_3857, pt, owner_name_gis, owner_type, row_hash, loc_num)
     SELECT 'Hinds', $1, g, ST_Transform(g, 3857), ST_PointOnSurface(g), $2, $3, 'x', $5
     FROM (SELECT ST_Multi(ST_MakeEnvelope(-90.2 + $4 * 0.001, 32.3, -90.1999 + $4 * 0.001, 32.3001, 4326)) AS g) s`,
    [id, owner, ownerType, x, locNum],
  );
}

beforeAll(async () => {
  pool = await freshTestDb();
  await roll("100-1");
  await map("100-1", "ROLL OWNER", "private", 1); // on both: counted once, as land roll
  await roll("200-5-1");
  await map("200-5", "FOUNDATION INC", "private", 2); // ID is the prefix of a roll parcel, but a separate property: count
  await map("300-7", "CITY OF JACKSON", "city", 3); // exempt public land, only on the map: count
  await map("400-2", "LEFLORE L E & DORETHA M", "private", 4); // taxable home the scrape missed: count
  await map("500-9", null, "private", 5); // no attributes at all: skip
  await map("600-3", "MEDICAL MALL FOUNDATION", "public", 6, 600); // locates a lessee's roll parcel next door: count
  await roll("600-3-X", "LESSEE LLC", 0);
  await map("700-4", "BAPTIST MEDICAL CENTER", "private", 7, 1225); // same owner and number as the roll parcel it locates: skip
  await roll("700-4-1", "Baptist Medical Center ", 1225);
  await pool.query(
    `INSERT INTO data.geocodes (county, parcel_id, method, input_address, matched) VALUES
     ('Hinds', '600-3-X', 'gis_parent_parcel', '0 BAILEY AVE', '600-3'),
     ('Hinds', '700-4-1', 'gis_situs_match', '1225 N STATE ST', '700-4')`,
  );
  await pool.query("SELECT app.rebuild_parcel_facts()");
  universe = Object.fromEntries(
    (await pool.query("SELECT parcel_id, owner_source FROM app.parcel_facts")).rows.map((r) => [r.parcel_id, r.owner_source]),
  );
});
afterAll(async () => {
  await pool.end();
});

describe("parcel universe", () => {
  it("counts land roll parcels once, as land roll", () => {
    expect(universe["100-1"]).toBe("land_roll");
    expect(universe["200-5-1"]).toBe("land_roll");
    expect(universe["600-3-X"]).toBe("land_roll");
  });

  it("adds parcel-map-only parcels that have an owner of record", () => {
    expect(universe["300-7"]).toBe("parcel_map");
    expect(universe["400-2"]).toBe("parcel_map");
  });

  it("keeps a map parcel whose ID prefixes a roll parcel, or that locates a different roll parcel", () => {
    expect(universe["200-5"]).toBe("parcel_map");
    expect(universe["600-3"]).toBe("parcel_map");
  });

  it("skips a map parcel that is the same property as a roll parcel under another ID", () => {
    expect(universe["700-4"]).toBeUndefined();
    expect(universe["700-4-1"]).toBe("land_roll");
  });

  it("skips shapes with no owner of record", () => {
    expect(universe["500-9"]).toBeUndefined();
  });

  it("treats parcel-map-only tax status as unknown, not paid", async () => {
    const { rows } = await pool.query(
      "SELECT delinquent, current_due, on_tax_roll, portfolio_id FROM app.parcel_facts WHERE parcel_id = '400-2'",
    );
    expect(rows[0]).toEqual({
      delinquent: null,
      current_due: null,
      on_tax_roll: false,
      portfolio_id: "OWN:LEFLORE L E & DORETHA M",
    });
  });

  it("groups public owners by type", async () => {
    const { rows } = await pool.query("SELECT portfolio_id FROM app.parcel_facts WHERE parcel_id = '300-7'");
    expect(rows[0].portfolio_id).toBe("CITY_OF_JACKSON");
  });

  it("registers every counted parcel so it can take status history", async () => {
    const { rows } = await pool.query("SELECT parcel_id, source FROM app.parcel_registry ORDER BY 1");
    expect(rows).toEqual([
      { parcel_id: "100-1", source: "land_roll" },
      { parcel_id: "200-5", source: "parcel_map" },
      { parcel_id: "200-5-1", source: "land_roll" },
      { parcel_id: "300-7", source: "parcel_map" },
      { parcel_id: "400-2", source: "parcel_map" },
      { parcel_id: "600-3", source: "parcel_map" },
      { parcel_id: "600-3-X", source: "land_roll" },
      { parcel_id: "700-4-1", source: "land_roll" },
    ]);
    await expect(
      pool.query(
        `INSERT INTO app.status_events (county, parcel_id, status, effective_date, source, recorded_by)
         VALUES ('Hinds', '400-2', 'verified_blighted', '2026-11-13', 'admin_entry', 'test')`,
      ),
    ).resolves.toBeTruthy();
  });
});
