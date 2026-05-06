-- AlterTable
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "rosterSiteRules" TEXT;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "supersededEmployeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
