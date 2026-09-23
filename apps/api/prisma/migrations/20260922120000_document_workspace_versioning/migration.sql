-- CreateEnum (idempotent)
DO $$ BEGIN
  CREATE TYPE "DocumentOrigin" AS ENUM ('UPLOADED', 'GENERATED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "DocumentLifecycleStatus" AS ENUM ('DRAFT', 'REVIEW', 'FINAL', 'SUPERSEDED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterEnum
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'BILLING';
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'REPORT';
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'ACADEMY';

-- AlterTable ManagedDocument
ALTER TABLE "ManagedDocument"
  ADD COLUMN IF NOT EXISTS "currentVersionId" TEXT,
  ADD COLUMN IF NOT EXISTS "lifecycleStatus" "DocumentLifecycleStatus" NOT NULL DEFAULT 'FINAL',
  ADD COLUMN IF NOT EXISTS "origin" "DocumentOrigin" NOT NULL DEFAULT 'UPLOADED',
  ADD COLUMN IF NOT EXISTS "sourceEntityId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceEntityType" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceModule" TEXT;

-- CreateTable DocumentVersion
CREATE TABLE IF NOT EXISTS "DocumentVersion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changeSummary" TEXT,
    "sourceType" TEXT,
    "metadata" JSONB,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentVersion_companyId_idx" ON "DocumentVersion"("companyId");
CREATE INDEX IF NOT EXISTS "DocumentVersion_documentId_idx" ON "DocumentVersion"("documentId");
CREATE INDEX IF NOT EXISTS "DocumentVersion_createdById_idx" ON "DocumentVersion"("createdById");
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentVersion_documentId_versionNumber_key" ON "DocumentVersion"("documentId", "versionNumber");

CREATE INDEX IF NOT EXISTS "ManagedDocument_companyId_origin_idx" ON "ManagedDocument"("companyId", "origin");
CREATE INDEX IF NOT EXISTS "ManagedDocument_sourceModule_sourceEntityId_idx" ON "ManagedDocument"("sourceModule", "sourceEntityId");
CREATE INDEX IF NOT EXISTS "ManagedDocument_currentVersionId_idx" ON "ManagedDocument"("currentVersionId");
CREATE INDEX IF NOT EXISTS "ManagedDocument_lifecycleStatus_idx" ON "ManagedDocument"("lifecycleStatus");

-- Backfill initial DocumentVersion for existing ManagedDocument records
INSERT INTO "DocumentVersion" ("id", "companyId", "documentId", "versionNumber", "fileUrl", "fileName", "mimeType", "size", "createdById", "createdAt", "changeSummary", "sourceType")
SELECT
  'ver_' || md."id",
  md."companyId",
  md."id",
  1,
  md."fileUrl",
  md."fileName",
  md."mimeType",
  md."size",
  md."uploadedById",
  md."createdAt",
  'Initial document record',
  'INITIAL_UPLOAD'
FROM "ManagedDocument" md
ON CONFLICT ("documentId", "versionNumber") DO NOTHING;

-- Point currentVersionId to the backfilled version
UPDATE "ManagedDocument" md
SET "currentVersionId" = 'ver_' || md."id"
WHERE md."currentVersionId" IS NULL
  AND EXISTS (SELECT 1 FROM "DocumentVersion" dv WHERE dv."id" = 'ver_' || md."id");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "ManagedDocument" ADD CONSTRAINT "ManagedDocument_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ManagedDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
