import { describe, expect, it } from "vitest";
import { validatePassword } from "../password-policy.js";

describe("validatePassword", () => {
  it("rejects short passwords", () => {
    expect(validatePassword("short1").valid).toBe(false);
  });

  it("rejects common weak passwords", () => {
    expect(validatePassword("password123").valid).toBe(false);
    expect(validatePassword("admin1234567").valid).toBe(false);
  });

  it("rejects company name patterns", () => {
    expect(validatePassword("acmecorp12345", { companyName: "Acme Corp" }).valid).toBe(false);
  });

  it("accepts strong passwords", () => {
    expect(validatePassword("River!Stone-2026").valid).toBe(true);
  });

  it("rejects 6 or more repeated characters anywhere in the password", () => {
    expect(validatePassword("Abc111111!def").valid).toBe(false);
    expect(validatePassword("River!aaaaaa-26").valid).toBe(false);
    expect(validatePassword("Abc11111!def").valid).toBe(true);
  });
});
