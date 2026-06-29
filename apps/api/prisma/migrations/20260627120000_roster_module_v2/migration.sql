-- Roster module v2: replace Post/PostAssignment with SitePost + GuardSiteEligibility +
-- CoverageRequirement, move Shift onto siteId, and extend Site / SiteAssignment config.

-- CreateEnum
CREATE TYPE "SiteGuardAssignmentType" AS ENUM ('PERMANENT', 'RELIEVER', 'TEMPORARY');

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_siteId_fkey";

-- DropForeignKey
ALTER TABLE "PostAssignment" DROP CONSTRAINT "PostAssignment_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "PostAssignment" DROP CONSTRAINT "PostAssignment_postId_fkey";

-- DropForeignKey
ALTER TABLE "Shift" DROP CONSTRAINT "Shift_postId_fkey";

-- DropIndex
DROP INDEX "Shift_companyId_postId_startTime_idx";

-- DropIndex
DROP INDEX "Shift_postId_idx";

-- AlterTable
ALTER TABLE "Shift" DROP COLUMN "postId",
ADD COLUMN     "legacyPostName" TEXT,
ADD COLUMN     "shiftType" TEXT,
ADD COLUMN     "siteId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "dayShiftEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nightShiftEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rosterDayShiftCustomFemales" INTEGER,
ADD COLUMN     "rosterDayShiftCustomMales" INTEGER,
ADD COLUMN     "rosterDayShiftGenderMode" TEXT,
ADD COLUMN     "rosterNightShiftCustomFemales" INTEGER,
ADD COLUMN     "rosterNightShiftCustomMales" INTEGER,
ADD COLUMN     "rosterNightShiftGenderMode" TEXT;

-- AlterTable
ALTER TABLE "SiteAssignment" ADD COLUMN     "assignmentType" "SiteGuardAssignmentType" NOT NULL DEFAULT 'PERMANENT',
ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "Post";

-- DropTable
DROP TABLE "PostAssignment";

-- CreateTable
CREATE TABLE "SitePost" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SitePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardSiteEligibility" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "sitePostId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardSiteEligibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageRequirement" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "sitePostId" TEXT NOT NULL,
    "shiftTypeCode" TEXT NOT NULL,
    "guardsRequired" INTEGER NOT NULL DEFAULT 1,
    "genderRule" TEXT NOT NULL DEFAULT 'any',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverageRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SitePost_siteId_idx" ON "SitePost"("siteId");

-- CreateIndex
CREATE INDEX "GuardSiteEligibility_siteId_idx" ON "GuardSiteEligibility"("siteId");

-- CreateIndex
CREATE INDEX "GuardSiteEligibility_sitePostId_idx" ON "GuardSiteEligibility"("sitePostId");

-- CreateIndex
CREATE INDEX "GuardSiteEligibility_employeeId_idx" ON "GuardSiteEligibility"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "GuardSiteEligibility_siteId_employeeId_sitePostId_key" ON "GuardSiteEligibility"("siteId", "employeeId", "sitePostId");

-- CreateIndex
CREATE INDEX "CoverageRequirement_siteId_idx" ON "CoverageRequirement"("siteId");

-- CreateIndex
CREATE INDEX "CoverageRequirement_sitePostId_idx" ON "CoverageRequirement"("sitePostId");

-- CreateIndex
CREATE INDEX "Shift_companyId_siteId_startTime_idx" ON "Shift"("companyId", "siteId", "startTime");

-- CreateIndex
CREATE INDEX "Shift_siteId_idx" ON "Shift"("siteId");

-- AddForeignKey
ALTER TABLE "SitePost" ADD CONSTRAINT "SitePost_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardSiteEligibility" ADD CONSTRAINT "GuardSiteEligibility_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardSiteEligibility" ADD CONSTRAINT "GuardSiteEligibility_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardSiteEligibility" ADD CONSTRAINT "GuardSiteEligibility_sitePostId_fkey" FOREIGN KEY ("sitePostId") REFERENCES "SitePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageRequirement" ADD CONSTRAINT "CoverageRequirement_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageRequirement" ADD CONSTRAINT "CoverageRequirement_sitePostId_fkey" FOREIGN KEY ("sitePostId") REFERENCES "SitePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
