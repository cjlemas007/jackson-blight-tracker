import { describe, expect, it } from "vitest";
import {
  mailingKey,
  normalizeMailingKey,
  normalizeStreetName,
  parseSitus,
  repairMailing,
} from "@/lib/normalize/address";

describe("normalizeStreetName", () => {
  it.each([
    ["north state street", "N STATE ST"],
    ["N STATE ST", "N STATE ST"],
    ["J R LYNCH ST EXTENSION", "J R LYNCH ST EXT"],
    ["CAPITOL ST 19", "CAPITOL ST"],
    ["DULING ST AC", "DULING ST"],
    ["FLORIDA BLVD W", "FLORIDA BLVD W"],
    ["Old Canton Road", "OLD CANTON RD"],
    ["SOUTH ST", "SOUTH ST"],
    ["W SOUTH ST", "W SOUTH ST"],
    ["HWY 80", "HWY 80"],
    ["CRANE RIDGE DR", "CRANE RIDGE DR"],
    ["  ", null],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeStreetName(input)).toBe(expected);
  });
});

describe("parseSitus", () => {
  it("treats house number 0 as no number", () => {
    expect(parseSitus("0 CEMETERY RD")).toEqual({ number: null, street: "CEMETERY RD" });
  });
  it("splits number and normalizes street", () => {
    expect(parseSitus("315 E CAPITOL ST 19")).toEqual({ number: 315, street: "E CAPITOL ST" });
    expect(parseSitus("435 Utica Street")).toEqual({ number: 435, street: "UTICA ST" });
  });
});

describe("repairMailing", () => {
  it("leaves normal rows alone", () => {
    const r = repairMailing({ street: "P O BOX 13809", city: "JACKSON", state: "MS", zip: "39236" });
    expect(r).toMatchObject({ street: "P O BOX 13809", city: "JACKSON", state: "MS", repaired: false, careOf: null });
  });
  it("repairs a C/O line shift", () => {
    const r = repairMailing({ street: "C/O JOSEPHINE WHITE", city: "2112 S NORRELL RD", state: "", zip: "" });
    expect(r).toMatchObject({ careOf: "JOSEPHINE WHITE", street: "2112 S NORRELL RD", city: "", repaired: true });
  });
  it("repairs an ATTN line shift", () => {
    const r = repairMailing({ street: "ATTN: T ANDREW MATTIACE", city: "125 S CONGRESS ST STE 1800", state: "" });
    expect(r).toMatchObject({ careOf: "T ANDREW MATTIACE", street: "125 S CONGRESS ST STE 1800", repaired: true });
  });
  it("repairs a suite-in-city shift", () => {
    const r = repairMailing({ street: "21860 BURBANK BLVD", city: "SUITE 300 S", state: "" });
    expect(r).toMatchObject({ street: "21860 BURBANK BLVD SUITE 300 S", city: "", repaired: true });
  });
});

describe("mailingKey", () => {
  it("normalizes directional words and suite spellings", () => {
    expect(mailingKey({ street: "125 SOUTH CONGRESS ST STE 1800", city: "JACKSON", state: "MS" })).toBe(
      "125 S CONGRESS ST STE 1800|JACKSON|MS",
    );
    expect(mailingKey({ street: "125 S. Congress Street Suite 1800", city: "Jackson", state: "MS" })).toBe(
      "125 S CONGRESS ST STE 1800|JACKSON|MS",
    );
  });
  it("normalizes PO boxes", () => {
    expect(mailingKey({ street: "PO BOX 13809", city: "JACKSON", state: "MS" })).toBe("P O BOX 13809|JACKSON|MS");
    expect(mailingKey({ street: "P.O. Box 13809", city: "JACKSON", state: "MS" })).toBe("P O BOX 13809|JACKSON|MS");
  });
  it("normalizes keys copied from the editorial Sheet the same way", () => {
    expect(normalizeMailingKey("125 S CONGRESS ST STE 1800|JACKSON|MS")).toBe("125 S CONGRESS ST STE 1800|JACKSON|MS");
    expect(normalizeMailingKey("1000 HIGHLAND COLONY PKWY||MS")).toBe("1000 HIGHLAND COLONY PKWY||MS");
  });
});
