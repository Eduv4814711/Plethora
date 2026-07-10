#!/usr/bin/env node
/**
 * Detect duplicate records that should be unique per business rules.
 */
import { createPrisma, finding, printFindings, SEVERITY } from "./shared.mjs";

/** @returns {Promise<import("./shared.mjs").AuditFinding[]>} */
export async function runDuplicatesAudit(prisma) {
  const findings = [];

  const attendanceDupes = await prisma.$queryRaw`
    SELECT "shiftId", COUNT(*)::int AS cnt
    FROM "Attendance"
    GROUP BY "shiftId"
    HAVING COUNT(*) > 1
    LIMIT 200
  `;
  if (attendanceDupes.length > 0) {
    findings.push(
      finding({
        id: "duplicate-attendance-per-shift",
        category: "duplicates",
        severity: SEVERITY.CRITICAL,
        message: "Multiple Attendance rows for the same shiftId",
        count: attendanceDupes.length,
        sample: attendanceDupes.slice(0, 3),
      })
    );
  }

  const employeeNumberDupes = await prisma.$queryRaw`
    SELECT "companyId", "employeeNumber", COUNT(*)::int AS cnt
    FROM "Employee"
    WHERE "employeeNumber" IS NOT NULL
    GROUP BY "companyId", "employeeNumber"
    HAVING COUNT(*) > 1
    LIMIT 200
  `;
  if (employeeNumberDupes.length > 0) {
    findings.push(
      finding({
        id: "duplicate-employee-number",
        category: "duplicates",
        severity: SEVERITY.CRITICAL,
        message: "Duplicate employeeNumber within same company",
        count: employeeNumberDupes.length,
        sample: employeeNumberDupes.slice(0, 3),
      })
    );
  }

  const payrollItemDupes = await prisma.$queryRaw`
    SELECT "payrollRunId", "employeeId", COUNT(*)::int AS cnt
    FROM "PayrollItem"
    GROUP BY "payrollRunId", "employeeId"
    HAVING COUNT(*) > 1
    LIMIT 200
  `;
  if (payrollItemDupes.length > 0) {
    findings.push(
      finding({
        id: "duplicate-payroll-item-per-employee",
        category: "duplicates",
        severity: SEVERITY.HIGH,
        message: "Multiple PayrollItem rows for same employee in one payroll run (no DB unique constraint)",
        count: payrollItemDupes.length,
        sample: payrollItemDupes.slice(0, 3),
      })
    );
  }

  const leaveDupes = await prisma.$queryRaw`
    SELECT "employeeId", date, type, COUNT(*)::int AS cnt
    FROM "LeaveRecord"
    GROUP BY "employeeId", date, type
    HAVING COUNT(*) > 1
    LIMIT 200
  `;
  if (leaveDupes.length > 0) {
    findings.push(
      finding({
        id: "duplicate-leave-record",
        category: "duplicates",
        severity: SEVERITY.MEDIUM,
        message: "Duplicate LeaveRecord for same employee+date+type",
        count: leaveDupes.length,
        sample: leaveDupes.slice(0, 3),
      })
    );
  }

  const timesheetRowDupes = await prisma.$queryRaw`
    SELECT "siteTimesheetId", "workDate", "plannedGuardId", "plannedShiftType", COUNT(*)::int AS cnt
    FROM "SiteTimesheetRow"
    WHERE "plannedGuardId" IS NOT NULL
    GROUP BY "siteTimesheetId", "workDate", "plannedGuardId", "plannedShiftType"
    HAVING COUNT(*) > 1
    LIMIT 200
  `;
  if (timesheetRowDupes.length > 0) {
    findings.push(
      finding({
        id: "duplicate-timesheet-row",
        category: "duplicates",
        severity: SEVERITY.HIGH,
        message: "Duplicate SiteTimesheetRow for same timesheet+date+guard+shiftType",
        count: timesheetRowDupes.length,
        sample: timesheetRowDupes.slice(0, 3),
      })
    );
  }

  const generatedShiftDupes = await prisma.$queryRaw`
    SELECT "siteId", "guardId", "rosterDate", COUNT(*)::int AS cnt
    FROM "SiteRosterGeneratedShift"
    GROUP BY "siteId", "guardId", "rosterDate"
    HAVING COUNT(*) > 1
    LIMIT 200
  `;
  if (generatedShiftDupes.length > 0) {
    findings.push(
      finding({
        id: "duplicate-generated-roster-shift",
        category: "duplicates",
        severity: SEVERITY.HIGH,
        message: "Duplicate SiteRosterGeneratedShift for same site+guard+date",
        count: generatedShiftDupes.length,
        sample: generatedShiftDupes.slice(0, 3),
      })
    );
  }

  return findings;
}

async function main() {
  const json = process.argv.includes("--json");
  const prisma = createPrisma();
  try {
    const findings = await runDuplicatesAudit(prisma);
    console.log("Duplicate record audit");
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
