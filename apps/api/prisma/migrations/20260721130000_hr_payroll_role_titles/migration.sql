-- Backfill the role only for title-matched staff who were already granted
-- write access to an HR-sensitive module. A display title by itself must not
-- escalate privileges during an unattended production migration. Record the
-- previous role in AuditLog so every promotion remains reviewable/recoverable.
BEGIN;

WITH candidates AS MATERIALIZED (
  SELECT "id", "companyId", "role" AS "previousRole", "roleLabel", "moduleAccess"
  FROM "User"
  WHERE "role" NOT IN ('admin', 'hr_payroll')
    AND (
      (
        jsonb_typeof("moduleAccess") = 'object'
        AND (
          "moduleAccess" ->> '/employees' = 'write'
          OR "moduleAccess" ->> '/payroll' = 'write'
        )
      )
      OR (
        jsonb_typeof("moduleAccess") = 'array'
        AND (
          "moduleAccess" @> '["/employees"]'::jsonb
          OR "moduleAccess" @> '["/payroll"]'::jsonb
        )
      )
    )
    AND regexp_replace(
      lower(trim(COALESCE("roleLabel", ''))),
      '[^a-z0-9]+',
      '',
      'g'
    ) IN (
      'hr',
      'hrmanager',
      'humanresourcesmanager',
      'hrandpayroll',
      'hrpayroll',
      'pay',
      'payroll',
      'payrollmanager',
      'payrolladministrator',
      'payrollofficer'
    )
), promoted AS (
  UPDATE "User" AS users
  SET "role" = 'hr_payroll', "updatedAt" = CURRENT_TIMESTAMP
  FROM candidates
  WHERE users."id" = candidates."id"
  RETURNING users."id"
)
INSERT INTO "AuditLog" ("id", "companyId", "action", "entityType", "entityId", "metadata")
SELECT
  md5('20260721130000_hr_payroll_role_titles:' || candidates."id"),
  candidates."companyId",
  'ROLE_BACKFILL_HR_PAYROLL',
  'User',
  candidates."id",
  jsonb_build_object(
    'migration', '20260721130000_hr_payroll_role_titles',
    'previousRole', candidates."previousRole",
    'newRole', 'hr_payroll',
    'roleLabel', candidates."roleLabel",
    'moduleAccess', candidates."moduleAccess"
  )
FROM candidates
JOIN promoted ON promoted."id" = candidates."id";

COMMIT;
