-- Academy student admin fee (intake gate before enrolment)

CREATE TYPE "AcademyAdminFeeStatus" AS ENUM ('unpaid', 'paid', 'waived');

ALTER TABLE "Student" ADD COLUMN "adminFeeStatus" "AcademyAdminFeeStatus" NOT NULL DEFAULT 'unpaid';
ALTER TABLE "Student" ADD COLUMN "adminFeePaidAt" TIMESTAMP(3);
ALTER TABLE "Student" ADD COLUMN "adminFeeAmount" DECIMAL(12, 2);
ALTER TABLE "Student" ADD COLUMN "adminFeeMethod" TEXT;
ALTER TABLE "Student" ADD COLUMN "adminFeeReference" TEXT;
ALTER TABLE "Student" ADD COLUMN "adminFeeNotes" TEXT;
ALTER TABLE "Student" ADD COLUMN "adminFeeRecordedByUserId" TEXT;
