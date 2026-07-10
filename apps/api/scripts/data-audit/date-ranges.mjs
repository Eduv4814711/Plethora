#!/usr/bin/env node
/**
 * Invalid date ranges and impossible timestamps.
 */
import { createPrisma, finding, printFindings, SEVERITY } from "./shared.mjs";

/** @returns {Promise<import("./shared.mjs").AuditFinding[]>} */
export async function runDateRangesAudit(prisma) {
  const findings = [];

  const badPayrollPeriods = await prisma.$queryRaw`
    SELECT id, "companyId", "periodStart", "periodEnd"
    FROM "PayrollRun"
    WHERE "periodEnd" < "periodStart"
    LIMIT 200
  `;
  if (badPayrollPeriods.length > 0) {
    findings.push(
      finding({
        id: "payroll-period-end-before-start",
        category: "date-ranges",
        severity: SEVERITY.CRITICAL,
        message: "PayrollRun periodEnd before periodStart",
        count: badPayrollPeriods.length,
        sample: badPayrollPeriods.slice(0, 3),
      })
    );
  }

  const badSiteTimesheets = await prisma.$queryRaw`
    SELECT id, "companyId", "siteId", "periodStart", "periodEnd"
    FROM "SiteTimesheet"
    WHERE "periodEnd" < "periodStart"
    LIMIT 200
  `;
  if (badSiteTimesheets.length > 0) {
    findings.push(
      finding({
        id: "site-timesheet-period-end-before-start",
        category: "date-ranges",
        severity: SEVERITY.CRITICAL,
        message: "SiteTimesheet periodEnd before periodStart",
        count: badSiteTimesheets.length,
        sample: badSiteTimesheets.slice(0, 3),
      })
    );
  }

  const badShifts = await prisma.$queryRaw`
    SELECT id, "startTime", "endTime"
    FROM "Shift"
    WHERE "endTime" <= "startTime"
      AND ("shiftType" IS NULL OR "shiftType" != 'night')
    LIMIT 500
  `;
  if (badShifts.length > 0) {
    findings.push(
      finding({
        id: "day-shift-end-before-start",
        category: "date-ranges",
        severity: SEVERITY.MEDIUM,
        message: "Non-night Shift with endTime <= startTime (day shifts should not cross midnight in Shift table)",
        count: badShifts.length,
        sample: badShifts.slice(0, 3),
      })
    );
  }

  const clockOutBeforeIn = await prisma.$queryRaw`
    SELECT id, "clockIn", "clockOut"
    FROM "Attendance"
    WHERE "clockIn" IS NOT NULL AND "clockOut" IS NOT NULL
      AND "clockOut" < "clockIn"
    LIMIT 500
  `;
  if (clockOutBeforeIn.length > 0) {
    findings.push(
      finding({
        id: "attendance-clock-out-before-in",
        category: "date-ranges",
        severity: SEVERITY.MEDIUM,
        message: "Attendance clockOut before clockIn (may be data entry error)",
        count: clockOutBeforeIn.length,
        sample: clockOutBeforeIn.slice(0, 3),
      })
    );
  }

  const leaveBadRange = await prisma.$queryRaw`
    SELECT id, "startDate", "endDate"
    FROM "LeaveSickNote"
    WHERE "endDate" < "startDate"
    LIMIT 200
  `;
  if (leaveBadRange.length > 0) {
    findings.push(
      finding({
        id: "sick-note-end-before-start",
        category: "date-ranges",
        severity: SEVERITY.HIGH,
        message: "LeaveSickNote endDate before startDate",
        count: leaveBadRange.length,
        sample: leaveBadRange.slice(0, 3),
      })
    );
  }

  const overlappingShifts = await prisma.$queryRaw`
    SELECT a.id AS shift_a, b.id AS shift_b, a."employeeId", a."startTime", b."startTime" AS other_start
    FROM "Shift" a
    JOIN "Shift" b ON a."employeeId" = b."employeeId" AND a.id < b.id
    WHERE a.status NOT IN ('created')
      AND b.status NOT IN ('created')
      AND a."startTime" < b."endTime"
      AND b."startTime" < a."endTime"
      AND a."startTime" > NOW() - INTERVAL '60 days'
    LIMIT 200
  `;
  if (overlappingShifts.length > 0) {
    findings.push(
      finding({
        id: "overlapping-employee-shifts",
        category: "date-ranges",
        severity: SEVERITY.HIGH,
        message: "Employee assigned to overlapping shifts (last 60 days)",
        count: overlappingShifts.length,
        sample: overlappingShifts.slice(0, 3),
      })
    );
  }

  const leaveVsRoster = await prisma.$queryRaw`
    SELECT lr.id AS leave_id, lr."employeeId", lr.date, g."rosterDate", g."shiftType"
    FROM "LeaveRecord" lr
    JOIN "SiteRosterGeneratedShift" g ON g."guardId" = lr."employeeId"
      AND g."rosterDate" = lr.date
    WHERE g."shiftType" NOT IN ('off', 'leave', 'sick_leave', 'training', 'unassigned')
    LIMIT 500
  `;
  if (leaveVsRoster.length > 0) {
    findings.push(
      finding({
        id: "leave-overlaps-working-roster",
        category: "date-ranges",
        severity: SEVERITY.MEDIUM,
        message: "LeaveRecord on same date as working roster shift (day/night)",
        count: leaveVsRoster.length,
        sample: leaveVsRoster.slice(0, 3),
      })
    );
  }

  return findings;
}

async function main() {
  const json = process.argv.includes("--json");
  const prisma = createPrisma();
  try {
    const findings = await runDateRangesAudit(prisma);
    console.log("Date range audit");
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
