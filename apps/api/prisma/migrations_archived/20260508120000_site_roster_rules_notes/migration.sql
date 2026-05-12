-- AlterTable (idempotent for local recovery)
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "rosterSiteRules" TEXT;
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "rosterSheetNotes" TEXT;
