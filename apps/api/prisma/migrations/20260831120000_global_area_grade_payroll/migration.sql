-- Global, effective-dated Area x Grade payroll pricing.
-- This migration is additive: legacy employee/group pricing remains available
-- until a company explicitly activates site_area_grade pricing.

CREATE TABLE "PayArea" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayArea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayGradeDefinition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayGradeDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayAreaGradeRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "hourlyRate" DECIMAL(10,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayAreaGradeRate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SitePayProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SitePayProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeePayrollHomeSite" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployeePayrollHomeSite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayArea_companyId_name_key" ON "PayArea"("companyId", "name");
CREATE INDEX "PayArea_companyId_isActive_idx" ON "PayArea"("companyId", "isActive");
CREATE UNIQUE INDEX "PayGradeDefinition_companyId_name_key" ON "PayGradeDefinition"("companyId", "name");
CREATE INDEX "PayGradeDefinition_companyId_isActive_idx" ON "PayGradeDefinition"("companyId", "isActive");
CREATE UNIQUE INDEX "PayAreaGradeRate_areaId_gradeId_effectiveFrom_key" ON "PayAreaGradeRate"("areaId", "gradeId", "effectiveFrom");
CREATE INDEX "PayAreaGradeRate_companyId_effectiveFrom_idx" ON "PayAreaGradeRate"("companyId", "effectiveFrom");
CREATE INDEX "PayAreaGradeRate_areaId_gradeId_effectiveFrom_idx" ON "PayAreaGradeRate"("areaId", "gradeId", "effectiveFrom");
CREATE UNIQUE INDEX "SitePayProfile_siteId_effectiveFrom_key" ON "SitePayProfile"("siteId", "effectiveFrom");
CREATE INDEX "SitePayProfile_companyId_effectiveFrom_idx" ON "SitePayProfile"("companyId", "effectiveFrom");
CREATE INDEX "SitePayProfile_siteId_effectiveFrom_idx" ON "SitePayProfile"("siteId", "effectiveFrom");
CREATE UNIQUE INDEX "EmployeePayrollHomeSite_employeeId_effectiveFrom_key" ON "EmployeePayrollHomeSite"("employeeId", "effectiveFrom");
CREATE INDEX "EmployeePayrollHomeSite_companyId_effectiveFrom_idx" ON "EmployeePayrollHomeSite"("companyId", "effectiveFrom");
CREATE INDEX "EmployeePayrollHomeSite_employeeId_effectiveFrom_idx" ON "EmployeePayrollHomeSite"("employeeId", "effectiveFrom");
CREATE INDEX "EmployeePayrollHomeSite_siteId_idx" ON "EmployeePayrollHomeSite"("siteId");

ALTER TABLE "PayArea" ADD CONSTRAINT "PayArea_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayGradeDefinition" ADD CONSTRAINT "PayGradeDefinition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayAreaGradeRate" ADD CONSTRAINT "PayAreaGradeRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayAreaGradeRate" ADD CONSTRAINT "PayAreaGradeRate_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "PayArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayAreaGradeRate" ADD CONSTRAINT "PayAreaGradeRate_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "PayGradeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SitePayProfile" ADD CONSTRAINT "SitePayProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SitePayProfile" ADD CONSTRAINT "SitePayProfile_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SitePayProfile" ADD CONSTRAINT "SitePayProfile_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "PayArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SitePayProfile" ADD CONSTRAINT "SitePayProfile_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "PayGradeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeePayrollHomeSite" ADD CONSTRAINT "EmployeePayrollHomeSite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeePayrollHomeSite" ADD CONSTRAINT "EmployeePayrollHomeSite_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeePayrollHomeSite" ADD CONSTRAINT "EmployeePayrollHomeSite_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Make the calculation engine's existing fallbacks explicit company-wide rules.
-- Existing company rules win; legacy group rules are deliberately not promoted.
INSERT INTO "PayRule" ("id", "companyId", "ruleType", "multiplier", "createdAt", "updatedAt")
SELECT
  'global_' || md5(c."id" || ':' || defaults."ruleType"),
  c."id",
  defaults."ruleType",
  defaults."multiplier",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company" c
CROSS JOIN (
  VALUES
    ('overtime', 1.50::decimal),
    ('sunday', 2.00::decimal),
    ('public_holiday', 2.00::decimal)
) AS defaults("ruleType", "multiplier")
ON CONFLICT ("companyId", "ruleType") DO NOTHING;
