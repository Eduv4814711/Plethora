-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'operations_manager', 'hr_payroll', 'supervisor', 'controller');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('applicant', 'hired', 'training', 'active', 'reliever', 'suspended', 'offboarded');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('created', 'assigned', 'active', 'completed', 'verified');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('draft', 'calculated', 'approved', 'paid');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'done');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "AcademyStudentStatus" AS ENUM ('prospect', 'registered', 'active', 'completed', 'inactive', 'blocked');

-- CreateEnum
CREATE TYPE "AcademyPsiraPreRegistrationStatus" AS ENUM ('unknown', 'not_required', 'pending', 'completed');

-- CreateEnum
CREATE TYPE "AcademyStudentDocumentType" AS ENUM ('id_copy', 'proof_of_address', 'passport_permit', 'qualification', 'application_form', 'payment_proof', 'consent', 'psira_other', 'other');

-- CreateEnum
CREATE TYPE "AcademyAdminFeeStatus" AS ENUM ('unpaid', 'paid', 'waived');

-- CreateEnum
CREATE TYPE "AcademyCourseRunStatus" AS ENUM ('planned', 'open', 'in_progress', 'completed', 'reported', 'closed');

-- CreateEnum
CREATE TYPE "AcademyEnrolmentFinancialStatus" AS ENUM ('unpaid', 'partial', 'paid');

-- CreateEnum
CREATE TYPE "AcademyEnrolmentAttendanceStatus" AS ENUM ('pending', 'in_progress', 'compliant', 'non_compliant');

-- CreateEnum
CREATE TYPE "AcademyEnrolmentCompletionStatus" AS ENUM ('pending', 'in_progress', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AcademyReportingReadinessStatus" AS ENUM ('not_started', 'incomplete', 'ready', 'blocked');

-- CreateEnum
CREATE TYPE "AcademyPsiraSubmissionStatus" AS ENUM ('not_applicable', 'not_started', 'pending', 'submitted', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "AcademyInvoiceStatus" AS ENUM ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled');

-- CreateEnum
CREATE TYPE "AcademyPaymentVerificationStatus" AS ENUM ('pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "AcademyAccreditationStatus" AS ENUM ('active', 'pending', 'suspended', 'expired');

-- CreateEnum
CREATE TYPE "AcademyInstructorStatus" AS ENUM ('active', 'inactive', 'suspended', 'contract_ended');

-- CreateEnum
CREATE TYPE "AcademyClassroomStatus" AS ENUM ('available', 'in_use', 'maintenance', 'closed');

-- CreateEnum
CREATE TYPE "AcademyAttendanceMethod" AS ENUM ('manual', 'qr_code', 'otp', 'biometric');

-- CreateEnum
CREATE TYPE "AcademySessionAttendanceStatus" AS ENUM ('present', 'absent', 'late', 'excused');

-- CreateEnum
CREATE TYPE "AcademyAssessmentResult" AS ENUM ('pass', 'fail', 'competent', 'not_yet_competent');

-- CreateEnum
CREATE TYPE "AcademyCertificateStatus" AS ENUM ('active', 'reprinted', 'revoked', 'void');

-- CreateEnum
CREATE TYPE "AcademyComplianceDocumentStatus" AS ENUM ('active', 'expired', 'pending_review', 'missing');

-- CreateEnum
CREATE TYPE "AcademyRenewalSeverity" AS ENUM ('green', 'amber', 'red');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "legalName" TEXT,
    "registrationNumber" TEXT,
    "taxNumber" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "website" TEXT,
    "fax" TEXT,
    "psiraRegistration" TEXT,
    "uifReference" TEXT,
    "payeReference" TEXT,
    "sdlReference" TEXT,
    "sdlLiableFrom" TIMESTAMP(3),
    "monthlyPayrollTotals" JSONB,
    "settings" JSONB,
    "theme" JSONB,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordSetupRequired" BOOLEAN NOT NULL DEFAULT false,
    "passwordSetupTokenHash" TEXT,
    "passwordSetupTokenExpiresAt" TIMESTAMP(3),
    "passwordSetupTokenConsumedAt" TIMESTAMP(3),
    "role" "UserRole" NOT NULL,
    "roleLabel" TEXT,
    "moduleAccess" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "idNumber" TEXT,
    "phone" TEXT,
    "status" "EmployeeStatus" NOT NULL,
    "hourlyRate" DECIMAL(10,2),
    "monthlySalary" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "employeeType" TEXT NOT NULL DEFAULT 'security',
    "jobRole" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "maritalStatus" TEXT,
    "email" TEXT,
    "physicalAddress" TEXT,
    "postalAddress" TEXT,
    "postalCode" TEXT,
    "taxNumber" TEXT,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankBranchCode" TEXT,
    "commencementDate" TIMESTAMP(3),
    "occupation" TEXT,
    "placeOfWork" TEXT,
    "ordinaryHours" TEXT,
    "ordinaryDays" TEXT,
    "overtimeRate" DECIMAL(10,2),
    "payFrequency" TEXT,
    "leaveEntitlement" TEXT,
    "noticePeriod" TEXT,
    "previousService" TEXT,
    "psiraNumber" TEXT,
    "psiraExpiryDate" TIMESTAMP(3),
    "securityServiceType" TEXT,
    "nextOfKin1Name" TEXT,
    "nextOfKin1Phone" TEXT,
    "nextOfKin2Name" TEXT,
    "nextOfKin2Phone" TEXT,
    "nextOfKin3Name" TEXT,
    "nextOfKin3Phone" TEXT,
    "residedOutsideSA" BOOLEAN,
    "militaryPoliceService" BOOLEAN,
    "criminalInvestigation" BOOLEAN,
    "mentallyUnstable" BOOLEAN,
    "trainingCompleted" BOOLEAN,
    "gradeId" TEXT,
    "groupId" TEXT,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "physicalAddress" TEXT,
    "contactPersonName" TEXT,
    "contactPersonPhone" TEXT,
    "contractOrServiceAgreement" TEXT,
    "serviceType" TEXT,
    "monthlyRevenue" DECIMAL(12,2),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "geofenceRadiusMeters" INTEGER,
    "rosterSiteRules" TEXT,
    "rosterDayShiftGender" TEXT,
    "rosterNightShiftGender" TEXT,
    "rosterDayShiftGuardsRequired" INTEGER NOT NULL DEFAULT 1,
    "rosterNightShiftGuardsRequired" INTEGER NOT NULL DEFAULT 1,
    "rosterSheetNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteAssignment" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shiftType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostAssignment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "ShiftStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "clockIn" TIMESTAMP(3),
    "clockOut" TIMESTAMP(3),
    "clockInLat" DECIMAL(10,7),
    "clockInLng" DECIMAL(10,7),
    "clockOutLat" DECIMAL(10,7),
    "clockOutLng" DECIMAL(10,7),
    "hoursWorked" DECIMAL(10,2),
    "overtimeHours" DECIMAL(10,2),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL DEFAULT 'clock_in',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "PayrollStatus" NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollItem" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "hoursWorked" DECIMAL(10,2) NOT NULL,
    "overtimeHours" DECIMAL(10,2) NOT NULL,
    "basePay" DECIMAL(12,2) NOT NULL,
    "overtimePay" DECIMAL(12,2) NOT NULL,
    "sundayPay" DECIMAL(12,2),
    "publicHolidayPay" DECIMAL(12,2),
    "grossPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(12,2) NOT NULL,
    "netPay" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "multiplier" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayGrade" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "groupId" TEXT,
    "name" TEXT NOT NULL,
    "hourlyRate" DECIMAL(10,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeGroup" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupPayRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "multiplier" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupPayRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupEarningsRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "rate" DECIMAL(5,2),
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupEarningsRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupDeductionRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "rate" DECIMAL(5,2),
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "employeeIds" JSONB,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupDeductionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarningsRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "rate" DECIMAL(5,2),
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EarningsRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeductionRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "rate" DECIMAL(5,2),
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "employeeIds" JSONB,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeductionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDeduction" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deductionRuleId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "rate" DECIMAL(5,2),
    "appliesFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliesTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicHoliday" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payrollRunId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "basicHours" DECIMAL(10,2) NOT NULL,
    "overtimeHours" DECIMAL(10,2) NOT NULL,
    "sundayHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "publicHolidayHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "leaveDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRecord" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "payrollItemId" TEXT NOT NULL,
    "earnings" JSONB NOT NULL,
    "deductions" JSONB NOT NULL,
    "grossPay" DECIMAL(12,2) NOT NULL,
    "totalDeductions" DECIMAL(12,2) NOT NULL,
    "netPay" DECIMAL(12,2) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tax" DECIMAL(12,2),
    "taxableEarnings" DECIMAL(12,2),
    "uifEmployee" DECIMAL(12,2),
    "uifEmployer" DECIMAL(12,2),
    "sdl" DECIMAL(12,2),

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "companyId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskProject" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "priority" "TaskPriority" NOT NULL DEFAULT 'medium',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assigneeType" TEXT,
    "assigneeId" TEXT,
    "recurrenceRule" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskReminder" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "whatsappMessageId" TEXT,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "text" TEXT,
    "status" TEXT,
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppClockPending" (
    "id" TEXT NOT NULL,
    "waFrom" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppClockPending_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyBranch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "studentNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "preferredName" TEXT,
    "idType" TEXT,
    "idNumber" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "nationality" TEXT,
    "phone" TEXT,
    "alternatePhone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "nextOfKinName" TEXT,
    "nextOfKinPhone" TEXT,
    "psiraProfileReference" TEXT,
    "psiraPreRegistrationStatus" "AcademyPsiraPreRegistrationStatus" NOT NULL DEFAULT 'unknown',
    "status" "AcademyStudentStatus" NOT NULL DEFAULT 'prospect',
    "employeeId" TEXT,
    "adminFeeStatus" "AcademyAdminFeeStatus" NOT NULL DEFAULT 'unpaid',
    "adminFeePaidAt" TIMESTAMP(3),
    "adminFeeAmount" DECIMAL(12,2),
    "adminFeeMethod" TEXT,
    "adminFeeReference" TEXT,
    "adminFeeNotes" TEXT,
    "adminFeeRecordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "documentType" "AcademyStudentDocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "psiraCategory" TEXT,
    "durationDays" INTEGER,
    "deliveryMode" TEXT,
    "feeAmount" DECIMAL(12,2),
    "minimumAttendancePercent" INTEGER,
    "requiresAssessment" BOOLEAN NOT NULL DEFAULT false,
    "requiresDocuments" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "runCode" TEXT NOT NULL,
    "intakeName" TEXT,
    "academyBranchId" TEXT NOT NULL,
    "venueText" TEXT,
    "instructorEmployeeId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "enrolledCount" INTEGER NOT NULL DEFAULT 0,
    "status" "AcademyCourseRunStatus" NOT NULL DEFAULT 'planned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrolment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseRunId" TEXT NOT NULL,
    "enrolmentDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feePlanId" TEXT,
    "financialStatus" "AcademyEnrolmentFinancialStatus" NOT NULL DEFAULT 'unpaid',
    "attendanceStatus" "AcademyEnrolmentAttendanceStatus" NOT NULL DEFAULT 'pending',
    "completionStatus" "AcademyEnrolmentCompletionStatus" NOT NULL DEFAULT 'pending',
    "reportingReadinessStatus" "AcademyReportingReadinessStatus" NOT NULL DEFAULT 'not_started',
    "psiraSubmissionStatus" "AcademyPsiraSubmissionStatus" NOT NULL DEFAULT 'not_applicable',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "enrolmentId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "AcademyInvoiceStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmount" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "AcademyInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "paymentDate" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" TEXT,
    "referenceNumber" TEXT,
    "proofDocumentId" TEXT,
    "verificationStatus" "AcademyPaymentVerificationStatus" NOT NULL DEFAULT 'pending',
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionRemarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyReceipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "receiptDate" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "issuedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademyReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "trainingCentreName" TEXT NOT NULL,
    "tradingName" TEXT,
    "psiraTrainingProviderNumber" TEXT,
    "psiraBusinessRegistrationNumber" TEXT,
    "accreditationStatus" "AcademyAccreditationStatus" NOT NULL DEFAULT 'pending',
    "accreditationIssueDate" DATE,
    "reAccreditationDueDate" DATE,
    "province" TEXT,
    "city" TEXT,
    "physicalAddress" TEXT,
    "postalAddress" TEXT,
    "contactPerson" TEXT,
    "phoneNumber" TEXT,
    "landline" TEXT,
    "email" TEXT,
    "verificationReference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyInstructor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "idNumber" TEXT,
    "dateOfBirth" DATE,
    "gender" TEXT,
    "residentialAddress" TEXT,
    "emergencyContact" TEXT,
    "psiraInstructorNumber" TEXT,
    "qualification" TEXT,
    "instructorGrade" TEXT,
    "accreditationScope" TEXT,
    "accreditationStatus" TEXT,
    "certificateNumber" TEXT,
    "certificateIssueDate" DATE,
    "certificateExpiryDate" DATE,
    "phone" TEXT,
    "email" TEXT,
    "employmentType" TEXT,
    "contractStartDate" DATE,
    "contractEndDate" DATE,
    "contractStatus" TEXT,
    "status" "AcademyInstructorStatus" NOT NULL DEFAULT 'active',
    "assignedBranchId" TEXT,
    "assignedCourseIds" JSONB,
    "complianceStatus" TEXT,
    "archivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "certificateDocumentId" TEXT,
    "contractDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyInstructor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyInstructorDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "issueDate" DATE,
    "expiryDate" DATE,
    "verificationStatus" TEXT NOT NULL DEFAULT 'pending_review',
    "uploadedByUserId" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyInstructorDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyClassroom" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "academyBranchId" TEXT NOT NULL,
    "classroomName" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "approvedCapacity" INTEGER,
    "equipmentChecklist" TEXT,
    "status" "AcademyClassroomStatus" NOT NULL DEFAULT 'available',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyClassroom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyAttendanceSession" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "courseRunId" TEXT,
    "classroomId" TEXT,
    "instructorId" TEXT,
    "sessionDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyAttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyAttendanceRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "enrolmentId" TEXT NOT NULL,
    "checkInTime" TIMESTAMP(3),
    "checkOutTime" TIMESTAMP(3),
    "attendanceStatus" "AcademySessionAttendanceStatus" NOT NULL DEFAULT 'present',
    "method" "AcademyAttendanceMethod" NOT NULL DEFAULT 'manual',
    "markedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyAttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyAssessment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "instructorId" TEXT,
    "assessmentType" TEXT NOT NULL,
    "assessmentDate" DATE NOT NULL,
    "venue" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "mark" DECIMAL(5,2),
    "result" "AcademyAssessmentResult",
    "moderationStatus" TEXT,
    "reassessmentDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyCertificate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "enrolmentId" TEXT,
    "completionDate" DATE,
    "issueDate" DATE NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "pdfPath" TEXT,
    "issuedByUserId" TEXT,
    "status" "AcademyCertificateStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyComplianceDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "issueDate" DATE,
    "expiryDate" DATE,
    "status" "AcademyComplianceDocumentStatus" NOT NULL DEFAULT 'pending_review',
    "filePath" TEXT,
    "verifiedByUserId" TEXT,
    "verifiedDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyComplianceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyPolicyDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "policyType" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "effectiveDate" DATE,
    "nextReviewDate" DATE,
    "approvedBy" TEXT,
    "filePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyPolicyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyRenewalAlert" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "severity" "AcademyRenewalSeverity" NOT NULL DEFAULT 'green',
    "status" TEXT NOT NULL DEFAULT 'open',
    "relatedId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyRenewalAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "Employee_companyId_idx" ON "Employee"("companyId");

-- CreateIndex
CREATE INDEX "Employee_gradeId_idx" ON "Employee"("gradeId");

-- CreateIndex
CREATE INDEX "Employee_groupId_idx" ON "Employee"("groupId");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE INDEX "Employee_employeeType_idx" ON "Employee"("employeeType");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyId_employeeNumber_key" ON "Employee"("companyId", "employeeNumber");

-- CreateIndex
CREATE INDEX "Site_companyId_idx" ON "Site"("companyId");

-- CreateIndex
CREATE INDEX "SiteAssignment_siteId_idx" ON "SiteAssignment"("siteId");

-- CreateIndex
CREATE INDEX "SiteAssignment_employeeId_idx" ON "SiteAssignment"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteAssignment_siteId_employeeId_key" ON "SiteAssignment"("siteId", "employeeId");

-- CreateIndex
CREATE INDEX "Post_siteId_idx" ON "Post"("siteId");

-- CreateIndex
CREATE INDEX "PostAssignment_postId_idx" ON "PostAssignment"("postId");

-- CreateIndex
CREATE INDEX "PostAssignment_employeeId_idx" ON "PostAssignment"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PostAssignment_postId_employeeId_key" ON "PostAssignment"("postId", "employeeId");

-- CreateIndex
CREATE INDEX "Shift_companyId_idx" ON "Shift"("companyId");

-- CreateIndex
CREATE INDEX "Shift_employeeId_idx" ON "Shift"("employeeId");

-- CreateIndex
CREATE INDEX "Shift_postId_idx" ON "Shift"("postId");

-- CreateIndex
CREATE INDEX "Shift_startTime_idx" ON "Shift"("startTime");

-- CreateIndex
CREATE INDEX "Shift_status_idx" ON "Shift"("status");

-- CreateIndex
CREATE INDEX "Attendance_shiftId_idx" ON "Attendance"("shiftId");

-- CreateIndex
CREATE INDEX "PayrollRun_companyId_idx" ON "PayrollRun"("companyId");

-- CreateIndex
CREATE INDEX "PayrollRun_periodStart_idx" ON "PayrollRun"("periodStart");

-- CreateIndex
CREATE INDEX "PayrollRun_periodEnd_idx" ON "PayrollRun"("periodEnd");

-- CreateIndex
CREATE INDEX "PayrollRun_status_idx" ON "PayrollRun"("status");

-- CreateIndex
CREATE INDEX "PayrollItem_payrollRunId_idx" ON "PayrollItem"("payrollRunId");

-- CreateIndex
CREATE INDEX "PayrollItem_employeeId_idx" ON "PayrollItem"("employeeId");

-- CreateIndex
CREATE INDEX "PayRule_companyId_idx" ON "PayRule"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PayRule_companyId_ruleType_key" ON "PayRule"("companyId", "ruleType");

-- CreateIndex
CREATE INDEX "PayGrade_companyId_idx" ON "PayGrade"("companyId");

-- CreateIndex
CREATE INDEX "PayGrade_groupId_idx" ON "PayGrade"("groupId");

-- CreateIndex
CREATE INDEX "EmployeeGroup_companyId_idx" ON "EmployeeGroup"("companyId");

-- CreateIndex
CREATE INDEX "GroupPayRule_companyId_idx" ON "GroupPayRule"("companyId");

-- CreateIndex
CREATE INDEX "GroupPayRule_groupId_idx" ON "GroupPayRule"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupPayRule_groupId_ruleType_key" ON "GroupPayRule"("groupId", "ruleType");

-- CreateIndex
CREATE INDEX "GroupEarningsRule_companyId_idx" ON "GroupEarningsRule"("companyId");

-- CreateIndex
CREATE INDEX "GroupEarningsRule_groupId_idx" ON "GroupEarningsRule"("groupId");

-- CreateIndex
CREATE INDEX "GroupDeductionRule_companyId_idx" ON "GroupDeductionRule"("companyId");

-- CreateIndex
CREATE INDEX "GroupDeductionRule_groupId_idx" ON "GroupDeductionRule"("groupId");

-- CreateIndex
CREATE INDEX "EarningsRule_companyId_idx" ON "EarningsRule"("companyId");

-- CreateIndex
CREATE INDEX "DeductionRule_companyId_idx" ON "DeductionRule"("companyId");

-- CreateIndex
CREATE INDEX "EmployeeDeduction_employeeId_idx" ON "EmployeeDeduction"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeDeduction_deductionRuleId_idx" ON "EmployeeDeduction"("deductionRuleId");

-- CreateIndex
CREATE INDEX "PublicHoliday_companyId_idx" ON "PublicHoliday"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicHoliday_companyId_date_key" ON "PublicHoliday"("companyId", "date");

-- CreateIndex
CREATE INDEX "Timesheet_companyId_idx" ON "Timesheet"("companyId");

-- CreateIndex
CREATE INDEX "Timesheet_employeeId_idx" ON "Timesheet"("employeeId");

-- CreateIndex
CREATE INDEX "Timesheet_payrollRunId_idx" ON "Timesheet"("payrollRunId");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_companyId_employeeId_periodStart_key" ON "Timesheet"("companyId", "employeeId", "periodStart");

-- CreateIndex
CREATE INDEX "LeaveRecord_employeeId_date_idx" ON "LeaveRecord"("employeeId", "date");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_idx" ON "LeaveRequest"("employeeId");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_payrollItemId_key" ON "Payslip"("payrollItemId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_idx" ON "AuditLog"("companyId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "AuditLog"("entityId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "TaskProject_companyId_idx" ON "TaskProject"("companyId");

-- CreateIndex
CREATE INDEX "Task_companyId_idx" ON "Task"("companyId");

-- CreateIndex
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");

-- CreateIndex
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "TaskComment_taskId_idx" ON "TaskComment"("taskId");

-- CreateIndex
CREATE INDEX "TaskAttachment_taskId_idx" ON "TaskAttachment"("taskId");

-- CreateIndex
CREATE INDEX "TaskReminder_taskId_idx" ON "TaskReminder"("taskId");

-- CreateIndex
CREATE INDEX "TaskReminder_remindAt_idx" ON "TaskReminder"("remindAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_companyId_employeeId_createdAt_idx" ON "WhatsAppMessage"("companyId", "employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_whatsappMessageId_idx" ON "WhatsAppMessage"("whatsappMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppClockPending_waFrom_key" ON "WhatsAppClockPending"("waFrom");

-- CreateIndex
CREATE INDEX "WhatsAppClockPending_expiresAt_idx" ON "WhatsAppClockPending"("expiresAt");

-- CreateIndex
CREATE INDEX "WhatsAppClockPending_employeeId_idx" ON "WhatsAppClockPending"("employeeId");

-- CreateIndex
CREATE INDEX "AcademyBranch_companyId_idx" ON "AcademyBranch"("companyId");

-- CreateIndex
CREATE INDEX "Student_companyId_idx" ON "Student"("companyId");

-- CreateIndex
CREATE INDEX "Student_employeeId_idx" ON "Student"("employeeId");

-- CreateIndex
CREATE INDEX "Student_status_idx" ON "Student"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Student_companyId_studentNumber_key" ON "Student"("companyId", "studentNumber");

-- CreateIndex
CREATE INDEX "StudentDocument_companyId_idx" ON "StudentDocument"("companyId");

-- CreateIndex
CREATE INDEX "StudentDocument_studentId_idx" ON "StudentDocument"("studentId");

-- CreateIndex
CREATE INDEX "StudentDocument_uploadedByUserId_idx" ON "StudentDocument"("uploadedByUserId");

-- CreateIndex
CREATE INDEX "StudentDocument_deletedAt_idx" ON "StudentDocument"("deletedAt");

-- CreateIndex
CREATE INDEX "Course_companyId_idx" ON "Course"("companyId");

-- CreateIndex
CREATE INDEX "Course_active_idx" ON "Course"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Course_companyId_code_key" ON "Course"("companyId", "code");

-- CreateIndex
CREATE INDEX "CourseRun_companyId_idx" ON "CourseRun"("companyId");

-- CreateIndex
CREATE INDEX "CourseRun_courseId_idx" ON "CourseRun"("courseId");

-- CreateIndex
CREATE INDEX "CourseRun_academyBranchId_idx" ON "CourseRun"("academyBranchId");

-- CreateIndex
CREATE INDEX "CourseRun_instructorEmployeeId_idx" ON "CourseRun"("instructorEmployeeId");

-- CreateIndex
CREATE INDEX "CourseRun_status_idx" ON "CourseRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CourseRun_companyId_runCode_key" ON "CourseRun"("companyId", "runCode");

-- CreateIndex
CREATE INDEX "FeePlan_companyId_idx" ON "FeePlan"("companyId");

-- CreateIndex
CREATE INDEX "Enrolment_companyId_idx" ON "Enrolment"("companyId");

-- CreateIndex
CREATE INDEX "Enrolment_courseRunId_idx" ON "Enrolment"("courseRunId");

-- CreateIndex
CREATE INDEX "Enrolment_studentId_idx" ON "Enrolment"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrolment_studentId_courseRunId_key" ON "Enrolment"("studentId", "courseRunId");

-- CreateIndex
CREATE INDEX "AcademyInvoice_companyId_idx" ON "AcademyInvoice"("companyId");

-- CreateIndex
CREATE INDEX "AcademyInvoice_studentId_idx" ON "AcademyInvoice"("studentId");

-- CreateIndex
CREATE INDEX "AcademyInvoice_enrolmentId_idx" ON "AcademyInvoice"("enrolmentId");

-- CreateIndex
CREATE INDEX "AcademyInvoice_status_idx" ON "AcademyInvoice"("status");

-- CreateIndex
CREATE INDEX "AcademyInvoice_dueDate_idx" ON "AcademyInvoice"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "AcademyInvoice_companyId_invoiceNumber_key" ON "AcademyInvoice"("companyId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "AcademyInvoiceLine_invoiceId_idx" ON "AcademyInvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "AcademyPayment_companyId_idx" ON "AcademyPayment"("companyId");

-- CreateIndex
CREATE INDEX "AcademyPayment_invoiceId_idx" ON "AcademyPayment"("invoiceId");

-- CreateIndex
CREATE INDEX "AcademyPayment_studentId_idx" ON "AcademyPayment"("studentId");

-- CreateIndex
CREATE INDEX "AcademyPayment_verificationStatus_idx" ON "AcademyPayment"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "AcademyReceipt_paymentId_key" ON "AcademyReceipt"("paymentId");

-- CreateIndex
CREATE INDEX "AcademyReceipt_companyId_idx" ON "AcademyReceipt"("companyId");

-- CreateIndex
CREATE INDEX "AcademyReceipt_issuedByUserId_idx" ON "AcademyReceipt"("issuedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AcademyReceipt_companyId_receiptNumber_key" ON "AcademyReceipt"("companyId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AcademyProfile_companyId_key" ON "AcademyProfile"("companyId");

-- CreateIndex
CREATE INDEX "AcademyProfile_companyId_idx" ON "AcademyProfile"("companyId");

-- CreateIndex
CREATE INDEX "AcademyInstructor_companyId_idx" ON "AcademyInstructor"("companyId");

-- CreateIndex
CREATE INDEX "AcademyInstructor_status_idx" ON "AcademyInstructor"("status");

-- CreateIndex
CREATE INDEX "AcademyInstructor_assignedBranchId_idx" ON "AcademyInstructor"("assignedBranchId");

-- CreateIndex
CREATE INDEX "AcademyInstructor_archivedAt_idx" ON "AcademyInstructor"("archivedAt");

-- CreateIndex
CREATE INDEX "AcademyInstructor_complianceStatus_idx" ON "AcademyInstructor"("complianceStatus");

-- CreateIndex
CREATE INDEX "AcademyInstructor_contractEndDate_idx" ON "AcademyInstructor"("contractEndDate");

-- CreateIndex
CREATE INDEX "AcademyInstructor_certificateExpiryDate_idx" ON "AcademyInstructor"("certificateExpiryDate");

-- CreateIndex
CREATE INDEX "AcademyInstructorDocument_companyId_idx" ON "AcademyInstructorDocument"("companyId");

-- CreateIndex
CREATE INDEX "AcademyInstructorDocument_instructorId_idx" ON "AcademyInstructorDocument"("instructorId");

-- CreateIndex
CREATE INDEX "AcademyInstructorDocument_documentType_idx" ON "AcademyInstructorDocument"("documentType");

-- CreateIndex
CREATE INDEX "AcademyInstructorDocument_verificationStatus_idx" ON "AcademyInstructorDocument"("verificationStatus");

-- CreateIndex
CREATE INDEX "AcademyInstructorDocument_expiryDate_idx" ON "AcademyInstructorDocument"("expiryDate");

-- CreateIndex
CREATE INDEX "AcademyInstructorDocument_deletedAt_idx" ON "AcademyInstructorDocument"("deletedAt");

-- CreateIndex
CREATE INDEX "AcademyClassroom_companyId_idx" ON "AcademyClassroom"("companyId");

-- CreateIndex
CREATE INDEX "AcademyClassroom_academyBranchId_idx" ON "AcademyClassroom"("academyBranchId");

-- CreateIndex
CREATE INDEX "AcademyClassroom_status_idx" ON "AcademyClassroom"("status");

-- CreateIndex
CREATE INDEX "AcademyAttendanceSession_companyId_idx" ON "AcademyAttendanceSession"("companyId");

-- CreateIndex
CREATE INDEX "AcademyAttendanceSession_sessionDate_idx" ON "AcademyAttendanceSession"("sessionDate");

-- CreateIndex
CREATE INDEX "AcademyAttendanceRecord_companyId_idx" ON "AcademyAttendanceRecord"("companyId");

-- CreateIndex
CREATE INDEX "AcademyAttendanceRecord_attendanceStatus_idx" ON "AcademyAttendanceRecord"("attendanceStatus");

-- CreateIndex
CREATE UNIQUE INDEX "AcademyAttendanceRecord_sessionId_enrolmentId_key" ON "AcademyAttendanceRecord"("sessionId", "enrolmentId");

-- CreateIndex
CREATE INDEX "AcademyAssessment_companyId_idx" ON "AcademyAssessment"("companyId");

-- CreateIndex
CREATE INDEX "AcademyAssessment_assessmentDate_idx" ON "AcademyAssessment"("assessmentDate");

-- CreateIndex
CREATE UNIQUE INDEX "AcademyCertificate_verificationCode_key" ON "AcademyCertificate"("verificationCode");

-- CreateIndex
CREATE INDEX "AcademyCertificate_companyId_idx" ON "AcademyCertificate"("companyId");

-- CreateIndex
CREATE INDEX "AcademyCertificate_status_idx" ON "AcademyCertificate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AcademyCertificate_companyId_certificateNumber_key" ON "AcademyCertificate"("companyId", "certificateNumber");

-- CreateIndex
CREATE INDEX "AcademyComplianceDocument_companyId_idx" ON "AcademyComplianceDocument"("companyId");

-- CreateIndex
CREATE INDEX "AcademyComplianceDocument_status_idx" ON "AcademyComplianceDocument"("status");

-- CreateIndex
CREATE INDEX "AcademyPolicyDocument_companyId_idx" ON "AcademyPolicyDocument"("companyId");

-- CreateIndex
CREATE INDEX "AcademyPolicyDocument_policyType_idx" ON "AcademyPolicyDocument"("policyType");

-- CreateIndex
CREATE INDEX "AcademyRenewalAlert_companyId_idx" ON "AcademyRenewalAlert"("companyId");

-- CreateIndex
CREATE INDEX "AcademyRenewalAlert_dueDate_idx" ON "AcademyRenewalAlert"("dueDate");

-- CreateIndex
CREATE INDEX "AcademyRenewalAlert_severity_idx" ON "AcademyRenewalAlert"("severity");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "PayGrade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "EmployeeGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAssignment" ADD CONSTRAINT "SiteAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAssignment" ADD CONSTRAINT "SiteAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostAssignment" ADD CONSTRAINT "PostAssignment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostAssignment" ADD CONSTRAINT "PostAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRule" ADD CONSTRAINT "PayRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayGrade" ADD CONSTRAINT "PayGrade_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayGrade" ADD CONSTRAINT "PayGrade_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "EmployeeGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeGroup" ADD CONSTRAINT "EmployeeGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPayRule" ADD CONSTRAINT "GroupPayRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPayRule" ADD CONSTRAINT "GroupPayRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "EmployeeGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEarningsRule" ADD CONSTRAINT "GroupEarningsRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupEarningsRule" ADD CONSTRAINT "GroupEarningsRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "EmployeeGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupDeductionRule" ADD CONSTRAINT "GroupDeductionRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupDeductionRule" ADD CONSTRAINT "GroupDeductionRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "EmployeeGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningsRule" ADD CONSTRAINT "EarningsRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeductionRule" ADD CONSTRAINT "DeductionRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDeduction" ADD CONSTRAINT "EmployeeDeduction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDeduction" ADD CONSTRAINT "EmployeeDeduction_deductionRuleId_fkey" FOREIGN KEY ("deductionRuleId") REFERENCES "DeductionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicHoliday" ADD CONSTRAINT "PublicHoliday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payrollItemId_fkey" FOREIGN KEY ("payrollItemId") REFERENCES "PayrollItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskProject" ADD CONSTRAINT "TaskProject_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "TaskProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReminder" ADD CONSTRAINT "TaskReminder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppClockPending" ADD CONSTRAINT "WhatsAppClockPending_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppClockPending" ADD CONSTRAINT "WhatsAppClockPending_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyBranch" ADD CONSTRAINT "AcademyBranch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseRun" ADD CONSTRAINT "CourseRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseRun" ADD CONSTRAINT "CourseRun_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseRun" ADD CONSTRAINT "CourseRun_academyBranchId_fkey" FOREIGN KEY ("academyBranchId") REFERENCES "AcademyBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseRun" ADD CONSTRAINT "CourseRun_instructorEmployeeId_fkey" FOREIGN KEY ("instructorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_courseRunId_fkey" FOREIGN KEY ("courseRunId") REFERENCES "CourseRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_feePlanId_fkey" FOREIGN KEY ("feePlanId") REFERENCES "FeePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyInvoice" ADD CONSTRAINT "AcademyInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyInvoice" ADD CONSTRAINT "AcademyInvoice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyInvoice" ADD CONSTRAINT "AcademyInvoice_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "Enrolment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyInvoiceLine" ADD CONSTRAINT "AcademyInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "AcademyInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyPayment" ADD CONSTRAINT "AcademyPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyPayment" ADD CONSTRAINT "AcademyPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "AcademyInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyPayment" ADD CONSTRAINT "AcademyPayment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyPayment" ADD CONSTRAINT "AcademyPayment_proofDocumentId_fkey" FOREIGN KEY ("proofDocumentId") REFERENCES "StudentDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyPayment" ADD CONSTRAINT "AcademyPayment_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyReceipt" ADD CONSTRAINT "AcademyReceipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyReceipt" ADD CONSTRAINT "AcademyReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "AcademyPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyReceipt" ADD CONSTRAINT "AcademyReceipt_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyProfile" ADD CONSTRAINT "AcademyProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyInstructor" ADD CONSTRAINT "AcademyInstructor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyInstructor" ADD CONSTRAINT "AcademyInstructor_assignedBranchId_fkey" FOREIGN KEY ("assignedBranchId") REFERENCES "AcademyBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyInstructorDocument" ADD CONSTRAINT "AcademyInstructorDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyInstructorDocument" ADD CONSTRAINT "AcademyInstructorDocument_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "AcademyInstructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyInstructorDocument" ADD CONSTRAINT "AcademyInstructorDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyInstructorDocument" ADD CONSTRAINT "AcademyInstructorDocument_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyClassroom" ADD CONSTRAINT "AcademyClassroom_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyClassroom" ADD CONSTRAINT "AcademyClassroom_academyBranchId_fkey" FOREIGN KEY ("academyBranchId") REFERENCES "AcademyBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyAttendanceSession" ADD CONSTRAINT "AcademyAttendanceSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyAttendanceSession" ADD CONSTRAINT "AcademyAttendanceSession_courseRunId_fkey" FOREIGN KEY ("courseRunId") REFERENCES "CourseRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyAttendanceSession" ADD CONSTRAINT "AcademyAttendanceSession_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "AcademyClassroom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyAttendanceSession" ADD CONSTRAINT "AcademyAttendanceSession_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "AcademyInstructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyAttendanceRecord" ADD CONSTRAINT "AcademyAttendanceRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyAttendanceRecord" ADD CONSTRAINT "AcademyAttendanceRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AcademyAttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyAttendanceRecord" ADD CONSTRAINT "AcademyAttendanceRecord_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "Enrolment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyAttendanceRecord" ADD CONSTRAINT "AcademyAttendanceRecord_markedByUserId_fkey" FOREIGN KEY ("markedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyAssessment" ADD CONSTRAINT "AcademyAssessment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyAssessment" ADD CONSTRAINT "AcademyAssessment_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyAssessment" ADD CONSTRAINT "AcademyAssessment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyAssessment" ADD CONSTRAINT "AcademyAssessment_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "AcademyInstructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyCertificate" ADD CONSTRAINT "AcademyCertificate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyCertificate" ADD CONSTRAINT "AcademyCertificate_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyCertificate" ADD CONSTRAINT "AcademyCertificate_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyCertificate" ADD CONSTRAINT "AcademyCertificate_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "Enrolment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyCertificate" ADD CONSTRAINT "AcademyCertificate_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyComplianceDocument" ADD CONSTRAINT "AcademyComplianceDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyComplianceDocument" ADD CONSTRAINT "AcademyComplianceDocument_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyPolicyDocument" ADD CONSTRAINT "AcademyPolicyDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyRenewalAlert" ADD CONSTRAINT "AcademyRenewalAlert_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
