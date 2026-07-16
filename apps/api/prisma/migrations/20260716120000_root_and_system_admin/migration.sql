CREATE TYPE "AdminClass" AS ENUM ('STANDARD', 'SYSTEM_ADMIN', 'ROOT_ADMIN');
CREATE TYPE "AdminChangeType" AS ENUM ('APPOINT_SYSTEM_ADMIN', 'CHANGE_SYSTEM_ADMIN_ACCESS', 'REMOVE_SYSTEM_ADMIN');

ALTER TABLE "User"
  ADD COLUMN "adminClass" "AdminClass" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "disabledAt" TIMESTAMP(3),
  ADD COLUMN "disabledReason" TEXT;

-- Existing owners become explicit system-admin accounts but lose the old bypass.
UPDATE "User" SET "adminClass" = 'SYSTEM_ADMIN' WHERE "isSystemOwner" = true;

-- Bootstrap exactly one platform root from the real Quick Bopha tenant. Fixture
-- and test tenants are deliberately excluded. A companion dry-run script prints
-- this candidate before deployment.
WITH initial_root AS (
  SELECT u.id
  FROM "User" u
  JOIN "Company" c ON c.id = u."companyId"
  WHERE u."isSystemOwner" = true
    AND lower(c.name) LIKE '%quick%bopha%'
    AND lower(c.name) NOT LIKE '%test%'
    AND lower(c.name) NOT LIKE '%fixture%'
    AND lower(c.name) NOT LIKE '%demo%'
  ORDER BY u."createdAt" ASC, u.id ASC
  LIMIT 1
)
UPDATE "User"
SET "adminClass" = 'ROOT_ADMIN', "accessVersion" = "accessVersion" + 1
WHERE id IN (SELECT id FROM initial_root);

-- The legacy flag remains in the schema for compatibility reads only and no
-- longer denotes authority.
UPDATE "User" SET "isSystemOwner" = false WHERE "isSystemOwner" = true;

CREATE TABLE "PlatformAuditEvent" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "targetCompanyId" TEXT,
  "targetUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "requestId" TEXT,
  "sessionId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "reason" TEXT,
  "source" TEXT NOT NULL DEFAULT 'api',
  "result" TEXT NOT NULL DEFAULT 'success',
  "riskLevel" TEXT NOT NULL DEFAULT 'HIGH',
  "beforeState" JSONB,
  "afterState" JSONB,
  "metadata" JSONB,
  "previousHash" TEXT,
  "eventHash" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminChangeRequest" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "changeType" "AdminChangeType" NOT NULL,
  "requestedAdminClass" "AdminClass",
  "grants" JSONB,
  "reason" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "approverId" TEXT,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "reviewComment" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "executedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformAuditEvent_timestamp_idx" ON "PlatformAuditEvent"("timestamp");
CREATE INDEX "PlatformAuditEvent_actorUserId_timestamp_idx" ON "PlatformAuditEvent"("actorUserId", "timestamp");
CREATE INDEX "PlatformAuditEvent_targetCompanyId_timestamp_idx" ON "PlatformAuditEvent"("targetCompanyId", "timestamp");
CREATE INDEX "PlatformAuditEvent_action_timestamp_idx" ON "PlatformAuditEvent"("action", "timestamp");
CREATE INDEX "PlatformAuditEvent_requestId_idx" ON "PlatformAuditEvent"("requestId");
CREATE INDEX "AdminChangeRequest_companyId_status_requestedAt_idx" ON "AdminChangeRequest"("companyId", "status", "requestedAt");
CREATE INDEX "AdminChangeRequest_targetUserId_status_idx" ON "AdminChangeRequest"("targetUserId", "status");
CREATE INDEX "AdminChangeRequest_approverId_status_idx" ON "AdminChangeRequest"("approverId", "status");

ALTER TABLE "PlatformAuditEvent" ADD CONSTRAINT "PlatformAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlatformAuditEvent" ADD CONSTRAINT "PlatformAuditEvent_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlatformAuditEvent" ADD CONSTRAINT "PlatformAuditEvent_targetCompanyId_fkey" FOREIGN KEY ("targetCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdminChangeRequest" ADD CONSTRAINT "AdminChangeRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminChangeRequest" ADD CONSTRAINT "AdminChangeRequest_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminChangeRequest" ADD CONSTRAINT "AdminChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminChangeRequest" ADD CONSTRAINT "AdminChangeRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
