#!/usr/bin/env node
/**
 * String status values outside documented allowed sets.
 */
import { createPrisma, finding, printFindings, SEVERITY } from "./shared.mjs";

const LEAVE_TYPES = ["annual", "sick", "unpaid"];
const LEAVE_REQUEST_STATUSES = ["pending", "approved", "rejected"];
const EMPLOYEE_TYPES = ["guard", "office", "reliever", "training", "hired"];
const ATTENDANCE_STATUSES = ["pending", "present", "absent", "late", "verified"];

/** @returns {Promise<import("./shared.mjs").AuditFinding[]>} */
export async function runStatusConsistencyAudit(prisma) {
  const findings = [];

  const badLeaveTypes = await prisma.$queryRaw`
    SELECT type, COUNT(*)::int AS cnt
    FROM "LeaveRecord"
    WHERE type NOT IN (${LEAVE_TYPES[0]}, ${LEAVE_TYPES[1]}, ${LEAVE_TYPES[2]})
    GROUP BY type
  `;
  if (badLeaveTypes.length > 0) {
    findings.push(
      finding({
        id: "invalid-leave-record-type",
        category: "status-consistency",
        severity: SEVERITY.MEDIUM,
        message: "LeaveRecord.type values outside annual/sick/unpaid",
        count: badLeaveTypes.reduce((s, r) => s + r.cnt, 0),
        sample: badLeaveTypes,
      })
    );
  }

  const badLeaveRequestStatus = await prisma.$queryRaw`
    SELECT status, COUNT(*)::int AS cnt
    FROM "LeaveRequest"
    WHERE status NOT IN (${LEAVE_REQUEST_STATUSES[0]}, ${LEAVE_REQUEST_STATUSES[1]}, ${LEAVE_REQUEST_STATUSES[2]})
    GROUP BY status
  `;
  if (badLeaveRequestStatus.length > 0) {
    findings.push(
      finding({
        id: "invalid-leave-request-status",
        category: "status-consistency",
        severity: SEVERITY.MEDIUM,
        message: "LeaveRequest.status values outside pending/approved/rejected",
        count: badLeaveRequestStatus.reduce((s, r) => s + r.cnt, 0),
        sample: badLeaveRequestStatus,
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
    WHERE "employeeType" = 'office'
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
