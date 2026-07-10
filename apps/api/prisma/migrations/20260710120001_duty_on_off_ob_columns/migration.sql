-- Duty ON / Duty OFF OB columns and backfill (separate migration after enum value is committed).
ALTER TABLE "SiteTimesheetRow" ADD COLUMN IF NOT EXISTS "dutyOnObNumber" TEXT;
ALTER TABLE "SiteTimesheetRow" ADD COLUMN IF NOT EXISTS "dutyOffObNumber" TEXT;

-- Backfill existing single OB as Duty ON.
UPDATE "SiteTimesheetRow"
SET "dutyOnObNumber" = "occurrenceBookNumber"
WHERE "occurrenceBookNumber" IS NOT NULL AND "dutyOnObNumber" IS NULL;

-- Rows that were reviewed with only Duty ON should become partially reviewed.
UPDATE "SiteTimesheetRow"
SET "approvalStatus" = 'partially_reviewed'
WHERE "approvalStatus" = 'reviewed'
  AND "dutyOnObNumber" IS NOT NULL
  AND ("dutyOffObNumber" IS NULL OR TRIM("dutyOffObNumber") = '');
