import { describe, expect, it } from "vitest";
import {
  canViewEmployeeSensitiveFields,
  sanitizeEmployeeForList,
} from "../employee-dto.js";
import type { JWTPayload } from "../types.js";

describe("employee sensitive fields", () => {
  const fullAdmin: JWTPayload = {
    sub: "u1",
    email: "a@test.com",
    companyId: "c1",
    role: "admin",
  };

  const supervisor: JWTPayload = {
    sub: "u2",
    email: "s@test.com",
    companyId: "c1",
    role: "supervisor",
    moduleAccess: ["/rostering"],
  };

  it("allows full admin", () => {
    expect(canViewEmployeeSensitiveFields(fullAdmin)).toBe(true);
  });

  it("strips sensitive fields for roster-only supervisor", () => {
    const row = { id: "e1", idNumber: "900101", bankAccountNumber: "123" };
    const out = sanitizeEmployeeForList(row, supervisor) as Record<string, unknown>;
    expect(out.idNumber).toBeUndefined();
    expect(out.bankAccountNumber).toBeUndefined();
    expect(out.id).toBe("e1");
  });
});
