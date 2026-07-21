-- Keep the schema transition atomic. In particular, a missing permission for
-- btree_gist must not leave a partially-created leave domain behind.
BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "LeavePolicyReviewStatus" AS ENUM ('DRAFT', 'PENDING_HR_LEGAL_CONFIRMATION', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "LeaveDurationMode" AS ENUM ('CALENDAR_CONSECUTIVE', 'SCHEDULED_WORK', 'SHIFT_COUNT', 'HOURS');

-- CreateEnum
CREATE TYPE "LeavePayrollTreatment" AS ENUM ('PAID_EMPLOYER', 'UNPAID_DEDUCTION', 'UIF_NO_EMPLOYER_PAY', 'IOD_COMPENSATION', 'INFORMATION_ONLY', 'SPLIT');

-- CreateEnum
CREATE TYPE "LeaveApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING_HR', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLATION_REQUESTED', 'CANCELLED', 'EXPIRED', 'PAYROLL_PROCESSED', 'ADJUSTMENT_REQUIRED', 'IMPORTED_APPROVED');

-- CreateEnum
CREATE TYPE "LeaveApplicationSource" AS ENUM ('ADMIN', 'WHATSAPP', 'LEGACY_IMPORT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LeaveOccurrenceStatus" AS ENUM ('RESERVED', 'APPROVED', 'CANCELLED', 'PAYROLL_PROCESSED');

-- CreateEnum
CREATE TYPE "LeaveLedgerEntryType" AS ENUM ('ACCRUAL', 'OPENING_BALANCE', 'RESERVATION', 'RESERVATION_RELEASE', 'TAKEN', 'REVERSAL', 'ADJUSTMENT', 'CARRY_OVER', 'EXPIRY', 'PAYOUT');

-- CreateEnum
CREATE TYPE "LeaveApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'QUERY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaveDocumentReviewStatus" AS ENUM ('PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LeaveAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'POSTED');

-- CreateTable
CREATE TABLE "EmploymentTerm" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "contractType" TEXT NOT NULL,
    "normalMinutesPerShift" INTEGER NOT NULL,
    "normalDaysPerWeek" DECIMAL(4,2),
    "workingPattern" JSONB,
    "source" TEXT NOT NULL DEFAULT 'HR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploymentTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveTypeDefinition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPaid" BOOLEAN NOT NULL,
    "payrollTreatment" "LeavePayrollTreatment" NOT NULL,
    "durationMode" "LeaveDurationMode" NOT NULL,
    "requiresBalance" BOOLEAN NOT NULL DEFAULT true,
    "allowPartialDay" BOOLEAN NOT NULL DEFAULT false,
    "requiresDocument" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveTypeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeavePolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeavePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeavePolicyVersion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reviewStatus" "LeavePolicyReviewStatus" NOT NULL DEFAULT 'PENDING_HR_LEGAL_CONFIRMATION',
    "sourceAuthority" TEXT NOT NULL,
    "legalReference" TEXT,
    "entitlementMinutes" INTEGER,
    "accrualMethod" TEXT NOT NULL,
    "accrualRateMinutes" DECIMAL(12,6),
    "cycleMonths" INTEGER NOT NULL DEFAULT 12,
    "carryOverLimitMinutes" INTEGER,
    "expiryMonths" INTEGER,
    "noticeDays" INTEGER,
    "maxConsecutiveDays" INTEGER,
    "negativeBalanceAllowed" BOOLEAN NOT NULL DEFAULT false,
    "autoConvertToUnpaid" BOOLEAN NOT NULL DEFAULT false,
    "approvalFlow" JSONB NOT NULL,
    "documentRules" JSONB,
    "calculationRules" JSONB,
    "createdBy" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeavePolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeLeavePolicyAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeLeavePolicyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveApplication" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "policyVersionId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "requestedMinutes" INTEGER NOT NULL,
    "calculatedMinutes" INTEGER NOT NULL DEFAULT 0,
    "paidMinutes" INTEGER NOT NULL DEFAULT 0,
    "unpaidMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "LeaveApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "LeaveApplicationSource" NOT NULL DEFAULT 'ADMIN',
    "reason" TEXT,
    "decisionReason" TEXT,
    "retrospectiveReason" TEXT,
    "idempotencyKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "reviewedById" TEXT,
    "legacyLeaveRequestId" TEXT,
    "legacyLeaveRecordIds" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveOccurrence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveDate" DATE NOT NULL,
    "shiftId" TEXT,
    "siteId" TEXT,
    "scheduledMinutes" INTEGER NOT NULL,
    "requestedMinutes" INTEGER NOT NULL,
    "paidMinutes" INTEGER NOT NULL DEFAULT 0,
    "unpaidMinutes" INTEGER NOT NULL DEFAULT 0,
    "payrollTreatment" "LeavePayrollTreatment" NOT NULL,
    "status" "LeaveOccurrenceStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveLedgerEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "applicationId" TEXT,
    "entryType" "LeaveLedgerEntryType" NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "reversalOfId" TEXT,
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveApprovalStep" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "decision" "LeaveApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "actorId" TEXT,
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveApplicationDocument" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "reviewStatus" "LeaveDocumentReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "uploadedById" TEXT,
    "uploadedByEmployeeId" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveApplicationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveAdjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "applicationId" TEXT,
    "minutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LeaveAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "payrollImpact" JSONB,
    "supportingFileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeavePayrollPosting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "paidMinutes" INTEGER NOT NULL DEFAULT 0,
    "unpaidMinutes" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,2),
    "isReversal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeavePayrollPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveAuditEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT,
    "applicationId" TEXT,
    "userId" TEXT,
    "eventType" TEXT NOT NULL,
    "reason" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "payrollRunId" TEXT,
    "rosterPeriod" JSONB,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmploymentTerm_companyId_effectiveFrom_effectiveTo_idx" ON "EmploymentTerm"("companyId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentTerm_employeeId_effectiveFrom_key" ON "EmploymentTerm"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "LeaveTypeDefinition_companyId_isActive_idx" ON "LeaveTypeDefinition"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveTypeDefinition_companyId_code_key" ON "LeaveTypeDefinition"("companyId", "code");

-- CreateIndex
CREATE INDEX "LeavePolicy_companyId_idx" ON "LeavePolicy"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicy_companyId_name_key" ON "LeavePolicy"("companyId", "name");

-- CreateIndex
CREATE INDEX "LeavePolicyVersion_companyId_effectiveFrom_effectiveTo_revi_idx" ON "LeavePolicyVersion"("companyId", "effectiveFrom", "effectiveTo", "reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicyVersion_policyId_leaveTypeId_version_key" ON "LeavePolicyVersion"("policyId", "leaveTypeId", "version");

-- CreateIndex
CREATE INDEX "EmployeeLeavePolicyAssignment_employeeId_effectiveFrom_effe_idx" ON "EmployeeLeavePolicyAssignment"("employeeId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeLeavePolicyAssignment_employeeId_policyId_effective_key" ON "EmployeeLeavePolicyAssignment"("employeeId", "policyId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "LeaveApplication_companyId_status_startDate_endDate_idx" ON "LeaveApplication"("companyId", "status", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "LeaveApplication_employeeId_startDate_endDate_idx" ON "LeaveApplication"("employeeId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "LeaveApplication_leaveTypeId_status_idx" ON "LeaveApplication"("leaveTypeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveApplication_companyId_idempotencyKey_key" ON "LeaveApplication"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LeaveOccurrence_companyId_leaveDate_status_idx" ON "LeaveOccurrence"("companyId", "leaveDate", "status");

-- CreateIndex
CREATE INDEX "LeaveOccurrence_employeeId_leaveDate_status_idx" ON "LeaveOccurrence"("employeeId", "leaveDate", "status");

-- CreateIndex
CREATE INDEX "LeaveOccurrence_shiftId_idx" ON "LeaveOccurrence"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveOccurrence_applicationId_leaveDate_shiftId_key" ON "LeaveOccurrence"("applicationId", "leaveDate", "shiftId");

-- PostgreSQL ordinary unique indexes treat NULL values as distinct. Calendar
-- leave without a rostered shift must still have at most one occurrence per day.
CREATE UNIQUE INDEX "LeaveOccurrence_applicationId_leaveDate_unrostered_key"
  ON "LeaveOccurrence"("applicationId", "leaveDate")
  WHERE "shiftId" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "LeaveLedgerEntry_reversalOfId_key" ON "LeaveLedgerEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "LeaveLedgerEntry_companyId_employeeId_leaveTypeId_effective_idx" ON "LeaveLedgerEntry"("companyId", "employeeId", "leaveTypeId", "effectiveDate");

-- CreateIndex
CREATE INDEX "LeaveLedgerEntry_applicationId_idx" ON "LeaveLedgerEntry"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveLedgerEntry_companyId_idempotencyKey_key" ON "LeaveLedgerEntry"("companyId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LeaveApprovalStep_role_decision_idx" ON "LeaveApprovalStep"("role", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveApprovalStep_applicationId_stepOrder_key" ON "LeaveApprovalStep"("applicationId", "stepOrder");

-- CreateIndex
CREATE INDEX "LeaveApplicationDocument_applicationId_reviewStatus_idx" ON "LeaveApplicationDocument"("applicationId", "reviewStatus");

-- CreateIndex
CREATE INDEX "LeaveApplicationDocument_uploadedByEmployeeId_idx" ON "LeaveApplicationDocument"("uploadedByEmployeeId");

-- CreateIndex
CREATE INDEX "LeaveAdjustment_companyId_status_createdAt_idx" ON "LeaveAdjustment"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LeaveAdjustment_employeeId_leaveTypeId_idx" ON "LeaveAdjustment"("employeeId", "leaveTypeId");

-- CreateIndex
CREATE INDEX "LeavePayrollPosting_companyId_payrollRunId_idx" ON "LeavePayrollPosting"("companyId", "payrollRunId");

-- CreateIndex
CREATE INDEX "LeavePayrollPosting_applicationId_idx" ON "LeavePayrollPosting"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "LeavePayrollPosting_occurrenceId_isReversal_key" ON "LeavePayrollPosting"("occurrenceId", "isReversal");

-- CreateIndex
CREATE INDEX "LeaveAuditEvent_companyId_occurredAt_idx" ON "LeaveAuditEvent"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "LeaveAuditEvent_applicationId_occurredAt_idx" ON "LeaveAuditEvent"("applicationId", "occurredAt");

-- CreateIndex
CREATE INDEX "LeaveAuditEvent_employeeId_occurredAt_idx" ON "LeaveAuditEvent"("employeeId", "occurredAt");

-- AddForeignKey
ALTER TABLE "EmploymentTerm" ADD CONSTRAINT "EmploymentTerm_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentTerm" ADD CONSTRAINT "EmploymentTerm_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveTypeDefinition" ADD CONSTRAINT "LeaveTypeDefinition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePolicy" ADD CONSTRAINT "LeavePolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePolicyVersion" ADD CONSTRAINT "LeavePolicyVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePolicyVersion" ADD CONSTRAINT "LeavePolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "LeavePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePolicyVersion" ADD CONSTRAINT "LeavePolicyVersion_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeavePolicyAssignment" ADD CONSTRAINT "EmployeeLeavePolicyAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeavePolicyAssignment" ADD CONSTRAINT "EmployeeLeavePolicyAssignment_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "LeavePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "LeavePolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveOccurrence" ADD CONSTRAINT "LeaveOccurrence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveOccurrence" ADD CONSTRAINT "LeaveOccurrence_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LeaveApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveOccurrence" ADD CONSTRAINT "LeaveOccurrence_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveOccurrence" ADD CONSTRAINT "LeaveOccurrence_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LeaveApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "LeaveLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApprovalStep" ADD CONSTRAINT "LeaveApprovalStep_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LeaveApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApprovalStep" ADD CONSTRAINT "LeaveApprovalStep_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApplicationDocument" ADD CONSTRAINT "LeaveApplicationDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LeaveApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApplicationDocument" ADD CONSTRAINT "LeaveApplicationDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApplicationDocument" ADD CONSTRAINT "LeaveApplicationDocument_uploadedByEmployeeId_fkey" FOREIGN KEY ("uploadedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApplicationDocument" ADD CONSTRAINT "LeaveApplicationDocument_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT "LeaveAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT "LeaveAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT "LeaveAdjustment_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT "LeaveAdjustment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LeaveApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT "LeaveAdjustment_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT "LeaveAdjustment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePayrollPosting" ADD CONSTRAINT "LeavePayrollPosting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePayrollPosting" ADD CONSTRAINT "LeavePayrollPosting_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LeaveApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePayrollPosting" ADD CONSTRAINT "LeavePayrollPosting_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "LeaveOccurrence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePayrollPosting" ADD CONSTRAINT "LeavePayrollPosting_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAuditEvent" ADD CONSTRAINT "LeaveAuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAuditEvent" ADD CONSTRAINT "LeaveAuditEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAuditEvent" ADD CONSTRAINT "LeaveAuditEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LeaveApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAuditEvent" ADD CONSTRAINT "LeaveAuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Payroll-critical invariants that Prisma cannot express directly.
ALTER TABLE "EmploymentTerm"
  ADD CONSTRAINT "EmploymentTerm_valid_date_range" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  ADD CONSTRAINT "EmploymentTerm_no_overlap"
  EXCLUDE USING gist (
    "employeeId" WITH =,
    daterange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::date), '[]') WITH &&
  );

ALTER TABLE "LeavePolicyVersion"
  ADD CONSTRAINT "LeavePolicyVersion_valid_date_range" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  ADD CONSTRAINT "LeavePolicyVersion_no_active_overlap"
  EXCLUDE USING gist (
    "policyId" WITH =,
    "leaveTypeId" WITH =,
    daterange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::date), '[]') WITH &&
  )
  WHERE ("reviewStatus" = 'ACTIVE');

ALTER TABLE "EmployeeLeavePolicyAssignment"
  ADD CONSTRAINT "EmployeeLeavePolicyAssignment_valid_date_range" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  ADD CONSTRAINT "EmployeeLeavePolicyAssignment_no_overlap"
  EXCLUDE USING gist (
    "employeeId" WITH =,
    daterange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::date), '[]') WITH &&
  );

ALTER TABLE "LeaveApplication"
  ADD CONSTRAINT "LeaveApplication_valid_date_range" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "LeaveApplication_non_negative_minutes" CHECK (
    "requestedMinutes" >= 0 AND "calculatedMinutes" >= 0 AND
    "paidMinutes" >= 0 AND "unpaidMinutes" >= 0
  ),
  ADD CONSTRAINT "LeaveApplication_payroll_minutes_within_total" CHECK (
    "paidMinutes" + "unpaidMinutes" <= "calculatedMinutes"
  ),
  ADD CONSTRAINT "LeaveApplication_positive_submitted_duration" CHECK (
    "status" = 'DRAFT' OR "calculatedMinutes" > 0
  );

ALTER TABLE "LeaveOccurrence"
  ADD CONSTRAINT "LeaveOccurrence_non_negative_minutes" CHECK (
    "scheduledMinutes" > 0 AND "requestedMinutes" > 0 AND
    "paidMinutes" >= 0 AND "unpaidMinutes" >= 0
  ),
  ADD CONSTRAINT "LeaveOccurrence_request_within_schedule" CHECK (
    "requestedMinutes" <= "scheduledMinutes"
  ),
  ADD CONSTRAINT "LeaveOccurrence_payroll_minutes_within_request" CHECK (
    "paidMinutes" + "unpaidMinutes" <= "requestedMinutes"
  );

ALTER TABLE "LeaveLedgerEntry"
  ADD CONSTRAINT "LeaveLedgerEntry_non_zero_minutes" CHECK ("minutes" <> 0);

ALTER TABLE "LeaveAdjustment"
  ADD CONSTRAINT "LeaveAdjustment_non_zero_minutes" CHECK ("minutes" <> 0);

-- PostgreSQL is the final concurrency guard; application-level preview remains
-- responsible for producing a readable conflict before this constraint fires.
ALTER TABLE "LeaveApplication"
  ADD CONSTRAINT "LeaveApplication_no_active_overlap"
  EXCLUDE USING gist (
    "employeeId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  )
  WHERE ("status" IN (
    'SUBMITTED', 'PENDING_HR', 'APPROVED', 'CANCELLATION_REQUESTED', 'PAYROLL_PROCESSED',
    'ADJUSTMENT_REQUIRED', 'IMPORTED_APPROVED'
  ));

COMMIT;
