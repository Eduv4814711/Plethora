import { describe, it, expect } from "vitest";
import {
  parseRosterShiftGenderPolicy,
  formatSiteRulesForMatrix,
  getShiftGenderPolicyViolation,
} from "../site-roster-policy.service.js";

describe("parseRosterShiftGenderPolicy", () => {
  it("returns null for null or empty effective policy", () => {
    expect(parseRosterShiftGenderPolicy(null)).toBeNull();
    expect(parseRosterShiftGenderPolicy(undefined)).toBeNull();
    expect(parseRosterShiftGenderPolicy({})).toBeNull();
  });

  it("parses valid partial policy", () => {
    expect(parseRosterShiftGenderPolicy({ day: "female" })).toEqual({ day: "female" });
    expect(parseRosterShiftGenderPolicy({ night: "male" })).toEqual({ night: "male" });
  });

  it("returns null for invalid JSON shapes", () => {
    expect(parseRosterShiftGenderPolicy({ extra: "x" })).toBeNull();
    expect(parseRosterShiftGenderPolicy({ day: "other" })).toBeNull();
    expect(parseRosterShiftGenderPolicy("nope")).toBeNull();
  });
});

describe("formatSiteRulesForMatrix", () => {
  it("combines policy lines and notes", () => {
    expect(
      formatSiteRulesForMatrix({ day: "female", night: "male" }, "Call ops for exceptions.")
    ).toBe(
      "Day shift: female guards only.\nNight shift: male guards only.\n\nCall ops for exceptions."
    );
  });

  it("returns null when nothing to show", () => {
    expect(formatSiteRulesForMatrix(null, null)).toBeNull();
    expect(formatSiteRulesForMatrix({}, "")).toBeNull();
  });

  it("notes only", () => {
    expect(formatSiteRulesForMatrix(null, "Line one\nLine two")).toBe("Line one\nLine two");
  });
});

describe("getShiftGenderPolicyViolation", () => {
  it("allows when no policy", () => {
    expect(getShiftGenderPolicyViolation("M", "day", null)).toBeNull();
    expect(getShiftGenderPolicyViolation(null, "night", null)).toBeNull();
  });

  it("allows when bucket has no restriction", () => {
    expect(getShiftGenderPolicyViolation("M", "night", { day: "female" })).toBeNull();
  });

  it("rejects wrong gender", () => {
    expect(getShiftGenderPolicyViolation("M", "day", { day: "female" })).toMatch(/requires female/);
    expect(getShiftGenderPolicyViolation("F", "night", { night: "male" })).toMatch(/requires male/);
  });

  it("treats non-night post as day bucket", () => {
    expect(getShiftGenderPolicyViolation("M", null, { day: "female" })).toMatch(/requires female/);
    expect(getShiftGenderPolicyViolation("F", null, { day: "female" })).toBeNull();
  });

  it("rejects unknown employee gender when restriction applies", () => {
    expect(getShiftGenderPolicyViolation(null, "day", { day: "female" })).toMatch(/no gender on record/);
    expect(getShiftGenderPolicyViolation("", "day", { day: "male" })).toMatch(/no gender on record/);
  });
});
