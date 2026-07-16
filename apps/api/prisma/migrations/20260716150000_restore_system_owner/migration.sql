-- Restore the original tenant-based System Owner model. There is no longer a
-- platform-level Root Admin account in active use.
UPDATE "User"
SET
  "adminClass" = 'SYSTEM_ADMIN',
  "isSystemOwner" = true,
  "role" = 'admin',
  "moduleAccess" = NULL,
  "disabledAt" = NULL,
  "disabledReason" = NULL,
  "accessVersion" = "accessVersion" + 1
WHERE "adminClass" IN ('ROOT_ADMIN', 'SYSTEM_ADMIN');

-- Force re-authentication with the restored owner claims.
UPDATE "RefreshToken"
SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "revokedAt" IS NULL
  AND "userId" IN (
    SELECT id FROM "User" WHERE "isSystemOwner" = true
  );
