-- Roster module v2: replace Post/PostAssignment with SitePost + GuardSiteEligibility +
-- CoverageRequirement, move Shift onto siteId, and extend Site / SiteAssignment config.
--
-- Production-safe: migrate Post data first, backfill Shift.siteId from Post.postId,
-- then enforce NOT NULL and drop legacy tables.

-- CreateEnum
CREATE TYPE "SiteGuardAssignmentType" AS ENUM ('PERMANENT', 'RELIEVER', 'TEMPORARY');

-- AlterTable (no dependency on Post removal)
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

-- CreateTable (before dropping Post)
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

-- Migrate Post -> SitePost (preserve ids for FK continuity)
INSERT INTO "SitePost" ("id", "siteId", "name", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT
    p."id",
    p."siteId",
    p."name",
    0,
    true,
    p."createdAt",
    p."updatedAt"
FROM "Post" p;

-- Migrate PostAssignment -> GuardSiteEligibility
INSERT INTO "GuardSiteEligibility" ("id", "siteId", "employeeId", "sitePostId", "isPrimary", "createdAt")
SELECT
    pa."id",
    p."siteId",
    pa."employeeId",
    pa."postId",
    false,
    pa."assignedAt"
FROM "PostAssignment" pa
INNER JOIN "Post" p ON p."id" = pa."postId";

-- Migrate post shift types -> CoverageRequirement
INSERT INTO "CoverageRequirement" (
    "id",
    "siteId",
    "sitePostId",
    "shiftTypeCode",
    "guardsRequired",
    "genderRule",
    "isEnabled",
    "createdAt",
    "updatedAt"
)
SELECT
    CONCAT('cov_', p."id"),
    p."siteId",
    p."id",
    CASE
        WHEN LOWER(COALESCE(p."shiftType", '')) = 'night' THEN 'night'
        ELSE 'day'
    END,
    1,
    'any',
    true,
    p."createdAt",
    p."updatedAt"
FROM "Post" p;

-- Add nullable Shift columns before backfill
ALTER TABLE "Shift"
ADD COLUMN "legacyPostName" TEXT,
ADD COLUMN "shiftType" TEXT,
ADD COLUMN "siteId" TEXT;

-- Backfill Shift.siteId and metadata from Post
UPDATE "Shift" s
SET
    "siteId" = p."siteId",
    "shiftType" = CASE
        WHEN LOWER(COALESCE(p."shiftType", '')) = 'night' THEN 'night'
        ELSE 'day'
    END,
    "legacyPostName" = p."name"
FROM "Post" p
WHERE s."postId" = p."id";

-- Fallback: assign site from employee site assignment when post link is missing
UPDATE "Shift" s
SET "siteId" = picked."siteId"
FROM (
    SELECT DISTINCT ON (sa."employeeId")
        sa."employeeId",
        sa."siteId"
    FROM "SiteAssignment" sa
    ORDER BY sa."employeeId", sa."isActive" DESC, sa."priority" DESC
) picked
WHERE s."siteId" IS NULL
  AND picked."employeeId" = s."employeeId";

-- Fallback: assign any site for the employee's company
UPDATE "Shift" s
SET "siteId" = picked."siteId"
FROM (
    SELECT DISTINCT ON (st."companyId")
        st."companyId",
        st."id" AS "siteId"
    FROM "Site" st
    ORDER BY st."companyId", st."createdAt" ASC
) picked
WHERE s."siteId" IS NULL
  AND picked."companyId" = s."companyId";

-- Remove shifts that cannot be assigned to a site (orphaned postId)
DELETE FROM "Shift"
WHERE "siteId" IS NULL;

-- Drop legacy Shift.postId constraints and column
ALTER TABLE "Shift" DROP CONSTRAINT "Shift_postId_fkey";
DROP INDEX IF EXISTS "Shift_companyId_postId_startTime_idx";
DROP INDEX IF EXISTS "Shift_postId_idx";
ALTER TABLE "Shift" DROP COLUMN "postId";

-- Enforce NOT NULL after backfill
ALTER TABLE "Shift" ALTER COLUMN "siteId" SET NOT NULL;

-- Drop legacy post tables (FKs first)
ALTER TABLE "PostAssignment" DROP CONSTRAINT "PostAssignment_employeeId_fkey";
ALTER TABLE "PostAssignment" DROP CONSTRAINT "PostAssignment_postId_fkey";
ALTER TABLE "Post" DROP CONSTRAINT "Post_siteId_fkey";
DROP TABLE "PostAssignment";
DROP TABLE "Post";

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
