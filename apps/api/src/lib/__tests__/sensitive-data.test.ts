import { describe, expect, it } from "vitest";
import {
  EMPLOYEE_RESTRICTED_FIELDS,
  canAccessSensitiveData,
  hasRestrictedFields,
  omitFields,
} from "../sensitive-data.js";

const user = (capabilities: unknown = {}, isOwner = false) => ({
  sub: "u",
  email: "u@test.com",
  companyId: "c",
  name: "User",
  accountType: "staff" as const,
  jobTitle: null,
  isActive: true,
  isOwner,
  capabilities: capabilities as never,
});

describe("sensitive data policy", () => {
  it("allows the owner and explicit sensitive-data viewers", () => {
    expect(canAccessSensitiveData(user({}, true), "/employees")).toBe(true);
    expect(canAccessSensitiveData(user({ "/employees": ["view_sensitive"] }), "/employees")).toBe(true);
  });

  it("does not infer private-data access from ordinary module actions", () => {
    expect(canAccessSensitiveData(user({ "/employees": ["edit"] }), "/employees")).toBe(false);
    expect(canAccessSensitiveData(user({ "/employees": ["view"] }), "/employees")).toBe(false);
    expect(canAccessSensitiveData(user({ "/employees": ["view_sensitive"] }), "/academy")).toBe(false);
  });

  it("detects protected write fields and redacts them", () => {
    expect(hasRestrictedFields({ monthlySalary: 12000 }, EMPLOYEE_RESTRICTED_FIELDS)).toBe(true);
    expect(omitFields({ id: "e1", bankAccountNumber: "123", firstName: "A" }, EMPLOYEE_RESTRICTED_FIELDS))
      .toEqual({ id: "e1", firstName: "A" });
  });
});
