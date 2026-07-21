import { describe, expect, it } from "vitest";
import { parseStaffRoleInput } from "../staff-role";

describe("parseStaffRoleInput", () => {
  it.each([
    "HR",
    "HR Manager",
    "Human Resources Manager",
    "HR & Payroll",
    "HR and Payroll",
    "Payroll",
    "Payroll Manager",
    "Payroll Administrator",
    "Payroll Officer",
    "  payroll-manager  ",
  ])("maps the recognized HR/payroll title %s to the HR & Payroll profile", (title) => {
    expect(parseStaffRoleInput(title)).toBe("hr_payroll");
  });

  it("preserves existing staff-role aliases", () => {
    expect(parseStaffRoleInput("Ops Manager")).toBe("operations_manager");
    expect(parseStaffRoleInput("Sup")).toBe("supervisor");
    expect(parseStaffRoleInput("CTRL")).toBe("controller");
  });

  it.each(["Assistant HR Manager", "Payroll Clerk", "Administrator", "Control Room Manager", ""])(
    "does not elevate the unrelated title %s",
    (title) => {
      expect(parseStaffRoleInput(title)).toBeNull();
    }
  );
});
