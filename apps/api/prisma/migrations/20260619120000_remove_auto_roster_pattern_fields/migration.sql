-- Drop pattern-based auto-roster fields; engine now uses fair monthly assignment.
ALTER TABLE "Site" DROP COLUMN IF EXISTS "autoRosterPattern";
ALTER TABLE "Site" DROP COLUMN IF EXISTS "autoRosterCustomBlocks";
