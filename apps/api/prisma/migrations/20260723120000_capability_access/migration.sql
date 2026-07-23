-- Replace authorization roles with explicit, deny-by-default capabilities.
BEGIN;

CREATE TYPE "AccountType" AS ENUM ('staff', 'client');

ALTER TABLE "User"
  ADD COLUMN "accountType" "AccountType" NOT NULL DEFAULT 'staff',
  ADD COLUMN "jobTitle" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "capabilities" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "Company" ADD COLUMN "ownerUserId" TEXT;

ALTER TABLE "LeaveApprovalStep" RENAME COLUMN "role" TO "requiredCapability";
UPDATE "LeaveApprovalStep"
SET "requiredCapability" = '/employees/leave:approve';
DROP INDEX IF EXISTS "LeaveApprovalStep_role_decision_idx";
CREATE INDEX "LeaveApprovalStep_requiredCapability_decision_idx"
  ON "LeaveApprovalStep"("requiredCapability", "decision");

-- Preserve identity metadata without allowing it to authorize anything.
UPDATE "User"
SET
  "accountType" = CASE WHEN "role"::text = 'client' THEN 'client'::"AccountType" ELSE 'staff'::"AccountType" END,
  "jobTitle" = COALESCE(
    NULLIF(BTRIM("roleLabel"), ''),
    CASE "role"::text
      WHEN 'operations_manager' THEN 'Operations Manager'
      WHEN 'hr_payroll' THEN 'HR / Payroll'
      WHEN 'supervisor' THEN 'Supervisor'
      WHEN 'controller' THEN 'Controller'
      WHEN 'client' THEN 'Client'
      ELSE NULL
    END
  );

-- A legacy write grant becomes every standard capability. A read grant becomes view.
-- Legacy arrays represented write access.
WITH normalized AS (
  SELECT
    u.id,
    CASE
      WHEN jsonb_typeof(u."moduleAccess") = 'array' THEN (
        SELECT COALESCE(
          jsonb_object_agg(path, '["view","view_sensitive","create","edit","delete","approve","export","manage_access"]'::jsonb),
          '{}'::jsonb
        )
        FROM jsonb_array_elements_text(u."moduleAccess") AS path
      )
      WHEN jsonb_typeof(u."moduleAccess") = 'object' THEN (
        SELECT COALESCE(
          jsonb_object_agg(
            entry.key,
            CASE entry.value #>> '{}'
              WHEN 'read' THEN '["view","view_sensitive"]'::jsonb
              WHEN 'write' THEN '["view","view_sensitive","create","edit","delete","approve","export","manage_access"]'::jsonb
              ELSE '[]'::jsonb
            END
          ),
          '{}'::jsonb
        )
        FROM jsonb_each(u."moduleAccess") AS entry
      )
      ELSE '{}'::jsonb
    END AS permissions
  FROM "User" u
)
UPDATE "User" u
SET "capabilities" = normalized.permissions
FROM normalized
WHERE normalized.id = u.id;

-- Legacy client accounts were admitted to the client portal by their role.
-- Preserve that effective access explicitly before the role column is removed.
UPDATE "User"
SET "capabilities" = jsonb_set(
  "capabilities",
  ARRAY['/client-portal'],
  COALESCE("capabilities" -> '/client-portal', '[]'::jsonb) || '["view"]'::jsonb,
  true
)
WHERE "role"::text = 'client';

-- Every legacy unrestricted administrator previously had a full-access
-- bypass. Preserve that effective access explicitly for all but the one user
-- who will become owner (the owner also bypasses these checks).
UPDATE "User"
SET "capabilities" = '{
  "/": ["view"],
  "/employees": ["view","view_sensitive","create","edit","delete","export"],
  "/employees/leave": ["view","create","edit","delete","approve","export"],
  "/sites": ["view","create","edit","delete","export"],
  "/rostering": ["view","create","edit","delete","approve","export"],
  "/attendance": ["view","create","edit","delete","approve","export"],
  "/payroll": ["view","view_sensitive","create","edit","delete","approve","export"],
  "/tasks": ["view","create","edit","delete","export"],
  "/whatsapp": ["view","create","edit","delete"],
  "/reports": ["view","export"],
  "/approvals": ["view","create","edit","approve","export"],
  "/incidents": ["view","create","edit","delete","approve","export"],
  "/documents": ["view","create","edit","delete","export"],
  "/client-portal": ["view","create"],
  "/academy": ["view","view_sensitive","create","edit","delete","approve","export"],
  "/audit": ["view","export"],
  "/settings": ["view","edit","export"],
  "/settings/access": ["view","create","edit","delete","manage_access"]
}'::jsonb
WHERE "role"::text = 'admin'
  AND (
    "moduleAccess" IS NULL
    OR "moduleAccess" = '{}'::jsonb
    OR "moduleAccess" = '[]'::jsonb
  );

-- Choose one deterministic owner per company: the oldest legacy unrestricted
-- administrator, then the oldest administrator, then the oldest user.
WITH owner_candidates AS (
  SELECT
    c.id AS company_id,
    COALESCE(
      (
        SELECT u.id FROM "User" u
        WHERE u."companyId" = c.id
          AND u."role"::text = 'admin'
          AND (
            u."moduleAccess" IS NULL
            OR u."moduleAccess" = '{}'::jsonb
            OR u."moduleAccess" = '[]'::jsonb
          )
        ORDER BY u."createdAt", u.id
        LIMIT 1
      ),
      (
        SELECT u.id FROM "User" u
        WHERE u."companyId" = c.id AND u."role"::text = 'admin'
        ORDER BY u."createdAt", u.id
        LIMIT 1
      ),
      (
        SELECT u.id FROM "User" u
        WHERE u."companyId" = c.id
        ORDER BY u."createdAt", u.id
        LIMIT 1
      )
    ) AS owner_id
  FROM "Company" c
)
UPDATE "Company" c
SET "ownerUserId" = owner_candidates.owner_id
FROM owner_candidates
WHERE owner_candidates.company_id = c.id;

CREATE UNIQUE INDEX "Company_ownerUserId_key" ON "Company"("ownerUserId");
CREATE UNIQUE INDEX "User_companyId_id_key" ON "User"("companyId", "id");
ALTER TABLE "Company"
  ADD CONSTRAINT "Company_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Company"
  ADD CONSTRAINT "Company_owner_same_company_fkey"
  FOREIGN KEY ("id", "ownerUserId") REFERENCES "User"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "User"
  DROP COLUMN "moduleAccess",
  DROP COLUMN "roleLabel",
  DROP COLUMN "role";

DROP TYPE "UserRole";

COMMIT;
