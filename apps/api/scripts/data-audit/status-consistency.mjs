#!/usr/bin/env node
/**
 * String status values outside documented allowed sets.
 */
import { createPrisma, finding, printFindings, SEVERITY } from "./shared.mjs";

const EMPLOYEE_TYPES = ["general", "security_officer"];
const ATTENDANCE_STATUSES = ["pending", "present", "absent", "late", "verified"];

/** @returns {Promise<import("./shared.mjs").AuditFinding[]>} */
export async function runStatusConsistencyAudit(prisma) {
  const findings = [];

  // leave-v3 stores leaveType and status as PostgreSQL enums, so the database itself rejects
  // an out-of-set value and there is nothing left for a string audit to catch. What the enum
  // cannot enforce is the cross-field rules, which is what these two checks cover instead.
  const approvedWithoutApprover = await prisma.$queryRaw`
    SELECT id, "employeeId", "reviewedBy", "reviewedAt"
    FROM "LeaveRequest"
    WHERE status = 'APPROVED'
      AND ("reviewedBy" IS NULL OR "reviewedAt" IS NULL)
    LIMIT 200
  `;
  if (approvedWithoutApprover.length > 0) {
    findings.push(
      finding({
        id: "approved-leave-without-approver",
        category: "status-consistency",
        severity: SEVERITY.HIGH,
        message: "LeaveRequest is APPROVED but has no reviewedBy/reviewedAt audit trail",
        count: approvedWithoutApprover.length,
        sample: approvedWithoutApprover.slice(0, 3),
      })
    );
  }

  // The conditional columns are documented as "only when leaveType = X" — a value on the
  // wrong leave type means a reason was captured against a request it does not describe.
  const conditionalFieldMismatch = await prisma.$queryRaw`
    SELECT id, "leaveType", "familyResponsibilityReason", "parentalLeaveScenario"
    FROM "LeaveRequest"
    WHERE ("familyResponsibilityReason" IS NOT NULL AND "leaveType" <> 'FAMILY_RESPONSIBILITY')
       OR ("parentalLeaveScenario" IS NOT NULL AND "leaveType" <> 'PARENTAL')
    LIMIT 200
  `;
  if (conditionalFieldMismatch.length > 0) {
    findings.push(
      finding({
        id: "leave-conditional-field-mismatch",
        category: "status-consistency",
        severity: SEVERITY.MEDIUM,
        message: "LeaveRequest carries a reason field that does not belong to its leaveType",
        count: conditionalFieldMismatch.length,
        sample: conditionalFieldMismatch.slice(0, 3),
      })
    );
  }

  const badAttendanceStatus = await prisma.$queryRaw`
    SELECT status, COUNT(*)::int AS cnt
    FROM "Attendance"
    WHERE status IS NOT NULL
      AND status NOT IN (${ATTENDANCE_STATUSES[0]}, ${ATTENDANCE_STATUSES[1]}, ${ATTENDANCE_STATUSES[2]}, ${ATTENDANCE_STATUSES[3]}, ${ATTENDANCE_STATUSES[4]})
    GROUP BY status
  `;
  if (badAttendanceStatus.length > 0) {
    findings.push(
      finding({
        id: "nonstandard-attendance-status",
        category: "status-consistency",
        severity: SEVERITY.LOW,
        message: "Attendance.status uses non-standard string values (no DB enum)",
        count: badAttendanceStatus.reduce((s, r) => s + r.cnt, 0),
        sample: badAttendanceStatus,
      })
    );
  }

  const guardsNoPayRate = await prisma.$queryRaw`
    SELECT id, "employeeNumber", "employeeType", status
    FROM "Employee"
    WHERE "employeeType" = 'guard'
      AND status = 'active'
      AND "hourlyRate" IS NULL
      AND ("monthlySalary" IS NULL OR "monthlySalary" = 0)
    LIMIT 500
  `;
  if (guardsNoPayRate.length > 0) {
    findings.push(
      finding({
        id: "active-guard-no-pay-rate",
        category: "status-consistency",
        severity: SEVERITY.HIGH,
        message: "Active guards with no hourlyRate or monthlySalary",
        count: guardsNoPayRate.length,
        sample: guardsNoPayRate.slice(0, 3),
      })
    );
  }

  const officeNoSalary = await prisma.$queryRaw`
    SELECT id, "employeeNumber", status
    FROM "Employee"
    WHERE "employeeType" = 'general'
      AND status = 'active'
      AND ("monthlySalary" IS NULL OR "monthlySalary" = 0)
      AND ("hourlyRate" IS NULL OR "hourlyRate" = 0)
    LIMIT 500
  `;
  if (officeNoSalary.length > 0) {
    findings.push(
      finding({
        id: "active-office-no-salary",
        category: "status-consistency",
        severity: SEVERITY.HIGH,
        message: "Active office employees with no monthlySalary or hourlyRate",
        count: officeNoSalary.length,
        sample: officeNoSalary.slice(0, 3),
      })
    );
  }

  return findings;
}

async function main() {
  const json = process.argv.includes("--json");
  const prisma = createPrisma();
  try {
    const findings = await runStatusConsistencyAudit(prisma);
    console.log("Status consistency audit");
    printFindings(findings, { json });
    process.exit(findings.some((f) => f.severity === SEVERITY.CRITICAL) ? 1 : 0);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
