-- Site auto-roster configuration and automation run queue
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "autoRosterEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "autoRosterPattern" TEXT;
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "autoRosterCustomBlocks" JSONB;
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "autoRosterMinCoveragePercent" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "autoRosterLastRunAt" TIMESTAMP(3);
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "autoRosterLastStatus" TEXT;

CREATE TABLE IF NOT EXISTS "RosterAutomationRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "coveragePercent" INTEGER,
    "planSnapshot" JSONB,
    "warnings" JSONB,
    "errorMessage" TEXT,
    "appliedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterAutomationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RosterAutomationRun_companyId_status_idx" ON "RosterAutomationRun"("companyId", "status");
CREATE INDEX IF NOT EXISTS "RosterAutomationRun_siteId_createdAt_idx" ON "RosterAutomationRun"("siteId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RosterAutomationRun_companyId_fkey'
  ) THEN
    ALTER TABLE "RosterAutomationRun" ADD CONSTRAINT "RosterAutomationRun_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RosterAutomationRun_siteId_fkey'
  ) THEN
    ALTER TABLE "RosterAutomationRun" ADD CONSTRAINT "RosterAutomationRun_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
