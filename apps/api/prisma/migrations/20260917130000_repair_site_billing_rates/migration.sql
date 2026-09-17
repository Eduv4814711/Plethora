-- Repair migration: 20260917130000_repair_site_billing_rates
--
-- PURPOSE
--   The original 20260911120000_site_billing_rates migration may have failed
--   silently in production due to a deploy pipeline bug that swallowed non-zero
--   exit codes from prisma migrate deploy. This forward-only, idempotent migration
--   ensures the SiteBillingMethod enum and SiteBillingRate table exist in exactly
--   the shape expected by the application, regardless of which state the previous
--   migration left things in.
--
-- SAFETY GUARANTEES
--   • CREATE TYPE / CREATE TABLE / CREATE INDEX all use IF NOT EXISTS guards.
--   • Foreign keys are dropped-then-re-added so the constraint definition is
--     always authoritative, even if a partial version was applied previously.
--   • The backfill INSERT uses NOT EXISTS to avoid duplicating any rows that
--     were already created by a prior (partial) attempt.
--   • No DROP TABLE, TRUNCATE, or DELETE on business data.
--   • Existing Client, Site, Employee, Payroll, and Invoice rows are untouched.

-- ── Enum ───────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SiteBillingMethod') THEN
    CREATE TYPE "SiteBillingMethod" AS ENUM ('PER_GUARD');
  END IF;
END $$;

-- ── Table ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SiteBillingRate" (
    "id"              TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "clientId"        TEXT NOT NULL,
    "siteId"          TEXT NOT NULL,
    "billingMethod"   "SiteBillingMethod" NOT NULL DEFAULT 'PER_GUARD',
    "ratePerGuard"    DECIMAL(12,2) NOT NULL,
    "effectiveFrom"   DATE NOT NULL,
    "effectiveTo"     DATE,
    "isActive"        BOOLEAN NOT NULL DEFAULT true,
    "notes"           TEXT,
    "createdByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteBillingRate_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "SiteBillingRate_companyId_clientId_idx"
    ON "SiteBillingRate"("companyId", "clientId");

CREATE INDEX IF NOT EXISTS "SiteBillingRate_siteId_effectiveFrom_idx"
    ON "SiteBillingRate"("siteId", "effectiveFrom");

CREATE INDEX IF NOT EXISTS "SiteBillingRate_siteId_isActive_idx"
    ON "SiteBillingRate"("siteId", "isActive");

CREATE INDEX IF NOT EXISTS "SiteBillingRate_clientId_idx"
    ON "SiteBillingRate"("clientId");

-- ── Foreign keys ───────────────────────────────────────────────────────────────
-- Drop-then-add pattern ensures the constraint definition is always correct
-- regardless of whether a partial prior attempt created it with different options.

ALTER TABLE "SiteBillingRate"
    DROP CONSTRAINT IF EXISTS "SiteBillingRate_companyId_fkey";
ALTER TABLE "SiteBillingRate"
    ADD CONSTRAINT "SiteBillingRate_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteBillingRate"
    DROP CONSTRAINT IF EXISTS "SiteBillingRate_clientId_fkey";
ALTER TABLE "SiteBillingRate"
    ADD CONSTRAINT "SiteBillingRate_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteBillingRate"
    DROP CONSTRAINT IF EXISTS "SiteBillingRate_siteId_fkey";
ALTER TABLE "SiteBillingRate"
    ADD CONSTRAINT "SiteBillingRate_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteBillingRate"
    DROP CONSTRAINT IF EXISTS "SiteBillingRate_createdByUserId_fkey";
ALTER TABLE "SiteBillingRate"
    ADD CONSTRAINT "SiteBillingRate_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Backfill ───────────────────────────────────────────────────────────────────
-- Migrate any existing Site.monthlyRevenue into SiteBillingRate as an initial
-- PER_GUARD rate by dividing by the number of active security officers assigned
-- to the site. The NOT EXISTS guard ensures we never create duplicate rows for
-- sites that were already processed by a prior (partial) migration attempt.

INSERT INTO "SiteBillingRate" (
    "id",
    "companyId",
    "clientId",
    "siteId",
    "billingMethod",
    "ratePerGuard",
    "effectiveFrom",
    "isActive",
    "createdAt",
    "updatedAt"
)
SELECT
    'cbr_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20),
    s."companyId",
    s."clientId",
    s."id",
    'PER_GUARD'::"SiteBillingMethod",
    ROUND(
        s."monthlyRevenue" / GREATEST(
            COALESCE(
                (
                    SELECT COUNT(*)::numeric
                    FROM "SiteAssignment" sa
                    JOIN "Employee" e ON sa."employeeId" = e."id"
                    WHERE sa."siteId" = s."id"
                      AND sa."isActive" = true
                      AND e."status"::text IN ('active', 'training', 'hired', 'reliever')
                      AND e."employeeType" = 'security_officer'
                ),
                0
            ),
            1
        ),
        2
    ),
    CURRENT_DATE,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Site" s
WHERE s."monthlyRevenue" IS NOT NULL
  AND s."monthlyRevenue" > 0
  AND s."clientId" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "SiteBillingRate" sbr WHERE sbr."siteId" = s."id"
  );
