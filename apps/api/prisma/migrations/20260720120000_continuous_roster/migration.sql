CREATE TYPE "RosterContinuityState" AS ENUM ('not_setup', 'running', 'needs_attention', 'paused');
CREATE TYPE "SiteRosterGeneratedSource" AS ENUM ('pattern', 'manual_override', 'leave', 'replacement', 'legacy');

ALTER TABLE "Site"
  ADD COLUMN "rosterPeriodCalendarId" TEXT,
  ADD COLUMN "rosterContinuityState" "RosterContinuityState" NOT NULL DEFAULT 'not_setup',
  ADD COLUMN "rosterMaintainedThrough" DATE,
  ADD COLUMN "rosterLastReconciledAt" TIMESTAMP(3),
  ADD COLUMN "rosterLastReconciliationStatus" TEXT,
  ADD COLUMN "rosterContinuityPauseReason" TEXT;

ALTER TABLE "SiteRosterGeneratedShift"
  ALTER COLUMN "source" DROP DEFAULT;

ALTER TABLE "SiteRosterGeneratedShift"
  ALTER COLUMN "source" TYPE "SiteRosterGeneratedSource"
  USING CASE
    WHEN "source" = 'manual_override' THEN 'manual_override'::"SiteRosterGeneratedSource"
    WHEN "source" = 'leave' THEN 'leave'::"SiteRosterGeneratedSource"
    WHEN "source" = 'replacement' THEN 'replacement'::"SiteRosterGeneratedSource"
    WHEN "source" = 'pattern' THEN 'pattern'::"SiteRosterGeneratedSource"
    ELSE 'legacy'::"SiteRosterGeneratedSource"
  END;

ALTER TABLE "SiteRosterGeneratedShift"
  ALTER COLUMN "source" SET DEFAULT 'pattern',
  ADD COLUMN "publishedShiftId" TEXT;

CREATE UNIQUE INDEX "SiteRosterGeneratedShift_publishedShiftId_key"
  ON "SiteRosterGeneratedShift"("publishedShiftId");

ALTER TABLE "SiteRosterGeneratedShift"
  ADD CONSTRAINT "SiteRosterGeneratedShift_publishedShiftId_fkey"
  FOREIGN KEY ("publishedShiftId") REFERENCES "Shift"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Site_rosterContinuityState_idx" ON "Site"("companyId", "rosterContinuityState");
