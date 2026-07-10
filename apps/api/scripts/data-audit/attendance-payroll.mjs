#!/usr/bin/env node
/**
 * Attendance → payroll chain integrity checks.
 */
import { createPrisma, finding, printFindings, SEVERITY } from "./shared.mjs";

const PAYABLE_STATUSES = ["present", "late", "left_early", "reliever", "shift_swapped", "leave", "sick_leave", "training"];

/** @returns {Promise<import("./shared.mjs").AuditFinding[]>} */
export async function runAttendancePayrollAudit(prisma) {
  const findings = [];

  const calculatedRuns = await prisma.payrollRun.findMany({
    where: { status: { in: ["calculated", "approved", "paid"] } },
    select: { id: true, companyId: true, periodStart: true, periodEnd: true, status: true },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  for (const run of calculatedRuns) {
    const unapprovedSites = await prisma.$queryRaw`
      SELECT DISTINCT st."siteId", s.name
      FROM "SiteTimesheet" st
      JOIN "Site" s ON s.id = st."siteId"
      WHERE st."companyId" = ${run.companyId}
        AND st."periodStart" <= ${run.periodEnd}::date
        AND st."periodEnd" >= ${run.periodStart}::date
        AND st.status NOT IN ('approved', 'locked')
        AND EXISTS (
          SELECT 1 FROM "Shift" sh
          WHERE sh."siteId" = st."siteId"
            AND sh."companyId" = ${run.companyId}
            AND sh."startTime" >= ${run.periodStart}
            AND sh."startTime" <= ${run.periodEnd}
            AND sh.status IN ('completed', 'verified')
        )
      LIMIT 50
    `;

    if (unapprovedSites.length > 0) {
      findings.push(
        finding({
          id: `payroll-with-unapproved-timesheets-${run.id}`,
          category: "attendance-payroll",
          severity: SEVERITY.CRITICAL,
          message: `Payroll run ${run.status} (${run.id}) overlaps sites with unapproved SiteTimesheet`,
          count: unapprovedSites.length,
          sample: unapprovedSites.slice(0, 3),
        })
      );
    }
  }

  const payableUnapprovedRows = await prisma.$queryRaw`
    SELECT str.id, str."approvalStatus", str."attendanceStatus", str."workDate"
    FROM "SiteTimesheetRow" str
  JOIN "SiteTimesheet" st ON st.id = str."siteTimesheetId"
    WHERE st.status IN ('approved', 'locked')
      AND str."approvalStatus" NOT IN ('reviewed', 'approved')
      AND str."attendanceStatus"::text = ANY(${PAYABLE_STATUSES}::text[])
    LIMIT 500
  `;
  if (payableUnapprovedRows.length > 0) {
    findings.push(
      finding({
        id: "approved-sheet-unreviewed-payable-rows",
        category: "attendance-payroll",
        severity: SEVERITY.HIGH,
        message: "Approved/locked SiteTimesheet contains payable rows not reviewed/approved",
        count: payableUnapprovedRows.length,
        sample: payableUnapprovedRows.slice(0, 3),
      })
    );
  }

  const criticalExceptions = await prisma.$queryRaw`
    SELECT ae.id, ae."companyId", ae."exceptionType", ae.status
    FROM "AttendanceException" ae
    WHERE ae.severity = 'CRITICAL'
      AND ae.status IN ('OPEN', 'UNDER_REVIEW')
    LIMIT 500
  `;
  if (criticalExceptions.length > 0) {
    findings.push(
      finding({
        id: "open-critical-attendance-exceptions",
        category: "attendance-payroll",
        severity: SEVERITY.HIGH,
        message: "Open CRITICAL attendance exceptions (may block payroll readiness)",
        count: criticalExceptions.length,
        sample: criticalExceptions.slice(0, 3),
      })
    );
  }

  const workingRowsMissingOb = await prisma.$queryRaw`
    SELECT str.id, str."workDate", str."dutyOnObNumber", str."dutyOffObNumber"
    FROM "SiteTimesheetRow" str
    WHERE str."approvalStatus" IN ('reviewed', 'approved')
      AND str."attendanceStatus" IN ('present', 'late', 'left_early', 'reliever', 'shift_swapped')
      AND (
        str."dutyOnObNumber" IS NULL OR TRIM(str."dutyOnObNumber") = ''
        OR str."dutyOffObNumber" IS NULL OR TRIM(str."dutyOffObNumber") = ''
      )
    LIMIT 500
  `;
  if (workingRowsMissingOb.length > 0) {
    findings.push(
      finding({
        id: "reviewed-rows-missing-ob-numbers",
        category: "attendance-payroll",
        severity: SEVERITY.MEDIUM,
        message: "Reviewed/approved working rows missing Duty ON/OFF OB numbers",
        count: workingRowsMissingOb.length,
        sample: workingRowsMissingOb.slice(0, 3),
      })
    );
  }

  return findings;
}

async function main() {
  const json = process.argv.includes("--json");
  const prisma = createPrisma();
  try {
    const findings = await runAttendancePayrollAudit(prisma);
    console.log("Attendance/payroll chain audit");
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
