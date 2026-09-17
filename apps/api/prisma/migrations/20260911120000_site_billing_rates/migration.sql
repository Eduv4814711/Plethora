-- CreateEnum
CREATE TYPE "SiteBillingMethod" AS ENUM ('PER_GUARD');

-- CreateTable
CREATE TABLE "SiteBillingRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "billingMethod" "SiteBillingMethod" NOT NULL DEFAULT 'PER_GUARD',
    "ratePerGuard" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteBillingRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteBillingRate_companyId_clientId_idx" ON "SiteBillingRate"("companyId", "clientId");

-- CreateIndex
CREATE INDEX "SiteBillingRate_siteId_effectiveFrom_idx" ON "SiteBillingRate"("siteId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "SiteBillingRate_siteId_isActive_idx" ON "SiteBillingRate"("siteId", "isActive");

-- CreateIndex
CREATE INDEX "SiteBillingRate_clientId_idx" ON "SiteBillingRate"("clientId");

-- AddForeignKey
ALTER TABLE "SiteBillingRate" ADD CONSTRAINT "SiteBillingRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteBillingRate" ADD CONSTRAINT "SiteBillingRate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteBillingRate" ADD CONSTRAINT "SiteBillingRate_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteBillingRate" ADD CONSTRAINT "SiteBillingRate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data Migration: Backfill any existing Site monthlyRevenue into SiteBillingRate
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
  AND s."clientId" IS NOT NULL;
