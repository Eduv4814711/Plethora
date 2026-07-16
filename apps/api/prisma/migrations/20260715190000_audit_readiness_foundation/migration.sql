-- Audit-readiness foundation. Existing questionable records are classified for
-- review; this migration does not silently delete or merge operational data.

CREATE TYPE "PermissionScopeType" AS ENUM ('COMPANY', 'SITE');
CREATE TYPE "PermissionGrantStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');
CREATE TYPE "DataQualityIssueStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');
CREATE TYPE "DataQualitySeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "RosterPublicationStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'REJECTED');

ALTER TYPE "ApprovalType" ADD VALUE IF NOT EXISTS 'ACCESS_CHANGE';
ALTER TYPE "ApprovalType" ADD VALUE IF NOT EXISTS 'PAYROLL_APPROVAL';
ALTER TYPE "ApprovalType" ADD VALUE IF NOT EXISTS 'ROSTER_PUBLICATION';
ALTER TYPE "ApprovalType" ADD VALUE IF NOT EXISTS 'SETTINGS_CHANGE';
ALTER TYPE "ApprovalType" ADD VALUE IF NOT EXISTS 'DATA_IMPORT';
ALTER TYPE "ApprovalType" ADD VALUE IF NOT EXISTS 'DESTRUCTIVE_ACTION';
ALTER TYPE "ApprovalType" ADD VALUE IF NOT EXISTS 'DATA_QUALITY_RESOLUTION';

ALTER TABLE "User"
  ADD COLUMN "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaSecretEncrypted" TEXT,
  ADD COLUMN "mfaEnrolledAt" TIMESTAMP(3),
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

ALTER TABLE "UserPermission"
  DROP CONSTRAINT IF EXISTS "UserPermission_userId_permission_key",
  ADD COLUMN "scopeType" "PermissionScopeType" NOT NULL DEFAULT 'COMPANY',
  ADD COLUMN "scopeId" TEXT,
  ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'company',
  ADD COLUMN "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "reason" TEXT NOT NULL DEFAULT 'Initial access migration',
  ADD COLUMN "requestedById" TEXT,
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvalRequestId" TEXT,
  ADD COLUMN "emergencyAccess" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "status" "PermissionGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "lastUsedAt" TIMESTAMP(3),
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "UserPermission_userId_permission_scopeKey_key"
  ON "UserPermission"("userId", "permission", "scopeKey");
CREATE INDEX "UserPermission_userId_status_validFrom_expiresAt_idx"
  ON "UserPermission"("userId", "status", "validFrom", "expiresAt");
CREATE INDEX "UserPermission_scopeType_scopeId_idx"
  ON "UserPermission"("scopeType", "scopeId");

UPDATE "User" u
SET "mfaRequired" = true
WHERE u."isSystemOwner" = true OR EXISTS (
  SELECT 1 FROM "UserPermission" p
  WHERE p."userId" = u."id" AND p."permission" IN (
    'users.manage', 'permissions.manage_operational', 'permissions.grant_sensitive',
    'payroll.approve', 'payroll.mark_paid', 'settings.manage_statutory',
    'audit.read_sensitive', 'audit.export', 'approvals.review'
  )
);

ALTER TABLE "PayrollItem"
  ADD CONSTRAINT "PayrollItem_payrollRunId_employeeId_key" UNIQUE ("payrollRunId", "employeeId");

ALTER TABLE "LeaveRecord"
  ADD COLUMN "duplicateGroupKey" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewReason" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedById" TEXT,
  ADD COLUMN "voidReason" TEXT;

-- Classify pre-existing duplicates so they stay visible for guided review.
WITH duplicate_days AS (
  SELECT "employeeId", "date", md5("employeeId" || ':' || "date"::text) AS group_key
  FROM "LeaveRecord"
  GROUP BY "employeeId", "date"
  HAVING count(*) > 1
)
UPDATE "LeaveRecord" l
SET "duplicateGroupKey" = d.group_key
FROM duplicate_days d
WHERE l."employeeId" = d."employeeId" AND l."date" = d."date";

CREATE UNIQUE INDEX "LeaveRecord_employeeId_date_active_key"
  ON "LeaveRecord"("employeeId", "date")
  WHERE "duplicateGroupKey" IS NULL AND "voidedAt" IS NULL;

ALTER TABLE "AuditLog"
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "sessionId" TEXT,
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "userAgent" TEXT,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'api',
  ADD COLUMN "result" TEXT NOT NULL DEFAULT 'success',
  ADD COLUMN "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
  ADD COLUMN "beforeState" JSONB,
  ADD COLUMN "afterState" JSONB,
  ADD COLUMN "approvalRequestId" TEXT,
  ADD COLUMN "previousHash" TEXT,
  ADD COLUMN "eventHash" TEXT;

CREATE INDEX "AuditLog_companyId_action_timestamp_idx" ON "AuditLog"("companyId", "action", "timestamp");
CREATE INDEX "AuditLog_companyId_riskLevel_timestamp_idx" ON "AuditLog"("companyId", "riskLevel", "timestamp");
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");

ALTER TABLE "ApprovalRequest"
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "riskLevel" TEXT NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "executedAt" TIMESTAMP(3);

CREATE TABLE "DataQualityIssue" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "groupKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "severity" "DataQualitySeverity" NOT NULL,
  "status" "DataQualityIssueStatus" NOT NULL DEFAULT 'OPEN',
  "affectedRecords" JSONB,
  "proposedResolution" JSONB,
  "reviewedById" TEXT,
  "reviewReason" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataQualityIssue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DataQualityIssue_companyId_ruleKey_groupKey_key" ON "DataQualityIssue"("companyId", "ruleKey", "groupKey");
CREATE INDEX "DataQualityIssue_companyId_status_severity_idx" ON "DataQualityIssue"("companyId", "status", "severity");
CREATE INDEX "DataQualityIssue_companyId_entityType_entityId_idx" ON "DataQualityIssue"("companyId", "entityType", "entityId");
ALTER TABLE "DataQualityIssue" ADD CONSTRAINT "DataQualityIssue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "DataQualityIssue" (
  "id", "companyId", "ruleKey", "entityType", "groupKey", "title", "description",
  "severity", "affectedRecords", "proposedResolution"
)
SELECT
  'dq_leave_' || md5(e."companyId" || ':' || l."duplicateGroupKey"),
  e."companyId",
  'duplicate_leave_day',
  'LeaveRecord',
  l."duplicateGroupKey",
  'Duplicate leave entries need review',
  'More than one leave record exists for the same employee and date.',
  'HIGH',
  jsonb_build_object('recordIds', jsonb_agg(l."id" ORDER BY l."createdAt")),
  jsonb_build_object('action', 'select-canonical-record-and-dismiss-duplicates')
FROM "LeaveRecord" l
JOIN "Employee" e ON e."id" = l."employeeId"
WHERE l."duplicateGroupKey" IS NOT NULL
GROUP BY e."companyId", l."duplicateGroupKey";

CREATE TABLE "RosterPublication" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "RosterPublicationStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "snapshot" JSONB NOT NULL,
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvalRequestId" TEXT,
  "reason" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RosterPublication_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RosterPublication_companyId_siteId_periodStart_periodEnd_version_key" ON "RosterPublication"("companyId", "siteId", "periodStart", "periodEnd", "version");
CREATE INDEX "RosterPublication_companyId_status_periodStart_idx" ON "RosterPublication"("companyId", "status", "periodStart");
CREATE INDEX "RosterPublication_siteId_periodStart_periodEnd_idx" ON "RosterPublication"("siteId", "periodStart", "periodEnd");
ALTER TABLE "RosterPublication" ADD CONSTRAINT "RosterPublication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RosterPublication" ADD CONSTRAINT "RosterPublication_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve pre-existing broken lineage and surface it for guided review. The
-- constraints are NOT VALID so they protect all new writes without silently
-- rewriting historical operational records. They can be validated after the
-- corresponding data-quality issues have been resolved by an authorised user.
INSERT INTO "DataQualityIssue" (
  "id", "companyId", "ruleKey", "entityType", "entityId", "groupKey",
  "title", "description", "severity", "affectedRecords", "proposedResolution"
)
SELECT
  'dq_ts_shift_' || md5(r."id" || ':' || r."sourceShiftId"),
  r."companyId",
  'orphan_timesheet_shift',
  'SiteTimesheetRow',
  r."id",
  r."id" || ':shift:' || r."sourceShiftId",
  'Timesheet row has a missing source shift',
  'The referenced shift no longer exists. Review and relink the row or confirm that it should remain unlinked.',
  'HIGH',
  jsonb_build_object('recordIds', jsonb_build_array(r."id"), 'missingShiftId', r."sourceShiftId"),
  jsonb_build_object('action', 'review-and-relink-or-confirm-unlinked')
FROM "SiteTimesheetRow" r
LEFT JOIN "Shift" s ON s."id" = r."sourceShiftId"
WHERE r."sourceShiftId" IS NOT NULL AND s."id" IS NULL
ON CONFLICT ("companyId", "ruleKey", "groupKey") DO NOTHING;

INSERT INTO "DataQualityIssue" (
  "id", "companyId", "ruleKey", "entityType", "entityId", "groupKey",
  "title", "description", "severity", "affectedRecords", "proposedResolution"
)
SELECT
  'dq_ts_att_' || md5(r."id" || ':' || r."sourceAttendanceId"),
  r."companyId",
  'orphan_timesheet_attendance',
  'SiteTimesheetRow',
  r."id",
  r."id" || ':attendance:' || r."sourceAttendanceId",
  'Timesheet row has a missing source attendance record',
  'The referenced attendance record no longer exists. Review and relink the row or confirm that it should remain unlinked.',
  'HIGH',
  jsonb_build_object('recordIds', jsonb_build_array(r."id"), 'missingAttendanceId', r."sourceAttendanceId"),
  jsonb_build_object('action', 'review-and-relink-or-confirm-unlinked')
FROM "SiteTimesheetRow" r
LEFT JOIN "Attendance" a ON a."id" = r."sourceAttendanceId"
WHERE r."sourceAttendanceId" IS NOT NULL AND a."id" IS NULL
ON CONFLICT ("companyId", "ruleKey", "groupKey") DO NOTHING;

INSERT INTO "DataQualityIssue" (
  "id", "companyId", "ruleKey", "entityType", "entityId", "groupKey",
  "title", "description", "severity", "affectedRecords", "proposedResolution"
)
SELECT
  'dq_ex_shift_' || md5(e."id" || ':' || e."shiftId"),
  e."companyId",
  'orphan_exception_shift',
  'AttendanceException',
  e."id",
  e."id" || ':shift:' || e."shiftId",
  'Attendance exception has a missing shift',
  'The exception references a shift that no longer exists. Review and relink it or confirm that it should remain unlinked.',
  'HIGH',
  jsonb_build_object('recordIds', jsonb_build_array(e."id"), 'missingShiftId', e."shiftId"),
  jsonb_build_object('action', 'review-and-relink-or-confirm-unlinked')
FROM "AttendanceException" e
LEFT JOIN "Shift" s ON s."id" = e."shiftId"
WHERE e."shiftId" IS NOT NULL AND s."id" IS NULL
ON CONFLICT ("companyId", "ruleKey", "groupKey") DO NOTHING;

INSERT INTO "DataQualityIssue" (
  "id", "companyId", "ruleKey", "entityType", "entityId", "groupKey",
  "title", "description", "severity", "affectedRecords", "proposedResolution"
)
SELECT
  'dq_ex_att_' || md5(e."id" || ':' || e."attendanceId"),
  e."companyId",
  'orphan_exception_attendance',
  'AttendanceException',
  e."id",
  e."id" || ':attendance:' || e."attendanceId",
  'Attendance exception has a missing attendance record',
  'The exception references an attendance record that no longer exists. Review and relink it or confirm that it should remain unlinked.',
  'HIGH',
  jsonb_build_object('recordIds', jsonb_build_array(e."id"), 'missingAttendanceId', e."attendanceId"),
  jsonb_build_object('action', 'review-and-relink-or-confirm-unlinked')
FROM "AttendanceException" e
LEFT JOIN "Attendance" a ON a."id" = e."attendanceId"
WHERE e."attendanceId" IS NOT NULL AND a."id" IS NULL
ON CONFLICT ("companyId", "ruleKey", "groupKey") DO NOTHING;

ALTER TABLE "SiteTimesheetRow"
  ADD CONSTRAINT "SiteTimesheetRow_sourceShiftId_fkey" FOREIGN KEY ("sourceShiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "SiteTimesheetRow_sourceAttendanceId_fkey" FOREIGN KEY ("sourceAttendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
CREATE INDEX "SiteTimesheetRow_sourceShiftId_idx" ON "SiteTimesheetRow"("sourceShiftId");
CREATE INDEX "SiteTimesheetRow_sourceAttendanceId_idx" ON "SiteTimesheetRow"("sourceAttendanceId");

ALTER TABLE "AttendanceException"
  ADD CONSTRAINT "AttendanceException_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "AttendanceException_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
