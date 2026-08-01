-- Leave-v3 cutover.
--
-- Replaces the ledger/policy-based leave system with the four-table design
-- described in docs/LEAVE_MANAGEMENT.md. This does NOT delete any existing
-- data: every table the old system owned (and the old column shapes of
-- LeaveRequest/LeaveAdjustment, whose names are reused below) is moved intact
-- into a separate "leave_archive" schema -- same rows, same indexes, same
-- constraints, just outside the "public" schema Prisma manages. Historical
-- leave records stay queryable directly in SQL
-- (e.g. `SELECT * FROM leave_archive."LeaveApplication"`) even though the
-- application no longer reads them. Nothing is dropped.
BEGIN;

CREATE SCHEMA IF NOT EXISTS leave_archive;

-- Normalise legacy employeeType values before the leave-v3 rules engine --
-- which only recognises "general" / "security_officer" (see
-- leave-rules.config.ts) -- starts reading this column for real. Idempotent:
-- a no-op wherever the value is already current.
UPDATE "Employee" SET "employeeType" = 'general' WHERE "employeeType" = 'office';
UPDATE "Employee" SET "employeeType" = 'security_officer' WHERE "employeeType" = 'security';

-- Same normalisation for pay-rule scoping: the payroll engine now matches
-- "appliesTo" against "all" / "security_officer" / "general" only (see
-- payroll-calculation.engine.ts); rules still tagged with the old "security"
-- / "office" values would silently stop applying to anyone otherwise.
UPDATE "EarningsRule" SET "appliesTo" = 'general' WHERE "appliesTo" = 'office';
UPDATE "EarningsRule" SET "appliesTo" = 'security_officer' WHERE "appliesTo" = 'security';
UPDATE "GroupEarningsRule" SET "appliesTo" = 'general' WHERE "appliesTo" = 'office';
UPDATE "GroupEarningsRule" SET "appliesTo" = 'security_officer' WHERE "appliesTo" = 'security';
UPDATE "DeductionRule" SET "appliesTo" = 'general' WHERE "appliesTo" = 'office';
UPDATE "DeductionRule" SET "appliesTo" = 'security_officer' WHERE "appliesTo" = 'security';
UPDATE "GroupDeductionRule" SET "appliesTo" = 'general' WHERE "appliesTo" = 'office';
UPDATE "GroupDeductionRule" SET "appliesTo" = 'security_officer' WHERE "appliesTo" = 'security';

-- Move every table the old leave system owned into the archive schema.
ALTER TABLE "EmployeeLeavePolicyAssignment" SET SCHEMA leave_archive;
ALTER TABLE "EmploymentTerm" SET SCHEMA leave_archive;
ALTER TABLE "LeaveApplication" SET SCHEMA leave_archive;
ALTER TABLE "LeaveApplicationDocument" SET SCHEMA leave_archive;
ALTER TABLE "LeaveApprovalStep" SET SCHEMA leave_archive;
ALTER TABLE "LeaveAuditEvent" SET SCHEMA leave_archive;
ALTER TABLE "LeaveCompanySettings" SET SCHEMA leave_archive;
ALTER TABLE "LeaveLedgerEntry" SET SCHEMA leave_archive;
ALTER TABLE "LeaveOccurrence" SET SCHEMA leave_archive;
ALTER TABLE "LeavePayrollPosting" SET SCHEMA leave_archive;
ALTER TABLE "LeavePolicy" SET SCHEMA leave_archive;
ALTER TABLE "LeavePolicyVersion" SET SCHEMA leave_archive;
ALTER TABLE "LeaveRecord" SET SCHEMA leave_archive;
ALTER TABLE "LeaveSickNote" SET SCHEMA leave_archive;
ALTER TABLE "LeaveTypeDefinition" SET SCHEMA leave_archive;

-- LeaveRequest and LeaveAdjustment are reused table names with an
-- incompatible column layout below, so their old contents move to the
-- archive too, freeing the names for the fresh leave-v3 tables.
ALTER TABLE "LeaveRequest" SET SCHEMA leave_archive;
ALTER TABLE "LeaveAdjustment" SET SCHEMA leave_archive;

-- Move the enum types the archived tables still depend on, so "public" ends
-- up containing only the types leave-v3 declares.
ALTER TYPE "LeavePolicyReviewStatus" SET SCHEMA leave_archive;
ALTER TYPE "LeaveDurationMode" SET SCHEMA leave_archive;
ALTER TYPE "LeavePayrollTreatment" SET SCHEMA leave_archive;
ALTER TYPE "LeaveApplicationStatus" SET SCHEMA leave_archive;
ALTER TYPE "LeaveApplicationSource" SET SCHEMA leave_archive;
ALTER TYPE "LeaveOccurrenceStatus" SET SCHEMA leave_archive;
ALTER TYPE "LeaveLedgerEntryType" SET SCHEMA leave_archive;
ALTER TYPE "LeaveApprovalDecision" SET SCHEMA leave_archive;
ALTER TYPE "LeaveDocumentReviewStatus" SET SCHEMA leave_archive;
ALTER TYPE "LeaveAdjustmentStatus" SET SCHEMA leave_archive;

-- Employee PSIRA fields: rename in place so existing values survive (same
-- meaning as before, new names to match the leave-v3 field set).
ALTER TABLE "Employee" RENAME COLUMN "psiraNumber" TO "psiraRegistrationNumber";
ALTER TABLE "Employee" RENAME COLUMN "psiraExpiryDate" TO "psiraRegistrationExpiry";
ALTER TABLE "Employee" ADD COLUMN "psiraGrade" TEXT;
ALTER TABLE "Employee" ADD COLUMN "sickLeaveCycleAnchor" TIMESTAMP(3);
ALTER TABLE "Employee" ALTER COLUMN "employeeType" SET DEFAULT 'security_officer';

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'FAMILY_RESPONSIBILITY', 'PARENTAL', 'STUDY');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FamilyResponsibilityReason" AS ENUM ('CHILD_BIRTH', 'CHILD_SICK', 'SPOUSE_OR_LIFE_PARTNER_DEATH', 'PARENT_DEATH', 'ADOPTIVE_PARENT_DEATH', 'GRANDPARENT_DEATH', 'CHILD_DEATH', 'ADOPTED_CHILD_DEATH', 'GRANDCHILD_DEATH', 'SIBLING_DEATH');

-- CreateEnum
CREATE TYPE "ParentalLeaveScenario" AS ENUM ('SOLE_OR_ONLY_EMPLOYED_PARENT', 'SHARED_POOL');

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveType" "LeaveType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "unitsRequested" DECIMAL(5,2) NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "familyResponsibilityReason" "FamilyResponsibilityReason",
    "parentalLeaveScenario" "ParentalLeaveScenario",
    "workedPublicHoliday" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "payrollRunId" TEXT,
    "retentionUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalCertificate" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "practitionerName" TEXT NOT NULL,
    "practitionerRegistrationNumber" TEXT NOT NULL,
    "consultationDate" DATE NOT NULL,
    "bookedOffStartDate" DATE NOT NULL,
    "bookedOffEndDate" DATE NOT NULL,
    "fileReference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveAdjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveType" "LeaveType" NOT NULL,
    "units" DECIMAL(5,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveAuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveRequest_companyId_employeeId_leaveType_idx" ON "LeaveRequest"("companyId", "employeeId", "leaveType");

-- CreateIndex
CREATE INDEX "LeaveRequest_companyId_status_idx" ON "LeaveRequest"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalCertificate_leaveRequestId_key" ON "MedicalCertificate"("leaveRequestId");

-- CreateIndex
CREATE INDEX "LeaveAdjustment_companyId_employeeId_leaveType_idx" ON "LeaveAdjustment"("companyId", "employeeId", "leaveType");

-- CreateIndex
CREATE INDEX "LeaveAuditLog_companyId_employeeId_idx" ON "LeaveAuditLog"("companyId", "employeeId");

-- CreateIndex
CREATE INDEX "LeaveAuditLog_entityType_entityId_idx" ON "LeaveAuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalCertificate" ADD CONSTRAINT "MedicalCertificate_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT "LeaveAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT "LeaveAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAuditLog" ADD CONSTRAINT "LeaveAuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex (unrelated naming fix, carried over from the schema's pending site-coverage-days changes)
ALTER INDEX "SiteTimesheetRow_siteTimesheetId_workDate_plannedGuardId_planne" RENAME TO "SiteTimesheetRow_siteTimesheetId_workDate_plannedGuardId_pl_key";

COMMIT;
