import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshTestDb } from "./helpers/testdb";

let pool: pg.Pool;

async function parcel(id: string) {
  await pool.query(
    `INSERT INTO data.landroll_parcels (county, parcel_id, owner_name, owner_type, row_hash)
     VALUES ('Hinds', $1, 'TEST OWNER', 'private', 'x') ON CONFLICT DO NOTHING`,
    [id],
  );
  await pool.query("SELECT app.refresh_parcel_registry()");
}

async function event(id: string, status: string, substatus: string | null, date: string, recordedAt?: string) {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO app.status_events (county, parcel_id, status, substatus, effective_date, source, recorded_by, recorded_at)
     VALUES ('Hinds', $1, $2, $3, $4, 'admin_entry', 'test', COALESCE($5::timestamptz, now())) RETURNING id`,
    [id, status, substatus, date, recordedAt ?? null],
  );
  return rows[0].id;
}

const asOf = async (d: string) =>
  Object.fromEntries(
    (await pool.query("SELECT parcel_id, status, substatus FROM app.status_as_of($1)", [d])).rows.map((r) => [
      r.parcel_id,
      r.substatus ? `${r.status}/${r.substatus}` : r.status,
    ]),
  );

const firsts = async (status: string, sub: string | null, from: string, to: string) =>
  (await pool.query("SELECT parcel_id FROM app.first_entries($1, $2, $3, $4) ORDER BY 1", [status, sub, from, to])).rows.map(
    (r) => r.parcel_id,
  );

beforeAll(async () => {
  pool = await freshTestDb();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query(
    "TRUNCATE app.status_event_voids, app.status_events, app.parcel_registry, data.landroll_parcels CASCADE",
  );
  for (const id of ["A", "B", "C", "D"]) await parcel(id);
});

describe("status history", () => {
  it("is append-only", async () => {
    const id = await event("A", "submitted", null, "2026-11-02");
    await expect(pool.query("UPDATE app.status_events SET status = 'resolved' WHERE id = $1", [id])).rejects.toThrow(
      /append-only/,
    );
    await expect(pool.query("DELETE FROM app.status_events WHERE id = $1", [id])).rejects.toThrow(/append-only/);
  });

  it("rejects sub-states that don't belong to the status", async () => {
    await expect(event("A", "resolved", "cited", "2026-11-02")).rejects.toThrow(/substatus_matches_status/);
    await expect(event("A", "verified_blighted", "demolished", "2026-11-02")).rejects.toThrow();
    await expect(event("A", "city_action", null, "2026-11-02")).rejects.toThrow();
  });

  it("reports status as of any date, using effective dates", async () => {
    await event("A", "submitted", null, "2026-10-01");
    await event("A", "verified_blighted", null, "2026-10-03");
    await event("A", "city_action", "cited", "2026-10-20");
    await event("A", "resolved", "demolished", "2026-11-04");
    expect((await asOf("2026-09-30")).A).toBeUndefined(); // unreported
    expect((await asOf("2026-10-03")).A).toBe("verified_blighted");
    expect((await asOf("2026-10-31")).A).toBe("city_action/cited");
    expect((await asOf("2026-11-04")).A).toBe("resolved/demolished");
  });

  it("places a backdated record correctly in history", async () => {
    await event("B", "verified_blighted", null, "2026-10-01", "2026-10-01T12:00:00Z");
    // Learned on Nov 10 that the city cited it on Oct 15.
    await event("B", "city_action", "cited", "2026-10-15", "2026-11-10T12:00:00Z");
    expect((await asOf("2026-10-20")).B).toBe("city_action/cited");
  });

  it("breaks same-day ties by the later recording", async () => {
    await event("C", "city_action", "hearing_set", "2026-11-03", "2026-11-03T10:00:00Z");
    await event("C", "city_action", "adjudicated", "2026-11-03", "2026-11-03T15:00:00Z");
    expect((await asOf("2026-11-03")).C).toBe("city_action/adjudicated");
  });

  it("ignores voided events everywhere", async () => {
    await event("D", "verified_blighted", null, "2026-10-01");
    const bad = await event("D", "resolved", "demolished", "2026-11-03");
    await pool.query("INSERT INTO app.status_event_voids (event_id, reason, voided_by) VALUES ($1, 'wrong parcel', 'test')", [bad]);
    expect((await asOf("2026-11-10")).D).toBe("verified_blighted");
    expect(await firsts("resolved", "demolished", "2026-11-02", "2026-11-09")).toEqual([]);
  });
});

describe("verification during City action", () => {
  it("verifies without resetting an open City action; a verification after resolution applies", async () => {
    await event("A", "city_action", "cited", "2026-10-01"); // City-flagged: City acted first
    await event("A", "verified_blighted", null, "2026-10-10"); // newsroom checks it later
    expect((await asOf("2026-10-10")).A).toBe("city_action/cited"); // status not reset
    await event("A", "city_action", "adjudicated", "2026-10-20");
    await event("A", "resolved", "repaired", "2026-11-01");
    await event("A", "verified_blighted", null, "2026-11-05"); // fell apart again
    expect((await asOf("2026-11-05")).A).toBe("verified_blighted");
  });

  it("still lets an unreported reset end the City action window", async () => {
    await event("B", "city_action", "cited", "2026-10-01");
    await event("B", "unreported", null, "2026-10-05"); // e.g. a correction
    await event("B", "verified_blighted", null, "2026-10-10");
    expect((await asOf("2026-10-10")).B).toBe("verified_blighted");
  });
});

describe("first_entries (weekly stats primitive)", () => {
  it("counts a parcel in the week it first reached the state, once", async () => {
    // Week of Mon 2026-11-02 .. Sun 2026-11-08
    await event("A", "resolved", "demolished", "2026-11-02"); // first day of week: counts
    await event("B", "resolved", "demolished", "2026-11-08"); // last day: counts
    await event("C", "resolved", "demolished", "2026-11-09"); // next Monday: not this week
    await event("D", "resolved", "demolished", "2026-10-30"); // demolished last week...
    await event("D", "resolved", "demolished", "2026-11-04"); // ...re-recorded from a city list: not new
    expect(await firsts("resolved", "demolished", "2026-11-02", "2026-11-09")).toEqual(["A", "B"]);
    expect(await firsts("resolved", "demolished", "2026-10-26", "2026-11-02")).toEqual(["D"]);
  });

  it("filters by sub-state or by status alone", async () => {
    await event("A", "resolved", "demolished", "2026-11-03");
    await event("B", "resolved", "repaired", "2026-11-03");
    expect(await firsts("resolved", "demolished", "2026-11-02", "2026-11-09")).toEqual(["A"]);
    expect(await firsts("resolved", null, "2026-11-02", "2026-11-09")).toEqual(["A", "B"]);
  });

  it("uses Monday-start Central-time weeks", async () => {
    const wk = async (ts: string) => (await pool.query("SELECT app.week_start($1)::text w", [ts])).rows[0].w;
    expect(await wk("2026-11-08T23:30:00-06:00")).toBe("2026-11-02"); // Sunday night CST
    expect(await wk("2026-11-09T05:30:00Z")).toBe("2026-11-02"); // still Sunday in Jackson
    expect(await wk("2026-11-09T06:30:00Z")).toBe("2026-11-09"); // Monday 00:30 CST
  });
});
