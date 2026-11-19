-- Pre-enum data cleanup (must precede enum narrowing)
UPDATE "OperationalAlert" SET "sourceModule" = 'ATTENDANCE' WHERE "sourceModule"::text IN ('PAYROLL', 'TASKS');
UPDATE "ManagedDocument" SET "category" = 'OTHER' WHERE "category"::text IN ('PAYROLL', 'TASK', 'ACADEMY');
DELETE FROM "ApprovalRequest" WHERE "approvalType"::text NOT IN ('ATTENDANCE_EXCEPTION','MISSED_CLOCK_IN','MISSED_CLOCK_OUT','OVERTIME','LEAVE','SICK_NOTE','SITE_TIMESHEET','INCIDENT','DOCUMENT_REVIEW');

-- CreateEnum (idempotent)
DO $$ BEGIN
  CREATE TYPE "PayrollExportProvider" AS ENUM ('SAGE_BUSINESS_CLOUD_ZA', 'SAGE_VIP', 'SAGE_300_PEOPLE', 'GENERIC_CSV', 'JSON_WEBHOOK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PayrollExportBatchStatus" AS ENUM ('DRAFT', 'LOCKED', 'EXPORTED', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum: AlertSourceModule
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AlertSourceModule' AND e.enumlabel IN ('PAYROLL', 'TASKS')
  ) THEN
    CREATE TYPE "AlertSourceModule_new" AS ENUM ('DASHBOARD', 'ATTENDANCE', 'ROSTERING', 'SITES', 'DOCUMENTS', 'INCIDENTS', 'REPORTS', 'WHATSAPP', 'APPROVALS', 'COMPLIANCE');
    ALTER TABLE "OperationalAlert" ALTER COLUMN "sourceModule" TYPE "AlertSourceModule_new" USING ("sourceModule"::text::"AlertSourceModule_new");
    ALTER TYPE "AlertSourceModule" RENAME TO "AlertSourceModule_old";
    ALTER TYPE "AlertSourceModule_new" RENAME TO "AlertSourceModule";
    DROP TYPE "AlertSourceModule_old";
  END IF;
END $$;

-- AlterEnum: DocumentCategory
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'DocumentCategory' AND e.enumlabel IN ('PAYROLL', 'TASK', 'ACADEMY')
  ) THEN
    CREATE TYPE "DocumentCategory_new" AS ENUM ('EMPLOYEE', 'SITE', 'CLIENT', 'ATTENDANCE', 'INCIDENT', 'EQUIPMENT', 'COMPLIANCE', 'BILLING', 'REPORT', 'OTHER');
    ALTER TABLE "ManagedDocument" ALTER COLUMN "category" TYPE "DocumentCategory_new" USING ("category"::text::"DocumentCategory_new");
    ALTER TYPE "DocumentCategory" RENAME TO "DocumentCategory_old";
    ALTER TYPE "DocumentCategory_new" RENAME TO "DocumentCategory";
    DROP TYPE "DocumentCategory_old";
  END IF;
END $$;

-- AlterEnum: ApprovalType
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ApprovalType' AND e.enumlabel NOT IN ('ATTENDANCE_EXCEPTION', 'MISSED_CLOCK_IN', 'MISSED_CLOCK_OUT', 'OVERTIME', 'LEAVE', 'SICK_NOTE', 'SITE_TIMESHEET', 'INCIDENT', 'DOCUMENT_REVIEW')
  ) THEN
    CREATE TYPE "ApprovalType_new" AS ENUM ('ATTENDANCE_EXCEPTION', 'MISSED_CLOCK_IN', 'MISSED_CLOCK_OUT', 'OVERTIME', 'LEAVE', 'SICK_NOTE', 'SITE_TIMESHEET', 'INCIDENT', 'DOCUMENT_REVIEW');
    ALTER TABLE "ApprovalRequest" ALTER COLUMN "approvalType" TYPE "ApprovalType_new" USING ("approvalType"::text::"ApprovalType_new");
    ALTER TYPE "ApprovalType" RENAME TO "ApprovalType_old";
    ALTER TYPE "ApprovalType_new" RENAME TO "ApprovalType";
    DROP TYPE "ApprovalType_old";
  END IF;
END $$;
-- DropForeignKey
ALTER TABLE "Employee" DROP CONSTRAINT IF EXISTS "Employee_gradeId_fkey";

-- DropForeignKey
ALTER TABLE "PayrollRun" DROP CONSTRAINT IF EXISTS "PayrollRun_companyId_fkey";

-- DropForeignKey
ALTER TABLE "PayrollItem" DROP CONSTRAINT IF EXISTS "PayrollItem_payrollRunId_fkey";

-- DropForeignKey
ALTER TABLE "PayrollItem" DROP CONSTRAINT IF EXISTS "PayrollItem_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "PayRule" DROP CONSTRAINT IF EXISTS "PayRule_companyId_fkey";

-- DropForeignKey
ALTER TABLE "PayGrade" DROP CONSTRAINT IF EXISTS "PayGrade_companyId_fkey";

-- DropForeignKey
ALTER TABLE "PayGrade" DROP CONSTRAINT IF EXISTS "PayGrade_groupId_fkey";

-- DropForeignKey
ALTER TABLE "PayArea" DROP CONSTRAINT IF EXISTS "PayArea_companyId_fkey";

-- DropForeignKey
ALTER TABLE "PayGradeDefinition" DROP CONSTRAINT IF EXISTS "PayGradeDefinition_companyId_fkey";

-- DropForeignKey
ALTER TABLE "PayAreaGradeRate" DROP CONSTRAINT IF EXISTS "PayAreaGradeRate_companyId_fkey";

-- DropForeignKey
ALTER TABLE "PayAreaGradeRate" DROP CONSTRAINT IF EXISTS "PayAreaGradeRate_areaId_fkey";

-- DropForeignKey
ALTER TABLE "PayAreaGradeRate" DROP CONSTRAINT IF EXISTS "PayAreaGradeRate_gradeId_fkey";

-- DropForeignKey
ALTER TABLE "SitePayProfile" DROP CONSTRAINT IF EXISTS "SitePayProfile_companyId_fkey";

-- DropForeignKey
ALTER TABLE "SitePayProfile" DROP CONSTRAINT IF EXISTS "SitePayProfile_siteId_fkey";

-- DropForeignKey
ALTER TABLE "SitePayProfile" DROP CONSTRAINT IF EXISTS "SitePayProfile_areaId_fkey";

-- DropForeignKey
ALTER TABLE "SitePayProfile" DROP CONSTRAINT IF EXISTS "SitePayProfile_gradeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeePayrollHomeSite" DROP CONSTRAINT IF EXISTS "EmployeePayrollHomeSite_companyId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeePayrollHomeSite" DROP CONSTRAINT IF EXISTS "EmployeePayrollHomeSite_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeePayrollHomeSite" DROP CONSTRAINT IF EXISTS "EmployeePayrollHomeSite_siteId_fkey";

-- DropForeignKey
ALTER TABLE "GroupPayRule" DROP CONSTRAINT IF EXISTS "GroupPayRule_companyId_fkey";

-- DropForeignKey
ALTER TABLE "GroupPayRule" DROP CONSTRAINT IF EXISTS "GroupPayRule_groupId_fkey";

-- DropForeignKey
ALTER TABLE "GroupEarningsRule" DROP CONSTRAINT IF EXISTS "GroupEarningsRule_companyId_fkey";

-- DropForeignKey
ALTER TABLE "GroupEarningsRule" DROP CONSTRAINT IF EXISTS "GroupEarningsRule_groupId_fkey";

-- DropForeignKey
ALTER TABLE "GroupDeductionRule" DROP CONSTRAINT IF EXISTS "GroupDeductionRule_companyId_fkey";

-- DropForeignKey
ALTER TABLE "GroupDeductionRule" DROP CONSTRAINT IF EXISTS "GroupDeductionRule_groupId_fkey";

-- DropForeignKey
ALTER TABLE "EarningsRule" DROP CONSTRAINT IF EXISTS "EarningsRule_companyId_fkey";

-- DropForeignKey
ALTER TABLE "DeductionRule" DROP CONSTRAINT IF EXISTS "DeductionRule_companyId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeDeduction" DROP CONSTRAINT IF EXISTS "EmployeeDeduction_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeDeduction" DROP CONSTRAINT IF EXISTS "EmployeeDeduction_deductionRuleId_fkey";

-- DropForeignKey
ALTER TABLE "Timesheet" DROP CONSTRAINT IF EXISTS "Timesheet_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Timesheet" DROP CONSTRAINT IF EXISTS "Timesheet_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "Timesheet" DROP CONSTRAINT IF EXISTS "Timesheet_payrollRunId_fkey";

-- DropForeignKey
ALTER TABLE "Payslip" DROP CONSTRAINT IF EXISTS "Payslip_payrollItemId_fkey";

-- DropForeignKey
ALTER TABLE "TaskProject" DROP CONSTRAINT IF EXISTS "TaskProject_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_siteId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_parentTaskId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_createdById_fkey";

-- DropForeignKey
ALTER TABLE "TaskComment" DROP CONSTRAINT IF EXISTS "TaskComment_taskId_fkey";

-- DropForeignKey
ALTER TABLE "TaskComment" DROP CONSTRAINT IF EXISTS "TaskComment_userId_fkey";

-- DropForeignKey
ALTER TABLE "TaskAttachment" DROP CONSTRAINT IF EXISTS "TaskAttachment_taskId_fkey";

-- DropForeignKey
ALTER TABLE "TaskAttachment" DROP CONSTRAINT IF EXISTS "TaskAttachment_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "TaskReminder" DROP CONSTRAINT IF EXISTS "TaskReminder_taskId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyBranch" DROP CONSTRAINT IF EXISTS "AcademyBranch_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "StudentDocument" DROP CONSTRAINT IF EXISTS "StudentDocument_companyId_fkey";

-- DropForeignKey
ALTER TABLE "StudentDocument" DROP CONSTRAINT IF EXISTS "StudentDocument_studentId_fkey";

-- DropForeignKey
ALTER TABLE "StudentDocument" DROP CONSTRAINT IF EXISTS "StudentDocument_uploadedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "Course" DROP CONSTRAINT IF EXISTS "Course_companyId_fkey";

-- DropForeignKey
ALTER TABLE "CourseRun" DROP CONSTRAINT IF EXISTS "CourseRun_companyId_fkey";

-- DropForeignKey
ALTER TABLE "CourseRun" DROP CONSTRAINT IF EXISTS "CourseRun_courseId_fkey";

-- DropForeignKey
ALTER TABLE "CourseRun" DROP CONSTRAINT IF EXISTS "CourseRun_academyBranchId_fkey";

-- DropForeignKey
ALTER TABLE "CourseRun" DROP CONSTRAINT IF EXISTS "CourseRun_instructorEmployeeId_fkey";

-- DropForeignKey
ALTER TABLE "FeePlan" DROP CONSTRAINT IF EXISTS "FeePlan_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Enrolment" DROP CONSTRAINT IF EXISTS "Enrolment_companyId_fkey";

-- DropForeignKey
ALTER TABLE "Enrolment" DROP CONSTRAINT IF EXISTS "Enrolment_studentId_fkey";

-- DropForeignKey
ALTER TABLE "Enrolment" DROP CONSTRAINT IF EXISTS "Enrolment_courseRunId_fkey";

-- DropForeignKey
ALTER TABLE "Enrolment" DROP CONSTRAINT IF EXISTS "Enrolment_feePlanId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyInvoice" DROP CONSTRAINT IF EXISTS "AcademyInvoice_companyId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyInvoice" DROP CONSTRAINT IF EXISTS "AcademyInvoice_studentId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyInvoice" DROP CONSTRAINT IF EXISTS "AcademyInvoice_enrolmentId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyInvoiceLine" DROP CONSTRAINT IF EXISTS "AcademyInvoiceLine_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyPayment" DROP CONSTRAINT IF EXISTS "AcademyPayment_companyId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyPayment" DROP CONSTRAINT IF EXISTS "AcademyPayment_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyPayment" DROP CONSTRAINT IF EXISTS "AcademyPayment_studentId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyPayment" DROP CONSTRAINT IF EXISTS "AcademyPayment_proofDocumentId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyPayment" DROP CONSTRAINT IF EXISTS "AcademyPayment_verifiedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyReceipt" DROP CONSTRAINT IF EXISTS "AcademyReceipt_companyId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyReceipt" DROP CONSTRAINT IF EXISTS "AcademyReceipt_paymentId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyReceipt" DROP CONSTRAINT IF EXISTS "AcademyReceipt_issuedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyProfile" DROP CONSTRAINT IF EXISTS "AcademyProfile_companyId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyInstructor" DROP CONSTRAINT IF EXISTS "AcademyInstructor_companyId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyInstructor" DROP CONSTRAINT IF EXISTS "AcademyInstructor_assignedBranchId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyInstructorDocument" DROP CONSTRAINT IF EXISTS "AcademyInstructorDocument_companyId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyInstructorDocument" DROP CONSTRAINT IF EXISTS "AcademyInstructorDocument_instructorId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyInstructorDocument" DROP CONSTRAINT IF EXISTS "AcademyInstructorDocument_uploadedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyInstructorDocument" DROP CONSTRAINT IF EXISTS "AcademyInstructorDocument_verifiedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyClassroom" DROP CONSTRAINT IF EXISTS "AcademyClassroom_companyId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyClassroom" DROP CONSTRAINT IF EXISTS "AcademyClassroom_academyBranchId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyAttendanceSession" DROP CONSTRAINT IF EXISTS "AcademyAttendanceSession_companyId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyAttendanceSession" DROP CONSTRAINT IF EXISTS "AcademyAttendanceSession_courseRunId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyAttendanceSession" DROP CONSTRAINT IF EXISTS "AcademyAttendanceSession_classroomId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyAttendanceSession" DROP CONSTRAINT IF EXISTS "AcademyAttendanceSession_instructorId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyAttendanceRecord" DROP CONSTRAINT IF EXISTS "AcademyAttendanceRecord_companyId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyAttendanceRecord" DROP CONSTRAINT IF EXISTS "AcademyAttendanceRecord_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyAttendanceRecord" DROP CONSTRAINT IF EXISTS "AcademyAttendanceRecord_enrolmentId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyAttendanceRecord" DROP CONSTRAINT IF EXISTS "AcademyAttendanceRecord_markedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyAssessment" DROP CONSTRAINT IF EXISTS "AcademyAssessment_companyId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyAssessment" DROP CONSTRAINT IF EXISTS "AcademyAssessment_learnerId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyAssessment" DROP CONSTRAINT IF EXISTS "AcademyAssessment_courseId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyAssessment" DROP CONSTRAINT IF EXISTS "AcademyAssessment_instructorId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyCertificate" DROP CONSTRAINT IF EXISTS "AcademyCertificate_companyId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyCertificate" DROP CONSTRAINT IF EXISTS "AcademyCertificate_learnerId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyCertificate" DROP CONSTRAINT IF EXISTS "AcademyCertificate_courseId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyCertificate" DROP CONSTRAINT IF EXISTS "AcademyCertificate_enrolmentId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyCertificate" DROP CONSTRAINT IF EXISTS "AcademyCertificate_issuedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyComplianceDocument" DROP CONSTRAINT IF EXISTS "AcademyComplianceDocument_companyId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyComplianceDocument" DROP CONSTRAINT IF EXISTS "AcademyComplianceDocument_verifiedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyPolicyDocument" DROP CONSTRAINT IF EXISTS "AcademyPolicyDocument_companyId_fkey";

-- DropForeignKey
ALTER TABLE "AcademyRenewalAlert" DROP CONSTRAINT IF EXISTS "AcademyRenewalAlert_companyId_fkey";

-- DropForeignKey
ALTER TABLE "ManagedDocument" DROP CONSTRAINT IF EXISTS "ManagedDocument_taskId_fkey";

-- DropForeignKey
ALTER TABLE "Incident" DROP CONSTRAINT IF EXISTS "Incident_followUpTaskId_fkey";

-- DropForeignKey
ALTER TABLE "PayrollPeriodReadiness" DROP CONSTRAINT IF EXISTS "PayrollPeriodReadiness_companyId_fkey";

-- DropForeignKey
ALTER TABLE "StatutoryPeriod" DROP CONSTRAINT IF EXISTS "StatutoryPeriod_companyId_fkey";

-- DropForeignKey
ALTER TABLE "StatutoryPayment" DROP CONSTRAINT IF EXISTS "StatutoryPayment_companyId_fkey";

-- DropForeignKey
ALTER TABLE "StatutoryPayment" DROP CONSTRAINT IF EXISTS "StatutoryPayment_statutoryPeriodId_fkey";

-- DropForeignKey
ALTER TABLE "StatutoryPayment" DROP CONSTRAINT IF EXISTS "StatutoryPayment_capturedById_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeStatutoryContribution" DROP CONSTRAINT IF EXISTS "EmployeeStatutoryContribution_companyId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeStatutoryContribution" DROP CONSTRAINT IF EXISTS "EmployeeStatutoryContribution_statutoryPeriodId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeStatutoryContribution" DROP CONSTRAINT IF EXISTS "EmployeeStatutoryContribution_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeStatutoryContribution" DROP CONSTRAINT IF EXISTS "EmployeeStatutoryContribution_rateConfigId_fkey";

-- DropForeignKey
ALTER TABLE "StatutoryRateConfig" DROP CONSTRAINT IF EXISTS "StatutoryRateConfig_companyId_fkey";

-- DropForeignKey
ALTER TABLE "StatutoryRateConfig" DROP CONSTRAINT IF EXISTS "StatutoryRateConfig_verifiedById_fkey";

-- DropForeignKey
ALTER TABLE "CashCommitment" DROP CONSTRAINT IF EXISTS "CashCommitment_companyId_fkey";

-- DropForeignKey
ALTER TABLE "CashPositionSnapshot" DROP CONSTRAINT IF EXISTS "CashPositionSnapshot_companyId_fkey";

-- DropForeignKey
ALTER TABLE "CashPositionSnapshot" DROP CONSTRAINT IF EXISTS "CashPositionSnapshot_capturedById_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Employee_gradeId_idx";

-- AlterTable
ALTER TABLE "Company" DROP COLUMN IF EXISTS "monthlyPayrollTotals",
DROP COLUMN IF EXISTS "sdlLiableFrom";

-- AlterTable
ALTER TABLE "Employee" DROP COLUMN IF EXISTS "gradeId",
DROP COLUMN IF EXISTS "hourlyRate",
DROP COLUMN IF EXISTS "monthlySalary",
DROP COLUMN IF EXISTS "overtimeRate",
DROP COLUMN IF EXISTS "payFrequency",
DROP COLUMN IF EXISTS "taxDirectiveNumber",
DROP COLUMN IF EXISTS "taxDirectiveRate",
ADD COLUMN IF NOT EXISTS "externalPayrollCode" TEXT;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "costCenterCode" TEXT;

-- AlterTable
ALTER TABLE "LeaveRequest" DROP COLUMN IF EXISTS "payrollRunId",
ADD COLUMN IF NOT EXISTS "payrollExportBatchId" TEXT;

-- AlterTable
ALTER TABLE "ManagedDocument" DROP COLUMN IF EXISTS "taskId";

-- AlterTable
ALTER TABLE "Incident" DROP COLUMN IF EXISTS "followUpTaskId";

-- AlterTable
ALTER TABLE "ComplianceRemediationPlan" ALTER COLUMN "scheme" TYPE TEXT USING ("scheme"::text);

-- DropTable
DROP TABLE IF EXISTS "PayrollRun" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "PayrollItem" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "PayRule" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "PayGrade" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "PayArea" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "PayGradeDefinition" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "PayAreaGradeRate" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "SitePayProfile" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "EmployeePayrollHomeSite" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "GroupPayRule" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "GroupEarningsRule" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "GroupDeductionRule" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "EarningsRule" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "DeductionRule" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "EmployeeDeduction" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "Timesheet" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "Payslip" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "TaskProject" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "Task" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "TaskComment" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "TaskAttachment" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "TaskReminder" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyBranch" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "Student" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "StudentDocument" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "Course" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "CourseRun" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "FeePlan" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "Enrolment" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyInvoice" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyInvoiceLine" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyPayment" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyReceipt" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyProfile" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyInstructor" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyInstructorDocument" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyClassroom" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyAttendanceSession" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyAttendanceRecord" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyAssessment" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyCertificate" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyComplianceDocument" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyPolicyDocument" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "AcademyRenewalAlert" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "PayrollPeriodReadiness" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "StatutoryPeriod" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "StatutoryPayment" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "EmployeeStatutoryContribution" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "StatutoryRateConfig" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "CashCommitment" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "CashPositionSnapshot" CASCADE;

-- DropEnum
DROP TYPE IF EXISTS "PayrollStatus";

-- DropEnum
DROP TYPE IF EXISTS "TaskStatus";

-- DropEnum
DROP TYPE IF EXISTS "TaskPriority";

-- DropEnum
DROP TYPE IF EXISTS "AcademyStudentStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyPsiraPreRegistrationStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyStudentDocumentType";

-- DropEnum
DROP TYPE IF EXISTS "AcademyAdminFeeStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyCourseRunStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyEnrolmentFinancialStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyEnrolmentAttendanceStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyEnrolmentCompletionStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyReportingReadinessStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyPsiraSubmissionStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyInvoiceStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyPaymentVerificationStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyAccreditationStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyInstructorStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyClassroomStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyAttendanceMethod";

-- DropEnum
DROP TYPE IF EXISTS "AcademySessionAttendanceStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyAssessmentResult";

-- DropEnum
DROP TYPE IF EXISTS "AcademyCertificateStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyComplianceDocumentStatus";

-- DropEnum
DROP TYPE IF EXISTS "AcademyRenewalSeverity";

-- DropEnum
DROP TYPE IF EXISTS "PayrollReadinessStatus";

-- DropEnum
DROP TYPE IF EXISTS "StatutoryScheme";

-- DropEnum
DROP TYPE IF EXISTS "StatutoryPeriodStatus";

-- DropEnum
DROP TYPE IF EXISTS "StatutoryPaymentStatus";

-- DropEnum
DROP TYPE IF EXISTS "CashCommitmentCategory";

-- DropEnum
DROP TYPE IF EXISTS "CashCommitmentFrequency";

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollExportProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "PayrollExportProvider" NOT NULL DEFAULT 'SAGE_BUSINESS_CLOUD_ZA',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "splitBySite" BOOLEAN NOT NULL DEFAULT true,
    "delimiter" TEXT NOT NULL DEFAULT ',',
    "dateFormat" TEXT NOT NULL DEFAULT 'yyyy-MM-dd',
    "codeMappingJson" JSONB NOT NULL DEFAULT '{}',
    "customColumnsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollExportProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollExportBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "PayrollExportBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "totalBasicHours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalOvertimeHours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalSundayHours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalPublicHolidayHours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalNightShiftHours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalPaidLeaveHours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalUnpaidLeaveHours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "readinessSnapshotJson" JSONB,
    "overrideReason" TEXT,
    "checksumSha256" TEXT,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "exportedBy" TEXT,
    "exportedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollExportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollExportLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "externalPayrollCode" TEXT NOT NULL,
    "employeeFullName" TEXT NOT NULL,
    "siteId" TEXT,
    "costCenterCode" TEXT,
    "basicHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sundayHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "publicHolidayHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "nightShiftHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "annualLeaveHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sickLeaveHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "familyLeaveHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "studyLeaveHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "unpaidLeaveHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "workedShiftsCount" INTEGER NOT NULL DEFAULT 0,
    "sourceSummaryJson" JSONB,

    CONSTRAINT "PayrollExportLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollExportProfile_companyId_idx" ON "PayrollExportProfile"("companyId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollExportProfile_companyId_isDefault_idx" ON "PayrollExportProfile"("companyId", "isDefault");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollExportBatch_companyId_periodKey_idx" ON "PayrollExportBatch"("companyId", "periodKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollExportBatch_companyId_status_idx" ON "PayrollExportBatch"("companyId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollExportLine_batchId_idx" ON "PayrollExportLine"("batchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollExportLine_companyId_employeeId_idx" ON "PayrollExportLine"("companyId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_companyId_externalPayrollCode_key" ON "Employee"("companyId", "externalPayrollCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeaveRequest_payrollExportBatchId_idx" ON "LeaveRequest"("payrollExportBatchId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaveRequest_payrollExportBatchId_fkey') THEN
    ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_payrollExportBatchId_fkey" FOREIGN KEY ("payrollExportBatchId") REFERENCES "PayrollExportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollExportProfile_companyId_fkey') THEN
    ALTER TABLE "PayrollExportProfile" ADD CONSTRAINT "PayrollExportProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollExportBatch_companyId_fkey') THEN
    ALTER TABLE "PayrollExportBatch" ADD CONSTRAINT "PayrollExportBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollExportBatch_profileId_fkey') THEN
    ALTER TABLE "PayrollExportBatch" ADD CONSTRAINT "PayrollExportBatch_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "PayrollExportProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollExportLine_batchId_fkey') THEN
    ALTER TABLE "PayrollExportLine" ADD CONSTRAINT "PayrollExportLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PayrollExportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollExportLine_employeeId_fkey') THEN
    ALTER TABLE "PayrollExportLine" ADD CONSTRAINT "PayrollExportLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollExportLine_siteId_fkey') THEN
    ALTER TABLE "PayrollExportLine" ADD CONSTRAINT "PayrollExportLine_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Defensive cleanup of unused local-drift payroll columns
ALTER TABLE "EmployeeGroup" DROP COLUMN IF EXISTS "payPeriod", DROP COLUMN IF EXISTS "payrollCalendarId";
ALTER TABLE "Site" DROP COLUMN IF EXISTS "payrollCalendarId";

-- Remap existing User.capabilities JSONB (/payroll/billing -> /billing, prune removed module keys)
UPDATE "User"
SET "capabilities" = (
  (
    CASE
      WHEN jsonb_typeof("capabilities") = 'object' AND ("capabilities" ? '/payroll/billing') AND NOT ("capabilities" ? '/billing')
        THEN jsonb_set("capabilities", '{/billing}', "capabilities" -> '/payroll/billing', true)
      ELSE COALESCE("capabilities", '{}'::jsonb)
    END
  )
  - '/payroll'
  - '/payroll/billing'
  - '/academy'
  - '/tasks'
  - '/client-portal'
  - '/compliance/statutory'
  - '/compliance/funds'
  - '/compliance/cash-control'
)
WHERE jsonb_typeof("capabilities") = 'object';
