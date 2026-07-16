-- MFA is deferred to a later rollout phase. Clear enrollment state and revoke
-- existing sessions so all users receive fresh non-MFA session claims.
UPDATE "User"
SET
  "mfaRequired" = false,
  "mfaEnabled" = false,
  "mfaSecretEncrypted" = NULL,
  "mfaEnrolledAt" = NULL,
  "accessVersion" = "accessVersion" + 1
WHERE
  "mfaRequired" = true
  OR "mfaEnabled" = true
  OR "mfaSecretEncrypted" IS NOT NULL
  OR "mfaEnrolledAt" IS NOT NULL;
