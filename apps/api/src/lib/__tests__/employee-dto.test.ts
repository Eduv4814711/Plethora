import { describe, expect, it } from "vitest";
import {
  canEditEmployeeDetails,
  canViewEmployeeSensitiveFields,
  canWriteEmployeeSensitiveFields,
  sanitizeEmployeeForList,
} from "../employee-dto.js";

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

describe("employee sensitive fields", () => {
  it("allows view through Team, Payroll, or owner access", () => {
    expect(canViewEmployeeSensitiveFields(user({ "/employees": ["view_sensitive"] }))).toBe(true);
    expect(canViewEmployeeSensitiveFields(user({ "/payroll": ["view_sensitive"] }))).toBe(true);
    expect(canViewEmployeeSensitiveFields(user({}, true))).toBe(true);
  });

  it("requires edit explicitly for private-data changes", () => {
    expect(canEditEmployeeDetails(user({ "/employees": ["view"] }))).toBe(false);
    expect(canEditEmployeeDetails(user({ "/employees": ["edit"] }))).toBe(true);
    expect(canEditEmployeeDetails(user({ "/payroll": ["edit"] }))).toBe(true);
  });

  it("authorizes sensitive writes by action without implying read access", () => {
    const creator = user({ "/employees": ["create"] });
    expect(canWriteEmployeeSensitiveFields(creator, "create")).toBe(true);
    expect(canWriteEmployeeSensitiveFields(creator, "edit")).toBe(false);
    expect(canViewEmployeeSensitiveFields(creator)).toBe(false);
    expect(canWriteEmployeeSensitiveFields(user({ "/payroll": ["edit"] }), "edit")).toBe(true);
  });

  it("strips sensitive fields without relevant view access", () => {
    const row = { id: "e1", idNumber: "900101", bankAccountNumber: "123" };
    const out = sanitizeEmployeeForList(row, user({ "/rostering": ["view"] })) as Record<string, unknown>;
    expect(out.idNumber).toBeUndefined();
    expect(out.bankAccountNumber).toBeUndefined();
    expect(out.id).toBe("e1");
  });
});
