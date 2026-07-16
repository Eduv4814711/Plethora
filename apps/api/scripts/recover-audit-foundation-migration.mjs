import "dotenv/config";

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const MIGRATION = "20260715190000_audit_readiness_foundation";
const prisma = new PrismaClient();

function resolveMigration(state) {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const executable = path.resolve(
    scriptDirectory,
    "../../..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma",
  );

  execFileSync(executable, ["migrate", "resolve", state, MIGRATION], {
    env: process.env,
    stdio: "inherit",
  });
}

async function main() {
  const failed = await prisma.$queryRawUnsafe(`
    SELECT "id"
    FROM "_prisma_migrations"
    WHERE "migration_name" = '${MIGRATION}'
      AND "finished_at" IS NULL
      AND "rolled_back_at" IS NULL
    ORDER BY "started_at" DESC
    LIMIT 1
  `);

  if (failed.length === 0) {
    console.log("Audit foundation migration recovery: no failed attempt found.");
    return;
  }

  const [state] = await prisma.$queryRawUnsafe(`
    SELECT
      to_regclass('public."DataQualityIssue"') IS NOT NULL AS "foundationPresent"
  `);

  if (!state?.foundationPresent) {
    await prisma.$disconnect();
    console.log("Audit foundation migration recovery: failed attempt was rolled back; scheduling a clean retry.");
    resolveMigration("--rolled-back");
    return;
  }

  console.log("Audit foundation migration recovery: completing the interrupted lineage controls.");

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      WITH orphan_references AS (
        SELECT
          r."companyId",
          'SiteTimesheetRow'::text AS "entityType",
          r."id" AS "entityId",
          'orphan_timesheet_shift'::text AS "ruleKey",
          r."id" || ':shift:' || r."sourceShiftId" AS "groupKey",
          'Timesheet row has a missing source shift'::text AS "title",
          'The referenced shift no longer exists. Review and relink the row or confirm that it should remain unlinked.'::text AS "description",
          jsonb_build_object('recordIds', jsonb_build_array(r."id"), 'missingShiftId', r."sourceShiftId") AS "affectedRecords"
        FROM "SiteTimesheetRow" r
        LEFT JOIN "Shift" s ON s."id" = r."sourceShiftId"
        WHERE r."sourceShiftId" IS NOT NULL AND s."id" IS NULL

        UNION ALL

        SELECT
          r."companyId", 'SiteTimesheetRow', r."id", 'orphan_timesheet_attendance',
          r."id" || ':attendance:' || r."sourceAttendanceId",
          'Timesheet row has a missing source attendance record',
          'The referenced attendance record no longer exists. Review and relink the row or confirm that it should remain unlinked.',
          jsonb_build_object('recordIds', jsonb_build_array(r."id"), 'missingAttendanceId', r."sourceAttendanceId")
        FROM "SiteTimesheetRow" r
        LEFT JOIN "Attendance" a ON a."id" = r."sourceAttendanceId"
        WHERE r."sourceAttendanceId" IS NOT NULL AND a."id" IS NULL

        UNION ALL

        SELECT
          e."companyId", 'AttendanceException', e."id", 'orphan_exception_shift',
          e."id" || ':shift:' || e."shiftId",
          'Attendance exception has a missing shift',
          'The exception references a shift that no longer exists. Review and relink it or confirm that it should remain unlinked.',
          jsonb_build_object('recordIds', jsonb_build_array(e."id"), 'missingShiftId', e."shiftId")
        FROM "AttendanceException" e
        LEFT JOIN "Shift" s ON s."id" = e."shiftId"
        WHERE e."shiftId" IS NOT NULL AND s."id" IS NULL

        UNION ALL

        SELECT
          e."companyId", 'AttendanceException', e."id", 'orphan_exception_attendance',
          e."id" || ':attendance:' || e."attendanceId",
          'Attendance exception has a missing attendance record',
          'The exception references an attendance record that no longer exists. Review and relink it or confirm that it should remain unlinked.',
          jsonb_build_object('recordIds', jsonb_build_array(e."id"), 'missingAttendanceId', e."attendanceId")
        FROM "AttendanceException" e
        LEFT JOIN "Attendance" a ON a."id" = e."attendanceId"
        WHERE e."attendanceId" IS NOT NULL AND a."id" IS NULL
      )
      INSERT INTO "DataQualityIssue" (
        "id", "companyId", "ruleKey", "entityType", "entityId", "groupKey",
        "title", "description", "severity", "affectedRecords", "proposedResolution"
      )
      SELECT
        'dq_lineage_' || md5("companyId" || ':' || "ruleKey" || ':' || "groupKey"),
        "companyId", "ruleKey", "entityType", "entityId", "groupKey", "title", "description",
        'HIGH'::"DataQualitySeverity", "affectedRecords",
        jsonb_build_object('action', 'review-and-relink-or-confirm-unlinked')
      FROM orphan_references
      ON CONFLICT ("companyId", "ruleKey", "groupKey") DO NOTHING
    `);

    await tx.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteTimesheetRow_sourceShiftId_fkey') THEN
          ALTER TABLE "SiteTimesheetRow"
            ADD CONSTRAINT "SiteTimesheetRow_sourceShiftId_fkey"
            FOREIGN KEY ("sourceShiftId") REFERENCES "Shift"("id")
            ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteTimesheetRow_sourceAttendanceId_fkey') THEN
          ALTER TABLE "SiteTimesheetRow"
            ADD CONSTRAINT "SiteTimesheetRow_sourceAttendanceId_fkey"
            FOREIGN KEY ("sourceAttendanceId") REFERENCES "Attendance"("id")
            ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttendanceException_attendanceId_fkey') THEN
          ALTER TABLE "AttendanceException"
            ADD CONSTRAINT "AttendanceException_attendanceId_fkey"
            FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id")
            ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttendanceException_shiftId_fkey') THEN
          ALTER TABLE "AttendanceException"
            ADD CONSTRAINT "AttendanceException_shiftId_fkey"
            FOREIGN KEY ("shiftId") REFERENCES "Shift"("id")
            ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
        END IF;
      END $$
    `);

    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SiteTimesheetRow_sourceShiftId_idx" ON "SiteTimesheetRow"("sourceShiftId")`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SiteTimesheetRow_sourceAttendanceId_idx" ON "SiteTimesheetRow"("sourceAttendanceId")`);
  });

  await prisma.$disconnect();
  resolveMigration("--applied");
  console.log("Audit foundation migration recovery: interrupted migration marked as applied.");
}

main()
  .catch((error) => {
    console.error("Audit foundation migration recovery failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
