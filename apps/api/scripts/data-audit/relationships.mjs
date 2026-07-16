#!/usr/bin/env node
/**
 * Invalid or contradictory relationships between core entities.
 */
import { createPrisma, finding, printFindings, SEVERITY } from "./shared.mjs";

const INACTIVE_EMPLOYEE_STATUSES = ["terminated", "resigned", "inactive"];

/** @returns {Promise<import("./shared.mjs").AuditFinding[]>} */
export async function runRelationshipsAudit(prisma) {
  const findings = [];

  const shiftsBadEmployee = await prisma.$queryRaw`
    SELECT s.id, s."employeeId", e.status
    FROM "Shift" s
    JOIN "Employee" e ON e.id = s."employeeId"
    WHERE e.status::text = ANY(${INACTIVE_EMPLOYEE_STATUSES}::text[])
      AND s."startTime" > NOW() - INTERVAL '90 days'
    LIMIT 500
  `;
  if (shiftsBadEmployee.length > 0) {
    findings.push(
      finding({
        id: "inactive-employee-future-shifts",
        category: "relationships",
        severity: SEVERITY.HIGH,
        message: "Shifts in last 90 days assigned to inactive/terminated employees",
        count: shiftsBadEmployee.length,
        sample: shiftsBadEmployee.slice(0, 3),
      })
    );
  }

  const rosterInactive = await prisma.$queryRaw`
    SELECT g.id, g."guardId", e.status, g."rosterDate"
    FROM "SiteRosterGeneratedShift" g
    JOIN "Employee" e ON e.id = g."guardId"
    WHERE e.status::text = ANY(${INACTIVE_EMPLOYEE_STATUSES}::text[])
      AND g."rosterDate" >= CURRENT_DATE - INTERVAL '30 days'
    LIMIT 500
  `;
  if (rosterInactive.length > 0) {
    findings.push(
      finding({
        id: "inactive-employee-on-roster",
        category: "relationships",
        severity: SEVERITY.HIGH,
        message: "Inactive/terminated employees on generated roster (last 30 days)",
        count: rosterInactive.length,
        sample: rosterInactive.slice(0, 3),
      })
    );
  }

  const shiftSiteMismatch = await prisma.$queryRaw`
    SELECT s.id, s."companyId" AS shift_company, site."companyId" AS site_company
    FROM "Shift" s
    JOIN "Site" site ON site.id = s."siteId"
    WHERE s."companyId" != site."companyId"
    LIMIT 200
  `;
  if (shiftSiteMismatch.length > 0) {
    findings.push(
      finding({
        id: "shift-site-company-mismatch",
        category: "relationships",
        severity: SEVERITY.CRITICAL,
        message: "Shift companyId does not match Site companyId (tenant leak risk)",
        count: shiftSiteMismatch.length,
        sample: shiftSiteMismatch.slice(0, 3),
      })
    );
  }

  const timesheetRowSiteMismatch = await prisma.$queryRaw`
    SELECT str.id, str."companyId" AS row_company, st."companyId" AS sheet_company
    FROM "SiteTimesheetRow" str
    JOIN "SiteTimesheet" st ON st.id = str."siteTimesheetId"
    WHERE str."companyId" != st."companyId"
    LIMIT 200
  `;
  if (timesheetRowSiteMismatch.length > 0) {
    findings.push(
      finding({
        id: "timesheet-row-company-mismatch",
        category: "relationships",
        severity: SEVERITY.CRITICAL,
        message: "SiteTimesheetRow companyId does not match parent SiteTimesheet",
        count: timesheetRowSiteMismatch.length,
        sample: timesheetRowSiteMismatch.slice(0, 3),
      })
    );
  }

  const activeSitesNoPosts = await prisma.$queryRaw`
    SELECT site.id, site.name
    FROM "Site" site
    WHERE site."siteStatus" = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM "SitePost" p WHERE p."siteId" = site.id)
    LIMIT 200
  `;
  if (activeSitesNoPosts.length > 0) {
    findings.push(
      finding({
        id: "active-site-without-posts",
        category: "relationships",
        severity: SEVERITY.MEDIUM,
        message: "ACTIVE sites with no SitePost records",
        count: activeSitesNoPosts.length,
        sample: activeSitesNoPosts.slice(0, 3),
      })
    );
  }

  const completedShiftNoAttendance = await prisma.$queryRaw`
    SELECT s.id, s."startTime", s.status
    FROM "Shift" s
    WHERE s.status IN ('completed', 'verified')
      AND s."endTime" < NOW()
      AND NOT EXISTS (SELECT 1 FROM "Attendance" a WHERE a."shiftId" = s.id)
    LIMIT 500
  `;
  if (completedShiftNoAttendance.length > 0) {
    findings.push(
      finding({
        id: "completed-shift-missing-attendance",
        category: "relationships",
        severity: SEVERITY.MEDIUM,
        message: "Completed/verified shifts past end time with no Attendance record",
        count: completedShiftNoAttendance.length,
        sample: completedShiftNoAttendance.slice(0, 3),
      })
    );
  }

  return findings;
}

async function main() {
  const json = process.argv.includes("--json");
  const prisma = createPrisma();
  try {
    const findings = await runRelationshipsAudit(prisma);
    console.log("Relationship integrity audit");
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
