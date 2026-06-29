-- Site-level manual roster patterns (distinct from pattern-library RosterPattern table).

CREATE TYPE "SiteRosterPatternStatus" AS ENUM ('draft', 'active', 'archived');
CREATE TYPE "SiteRosterShiftCode" AS ENUM ('D', 'N', 'O', 'L', 'SL', 'TR', 'SB', 'AWOL', 'R', 'blank');
CREATE TYPE "SiteRosterShiftType" AS ENUM ('day', 'night', 'off', 'leave', 'sick_leave', 'training', 'standby', 'awol', 'replaced', 'unassigned');

CREATE TABLE "SiteRosterPattern" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "anchorDate" DATE NOT NULL,
    "cycleLengthDays" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "SiteRosterPatternStatus" NOT NULL DEFAULT 'draft',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteRosterPattern_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteRosterPattern_companyId_siteId_status_idx" ON "SiteRosterPattern"("companyId", "siteId", "status");
CREATE INDEX "SiteRosterPattern_siteId_effectiveFrom_idx" ON "SiteRosterPattern"("siteId", "effectiveFrom");

ALTER TABLE "SiteRosterPattern" ADD CONSTRAINT "SiteRosterPattern_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteRosterPattern" ADD CONSTRAINT "SiteRosterPattern_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SiteRosterPatternCell" (
    "id" TEXT NOT NULL,
    "rosterPatternId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "patternDayIndex" INTEGER NOT NULL,
    "shiftCode" "SiteRosterShiftCode" NOT NULL DEFAULT 'blank',
    "shiftType" "SiteRosterShiftType" NOT NULL DEFAULT 'unassigned',
    "sitePostId" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "SiteRosterPatternCell_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteRosterPatternCell_rosterPatternId_guardId_patternDayInd_key" ON "SiteRosterPatternCell"("rosterPatternId", "guardId", "patternDayIndex");
CREATE INDEX "SiteRosterPatternCell_rosterPatternId_idx" ON "SiteRosterPatternCell"("rosterPatternId");
CREATE INDEX "SiteRosterPatternCell_guardId_idx" ON "SiteRosterPatternCell"("guardId");

ALTER TABLE "SiteRosterPatternCell" ADD CONSTRAINT "SiteRosterPatternCell_rosterPatternId_fkey" FOREIGN KEY ("rosterPatternId") REFERENCES "SiteRosterPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteRosterPatternCell" ADD CONSTRAINT "SiteRosterPatternCell_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteRosterPatternCell" ADD CONSTRAINT "SiteRosterPatternCell_sitePostId_fkey" FOREIGN KEY ("sitePostId") REFERENCES "SitePost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SiteRosterManualOverride" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "rosterDate" DATE NOT NULL,
    "originalShiftCode" "SiteRosterShiftCode",
    "overrideShiftCode" "SiteRosterShiftCode" NOT NULL,
    "overrideShiftType" "SiteRosterShiftType" NOT NULL,
    "reason" TEXT,
    "doesChangeBasePattern" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteRosterManualOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteRosterManualOverride_siteId_guardId_rosterDate_key" ON "SiteRosterManualOverride"("siteId", "guardId", "rosterDate");
CREATE INDEX "SiteRosterManualOverride_companyId_siteId_rosterDate_idx" ON "SiteRosterManualOverride"("companyId", "siteId", "rosterDate");

ALTER TABLE "SiteRosterManualOverride" ADD CONSTRAINT "SiteRosterManualOverride_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteRosterManualOverride" ADD CONSTRAINT "SiteRosterManualOverride_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteRosterManualOverride" ADD CONSTRAINT "SiteRosterManualOverride_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SiteRosterGeneratedShift" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "rosterDate" DATE NOT NULL,
    "shiftCode" "SiteRosterShiftCode" NOT NULL,
    "shiftType" "SiteRosterShiftType" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'pattern',
    "rosterPatternId" TEXT,
    "sitePostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteRosterGeneratedShift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteRosterGeneratedShift_siteId_guardId_rosterDate_key" ON "SiteRosterGeneratedShift"("siteId", "guardId", "rosterDate");
CREATE INDEX "SiteRosterGeneratedShift_companyId_siteId_rosterDate_idx" ON "SiteRosterGeneratedShift"("companyId", "siteId", "rosterDate");

ALTER TABLE "SiteRosterGeneratedShift" ADD CONSTRAINT "SiteRosterGeneratedShift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteRosterGeneratedShift" ADD CONSTRAINT "SiteRosterGeneratedShift_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteRosterGeneratedShift" ADD CONSTRAINT "SiteRosterGeneratedShift_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteRosterGeneratedShift" ADD CONSTRAINT "SiteRosterGeneratedShift_sitePostId_fkey" FOREIGN KEY ("sitePostId") REFERENCES "SitePost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
