import { describe, expect, it } from "vitest";
import { parseUsDate, transformLandrollRow } from "../sync/jobs/landroll";

const base = {
  county: "Hinds", parcel_id: "4970-371", owner_name: "ADAMS MATTIE EST", mailing_street: "C/O JOSEPHINE WHITE",
  mailing_city: "2112 S NORRELL RD", mailing_state: "", mailing_zip: "", property_address: "0 CEMETERY RD",
  appraised_total: "3,800", assessed_total: "570", acreage: "", legal_description: " LOT 1 ", deed_date: "12/28/1953",
  year_built: "0000", loaded_at: "2026-06-03T21:34:44.409711",
};

describe("transformLandrollRow", () => {
  it("normalizes a real shifted, estate-owned vacant parcel", () => {
    const r = transformLandrollRow(base);
    expect(r).toMatchObject({
      owner_type: "private",
      owner_estate_heirs: true,
      mailing_care_of: "JOSEPHINE WHITE",
      mailing_street: "2112 S NORRELL RD",
      mailing_repaired: true,
      situs_number: null,
      situs_street: "CEMETERY RD",
      appraised_total: 3800,
      deed_date: "1953-12-28",
      year_built: null,
      source_loaded_at: "2026-06-03T21:34:44.409Z",
    });
  });
  it("hash ignores the upstream load time, so a re-load of identical data is not a change", () => {
    const a = transformLandrollRow(base);
    const b = transformLandrollRow({ ...base, loaded_at: "2026-07-01T00:00:00" });
    expect(a.row_hash).toBe(b.row_hash);
    expect(transformLandrollRow({ ...base, owner_name: "NEW OWNER LLC" }).row_hash).not.toBe(a.row_hash);
  });
  it("flags state-owned forfeited parcels", () => {
    expect(transformLandrollRow({ ...base, owner_name: "STATE OF MISS" }).owner_type).toBe("state_forfeited");
  });
});

describe("parseUsDate", () => {
  it.each([
    ["12/28/1953", "1953-12-28"],
    ["6/2/2017", "2017-06-02"],
    ["", null],
    ["00/00/0000", null],
    ["09/31/1990", null], // impossible date present in the Hinds roll
    ["02/29/2024", "2024-02-29"],
    ["02/29/2023", null],
  ])("%s -> %s", (i, o) => expect(parseUsDate(i)).toBe(o));
});

describe("bqNum", async () => {
  const { bqNum } = await import("../sync/jobs/tax");
  // BigQuery's client returns NUMERIC as Big.js instances: objects whose toString() is the number.
  class BigLike { constructor(private v: string) {} toString() { return this.v; } }
  it("handles strings, numbers, {value} and Big objects", () => {
    expect(bqNum("1797.92")).toBe(1797.92);
    expect(bqNum(12)).toBe(12);
    expect(bqNum({ value: "3.5" })).toBe(3.5);
    expect(bqNum(null)).toBeNull();
    expect(bqNum(new BigLike("626.46"))).toBe(626.46);
  });
  it("refuses to silently turn garbage into NaN", () => {
    expect(() => bqNum({})).toThrow();
  });
});
