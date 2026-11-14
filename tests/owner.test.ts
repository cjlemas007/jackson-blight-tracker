import { describe, expect, it } from "vitest";
import { classifyOwner, isEstateOrHeirs, rankingTab } from "@/lib/normalize/owner";

describe("classifyOwner", () => {
  it.each([
    ["STATE OF MISS", "state_forfeited"],
    ["STATE OF MISSISSIPPI", "state_forfeited"],
    ["MISSISSIPPI SECRETARY OF STATE", "state_forfeited"],
    // State agencies and sixteenth-section school land are public bodies, not forfeitures.
    ["STATE OF MISS HINDS SCHOOL", "public"],
    ["STATE OF MISS HIGHWAY COMM", "public"],
    ["STATE OF MISS FAIR COMMISSION", "public"],
    ["CITY OF JACKSON", "city"],
    ["CITY OF JACKSON MS", "city"],
    ["CITY OF CLINTON", "public"],
    ["JACKSON REDEVELOPMENT AUTHORITY", "public"],
    ["HOUSING AUTHORITY CITY OF JACKSON", "public"],
    ["MISS REGIONAL HOUSING AUTHORITY", "public"],
    ["UNITED STATES OF AMERICA", "public"],
    ["HOUSING & URBAN DEV", "public"],
    ["JACKSON STATE UNIVERSITY", "public"],
    ["HINDS COUNTY", "public"],
    // Look-alikes that are private.
    ["TRI-STATE JACKSON LANDS LLC", "private"],
    ["AMERICAN CREDIT CORP OF MISS LLC", "private"],
    ["MISS BAPTIST MEDICAL CENTER", "private"],
    ["JACKSON STATE UNIV ED BLDG CORP", "private"],
    ["DONNELL PROPERTIES HINDS COUNTY LLC", "private"],
    ["FEDERAL NATIONAL MORTGAGE ASSOC", "private"],
    ["MATTIACE DEV CO", "private"],
  ])("%s -> %s", (name, expected) => {
    expect(classifyOwner(name)).toBe(expected);
  });
});

describe("isEstateOrHeirs", () => {
  it.each([
    ["ADAMS MATTIE EST", true],
    ["ESTATE OF JOHN SMITH", true],
    ["JONES MARY HEIRS", true],
    ["SMITH JOHN HEIR", true],
    ["BROWN JAMES EST ETAL", true],
    ["WILLIAMS ROBERT ESTATE", true],
    ["KEEPING IT REAL ESTATE LLC", false],
    ["MAGNOLIA ESTATES LLC", false],
    ["FOUNTAIN REAL ESTATE", false],
    ["ESTATE SOLUTIONS LLC", false],
    ["MATTIACE DEV CO", false],
  ])("%s -> %s", (name, expected) => {
    expect(isEstateOrHeirs(name)).toBe(expected);
  });
});

describe("rankingTab", () => {
  it("groups city and other public bodies together", () => {
    expect(rankingTab("city")).toBe("public");
    expect(rankingTab("public")).toBe("public");
    expect(rankingTab("state_forfeited")).toBe("state");
    expect(rankingTab("private")).toBe("private");
  });
});
