-- User permissions RBAC: accessVersion, isSystemOwner, UserPermission, PermissionPreset,
-- DocumentSensitivity, PayrollRun maker-checker fields

-- User access control fields
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isSystemOwner" BOOLEAN NOT NULL DEFAULT false;

-- UserPermission table
CREATE TABLE IF NOT EXISTS "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserPermission_userId_permission_key" ON "UserPermission"("userId", "permission");
CREATE INDEX IF NOT EXISTS "UserPermission_userId_idx" ON "UserPermission"("userId");

DO $$ BEGIN
    ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- PermissionPreset table
CREATE TABLE IF NOT EXISTS "PermissionPreset" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PermissionPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PermissionPreset_key_key" ON "PermissionPreset"("key");

-- DocumentSensitivity enum and column
DO $$ BEGIN
    CREATE TYPE "DocumentSensitivity" AS ENUM (
        'PUBLIC_OPERATIONAL',
        'INTERNAL_OPERATIONAL',
        'HR_CONFIDENTIAL',
        'PAYROLL_CONFIDENTIAL',
        'MEDICAL_RESTRICTED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "sensitivity" "DocumentSensitivity" NOT NULL DEFAULT 'INTERNAL_OPERATIONAL';

-- Map legacy document categories to sensitivity
UPDATE "ManagedDocument" SET "sensitivity" = 'PAYROLL_CONFIDENTIAL' WHERE "category" = 'PAYROLL' AND "sensitivity" = 'INTERNAL_OPERATIONAL';
UPDATE "ManagedDocument" SET "sensitivity" = 'HR_CONFIDENTIAL' WHERE "category" = 'EMPLOYEE' AND "sensitivity" = 'INTERNAL_OPERATIONAL';
UPDATE "ManagedDocument" SET "sensitivity" = 'PUBLIC_OPERATIONAL' WHERE "category" IN ('SITE', 'CLIENT', 'EQUIPMENT', 'TASK', 'OTHER') AND "sensitivity" = 'INTERNAL_OPERATIONAL';

-- PayrollRun maker-checker fields
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "calculatedById" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "markedPaidById" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "markedPaidAt" TIMESTAMP(3);
