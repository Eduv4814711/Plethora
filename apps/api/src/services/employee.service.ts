import { prisma } from "../lib/prisma.js";
import { canTransitionEmployee } from "../lib/state-machines.js";
import type { EmployeeStatus } from "@prisma/client";

export class EmployeeServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmployeeServiceError";
  }
}

export async function transitionEmployeeStatus(
  employeeId: string,
  companyId: string,
  newStatus: EmployeeStatus
): Promise<{ success: boolean; error?: string }> {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
  });

  if (!employee) {
    return { success: false, error: "Employee not found" };
  }

  if (!canTransitionEmployee(employee.status, newStatus)) {
    return {
      success: false,
      error: `Invalid transition from ${employee.status} to ${newStatus}`,
    };
  }

  await prisma.employee.update({
    where: { id: employeeId },
    data: { status: newStatus },
  });

  return { success: true };
}
