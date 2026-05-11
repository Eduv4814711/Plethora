import { describe, expect, it } from "vitest";
import {
  meetsSiteShiftGenderRule,
  normalizeEmployeeGenderForRoster,
} from "../rostering.service.js";

describe("rostering shift gender rules", () => {
  const siteBase = { rosterDayShiftGender: null as string | null, rosterNightShiftGender: null as string | null };

  it("normalizeEmployeeGenderForRoster accepts M/F and male/female", () => {
    expect(normalizeEmployeeGenderForRoster("M")).toBe("male");
    expect(normalizeEmployeeGenderForRoster("f")).toBe("female");
    expect(normalizeEmployeeGenderForRoster("Male")).toBe("male");
    expect(normalizeEmployeeGenderForRoster(null)).toBeNull();
  });

  it("meetsSiteShiftGenderRule passes when rule is unset or any", () => {
    expect(meetsSiteShiftGenderRule("M", siteBase, "day")).toBe(true);
    expect(
      meetsSiteShiftGenderRule("M", { ...siteBase, rosterDayShiftGender: "any" }, "day")
    ).toBe(true);
  });

  it("meetsSiteShiftGenderRule enforces male/female per post shift type", () => {
    const site = { ...siteBase, rosterDayShiftGender: "female", rosterNightShiftGender: "male" };
    expect(meetsSiteShiftGenderRule("F", site, "day")).toBe(true);
    expect(meetsSiteShiftGenderRule("M", site, "day")).toBe(false);
    expect(meetsSiteShiftGenderRule("M", site, "night")).toBe(true);
    expect(meetsSiteShiftGenderRule("F", site, "night")).toBe(false);
  });

  it("meetsSiteShiftGenderRule fails when gender unknown but rule is restrictive", () => {
    const site = { ...siteBase, rosterDayShiftGender: "male" };
    expect(meetsSiteShiftGenderRule(null, site, "day")).toBe(false);
    expect(meetsSiteShiftGenderRule("", site, "day")).toBe(false);
  });

  it("defaults post shift type to day", () => {
    const site = { ...siteBase, rosterDayShiftGender: "male" };
    expect(meetsSiteShiftGenderRule("M", site, null)).toBe(true);
    expect(meetsSiteShiftGenderRule("F", site, undefined)).toBe(false);
  });
});
