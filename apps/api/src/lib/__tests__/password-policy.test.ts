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
});
