-- Access accountability: enrich the audit record.
--
-- The capability model change that accompanies this migration (exact path
-- matching instead of prefix inheritance, and record-owning routes requiring
-- their own module) is a data change applied by `npm run db:expand-grants`,
-- which rewrites User.capabilities and writes a user.access.migrated audit row
-- per affected user. Run that script immediately after this migration.

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "outcome" TEXT NOT NULL DEFAULT 'success';
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "requestId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorLabel" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_companyId_action_timestamp_idx"
  ON "AuditLog" ("companyId", "action", "timestamp");
CREATE INDEX IF NOT EXISTS "AuditLog_companyId_userId_timestamp_idx"
  ON "AuditLog" ("companyId", "userId", "timestamp");
CREATE INDEX IF NOT EXISTS "AuditLog_companyId_outcome_timestamp_idx"
  ON "AuditLog" ("companyId", "outcome", "timestamp");
