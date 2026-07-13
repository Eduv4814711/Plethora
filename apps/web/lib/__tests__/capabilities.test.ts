import { describe, it, expect } from "vitest";
import { can, PERMISSIONS } from "../capabilities";

describe("web can()", () => {
  it("returns true for system owner", () => {
    expect(can({ isSystemOwner: true, permissions: [] }, PERMISSIONS.PAYROLL_EXPORT)).toBe(true);
  });

  it("checks permission list", () => {
    expect(
      can(
        { permissions: [PERMISSIONS.EMPLOYEES_READ_OPERATIONAL] },
        PERMISSIONS.EMPLOYEES_READ_OPERATIONAL
      )
    ).toBe(true);
    expect(can({ permissions: [] }, PERMISSIONS.COMPENSATION_READ)).toBe(false);
  });
});
