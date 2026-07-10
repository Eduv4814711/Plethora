#!/usr/bin/env node
/**
 * Detect orphaned references where Prisma stores IDs without FK constraints.
 */
import { createPrisma, finding, printFindings, SEVERITY } from "./shared.mjs";

/** @returns {Promise<import("./shared.mjs").AuditFinding[]>} */
export async function runOrphansAudit(prisma) {
  const findings = [];

  const exceptionOrphans = await prisma.$queryRaw`
    SELECT ae.id, ae."attendanceId", ae."shiftId"
    FROM "AttendanceException" ae
    WHERE (ae."attendanceId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Attendance" a WHERE a.id = ae."attendanceId"
    ))
    OR (ae."shiftId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Shift" s WHERE s.id = ae."shiftId"
    ))
    LIMIT 500
  `;
  if (exceptionOrphans.length > 0) {
    findings.push(
      finding({
        id: "orphan-attendance-exception-refs",
        category: "orphans",
        severity: SEVERITY.HIGH,
        message: "AttendanceException rows reference missing Attendance or Shift",
        count: exceptionOrphans.length,
        sample: exceptionOrphans.slice(0, 3),
      })
    );
  }

  const rowSourceOrphans = await prisma.$queryRaw`
    SELECT str.id, str."sourceShiftId", str."sourceAttendanceId"
    FROM "SiteTimesheetRow" str
    WHERE (str."sourceShiftId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Shift" s WHERE s.id = str."sourceShiftId"
    ))
    OR (str."sourceAttendanceId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Attendance" a WHERE a.id = str."sourceAttendanceId"
    ))
    LIMIT 500
  `;
  if (rowSourceOrphans.length > 0) {
    findings.push(
      finding({
        id: "orphan-timesheet-row-source-refs",
        category: "orphans",
        severity: SEVERITY.MEDIUM,
        message: "SiteTimesheetRow sourceShiftId/sourceAttendanceId reference missing records",
        count: rowSourceOrphans.length,
        sample: rowSourceOrphans.slice(0, 3),
      })
    );
  }

  const whatsappShiftOrphans = await prisma.$queryRaw`
    SELECT w.id, w."shiftId"
    FROM "WhatsAppClockPending" w
    WHERE w."shiftId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "Shift" s WHERE s.id = w."shiftId")
    LIMIT 500
  `;
  if (whatsappShiftOrphans.length > 0) {
    findings.push(
      finding({
        id: "orphan-whatsapp-shift-refs",
        category: "orphans",
        severity: SEVERITY.MEDIUM,
        message: "WhatsAppClockPending rows reference missing Shift",
        count: whatsappShiftOrphans.length,
        sample: whatsappShiftOrphans.slice(0, 3),
      })
    );
  }

  const attendanceWithoutShift = await prisma.$queryRaw`
    SELECT a.id, a."shiftId"
    FROM "Attendance" a
    WHERE NOT EXISTS (SELECT 1 FROM "Shift" s WHERE s.id = a."shiftId")
    LIMIT 500
  `;
  if (attendanceWithoutShift.length > 0) {
    findings.push(
      finding({
        id: "orphan-attendance-shift",
        category: "orphans",
        severity: SEVERITY.CRITICAL,
        message: "Attendance rows without valid Shift (FK should prevent — investigate)",
        count: attendanceWithoutShift.length,
        sample: attendanceWithoutShift.slice(0, 3),
      })
    );
  }

  return findings;
}

async function main() {
  const json = process.argv.includes("--json");
  const prisma = createPrisma();
  try {
    const findings = await runOrphansAudit(prisma);
    console.log("Orphan reference audit");
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
