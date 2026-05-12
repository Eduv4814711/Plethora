-- Academy Management Phase 1

CREATE TYPE "AcademyStudentStatus" AS ENUM ('prospect', 'registered', 'active', 'completed', 'inactive', 'blocked');

CREATE TYPE "AcademyPsiraPreRegistrationStatus" AS ENUM ('unknown', 'not_required', 'pending', 'completed');

CREATE TYPE "AcademyStudentDocumentType" AS ENUM (
  'id_copy',
  'proof_of_address',
  'passport_permit',
  'qualification',
  'application_form',
  'payment_proof',
  'consent',
  'psira_other',
  'other'
);

CREATE TYPE "AcademyCourseRunStatus" AS ENUM ('planned', 'open', 'in_progress', 'completed', 'reported', 'closed');

CREATE TYPE "AcademyEnrolmentFinancialStatus" AS ENUM ('unpaid', 'partial', 'paid');

CREATE TYPE "AcademyEnrolmentAttendanceStatus" AS ENUM ('pending', 'in_progress', 'compliant', 'non_compliant');

CREATE TYPE "AcademyEnrolmentCompletionStatus" AS ENUM ('pending', 'in_progress', 'completed', 'failed');

CREATE TYPE "AcademyReportingReadinessStatus" AS ENUM ('not_started', 'incomplete', 'ready', 'blocked');

CREATE TYPE "AcademyPsiraSubmissionStatus" AS ENUM (
  'not_applicable',
  'not_started',
  'pending',
  'submitted',
  'approved',
  'rejected'
);

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
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

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

CREATE TABLE "Course" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "psiraCategory" TEXT,
  "durationDays" INTEGER,
  "deliveryMode" TEXT,
  "feeAmount" DECIMAL(12, 2),
  "minimumAttendancePercent" INTEGER,
  "requiresAssessment" BOOLEAN NOT NULL DEFAULT false,
  "requiresDocuments" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

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

CREATE TABLE "FeePlan" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FeePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Enrolment" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "courseRunId" TEXT NOT NULL,
  "enrolmentDate" DATE NOT NULL DEFAULT CURRENT_DATE,
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

CREATE INDEX "AcademyBranch_companyId_idx" ON "AcademyBranch" ("companyId");

CREATE UNIQUE INDEX "Student_companyId_studentNumber_key" ON "Student" ("companyId", "studentNumber");
CREATE INDEX "Student_companyId_idx" ON "Student" ("companyId");
CREATE INDEX "Student_employeeId_idx" ON "Student" ("employeeId");
CREATE INDEX "Student_status_idx" ON "Student" ("status");

CREATE INDEX "StudentDocument_companyId_idx" ON "StudentDocument" ("companyId");
CREATE INDEX "StudentDocument_studentId_idx" ON "StudentDocument" ("studentId");
CREATE INDEX "StudentDocument_uploadedByUserId_idx" ON "StudentDocument" ("uploadedByUserId");
CREATE INDEX "StudentDocument_deletedAt_idx" ON "StudentDocument" ("deletedAt");

CREATE UNIQUE INDEX "Course_companyId_code_key" ON "Course" ("companyId", "code");
CREATE INDEX "Course_companyId_idx" ON "Course" ("companyId");
CREATE INDEX "Course_active_idx" ON "Course" ("active");

CREATE UNIQUE INDEX "CourseRun_companyId_runCode_key" ON "CourseRun" ("companyId", "runCode");
CREATE INDEX "CourseRun_companyId_idx" ON "CourseRun" ("companyId");
CREATE INDEX "CourseRun_courseId_idx" ON "CourseRun" ("courseId");
CREATE INDEX "CourseRun_academyBranchId_idx" ON "CourseRun" ("academyBranchId");
CREATE INDEX "CourseRun_instructorEmployeeId_idx" ON "CourseRun" ("instructorEmployeeId");
CREATE INDEX "CourseRun_status_idx" ON "CourseRun" ("status");

CREATE INDEX "FeePlan_companyId_idx" ON "FeePlan" ("companyId");

CREATE UNIQUE INDEX "Enrolment_studentId_courseRunId_key" ON "Enrolment" ("studentId", "courseRunId");
CREATE INDEX "Enrolment_companyId_idx" ON "Enrolment" ("companyId");
CREATE INDEX "Enrolment_courseRunId_idx" ON "Enrolment" ("courseRunId");
CREATE INDEX "Enrolment_studentId_idx" ON "Enrolment" ("studentId");

ALTER TABLE "AcademyBranch"
  ADD CONSTRAINT "AcademyBranch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Student"
  ADD CONSTRAINT "Student_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Student_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudentDocument"
  ADD CONSTRAINT "StudentDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "StudentDocument_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "StudentDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Course"
  ADD CONSTRAINT "Course_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseRun"
  ADD CONSTRAINT "CourseRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CourseRun_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CourseRun_academyBranchId_fkey" FOREIGN KEY ("academyBranchId") REFERENCES "AcademyBranch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CourseRun_instructorEmployeeId_fkey" FOREIGN KEY ("instructorEmployeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FeePlan"
  ADD CONSTRAINT "FeePlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Enrolment"
  ADD CONSTRAINT "Enrolment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Enrolment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Enrolment_courseRunId_fkey" FOREIGN KEY ("courseRunId") REFERENCES "CourseRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Enrolment_feePlanId_fkey" FOREIGN KEY ("feePlanId") REFERENCES "FeePlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
