export const complianceDdl = `
-- Enums
DO $$ BEGIN
  CREATE TYPE "ComplianceObligationType" AS ENUM ('PSIRA_COMPANY', 'DIRECTOR_VETTING', 'EMPLOYEE_PSIRA', 'NBCPSS', 'SARS_TAX_CLEARANCE', 'COIDA', 'UIF', 'PSSPF', 'PUBLIC_LIABILITY', 'POPIA', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ComplianceObligationStatus" AS ENUM ('COMPLIANT', 'ATTENTION_REQUIRED', 'NON_COMPLIANT', 'PENDING_VERIFICATION', 'NOT_APPLICABLE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ComplianceRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StatutoryScheme" AS ENUM ('PAYE', 'UIF', 'SDL', 'PSSPF', 'NBCPSS', 'COIDA', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StatutoryPeriodStatus" AS ENUM ('CALCULATED', 'DECLARED', 'PARTIALLY_PAID', 'PAID', 'FAILED', 'OVERDUE', 'DISPUTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StatutoryPaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "LegalCaseType" AS ENUM ('CCMA', 'LABOUR_COURT', 'REGULATORY', 'EMPLOYEE_DISPUTE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "LegalCaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'AWAITING_OUTCOME', 'SETTLED', 'CLOSED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CashCommitmentCategory" AS ENUM ('PAYROLL', 'STATUTORY', 'CRITICAL_SUPPLIER', 'OPERATING_EXPENSE', 'REMEDIATION_PAYMENT', 'CAPEX', 'RELATED_PARTY_OR_INVESTMENT', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CashCommitmentFrequency" AS ENUM ('ONCE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "RemediationPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'DEFAULTED', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "RemediationFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TYPE "AlertSourceModule" ADD VALUE IF NOT EXISTS 'COMPLIANCE';

-- Drop any previous incorrect table structures safely
DROP TABLE IF EXISTS "EmploymentExit" CASCADE;
DROP TABLE IF EXISTS "CashPositionSnapshot" CASCADE;
DROP TABLE IF EXISTS "CashCommitment" CASCADE;
DROP TABLE IF EXISTS "ComplianceLegalCase" CASCADE;
DROP TABLE IF EXISTS "ComplianceRemediationPlan" CASCADE;
DROP TABLE IF EXISTS "EmployeeStatutoryContribution" CASCADE;
DROP TABLE IF EXISTS "StatutoryPayment" CASCADE;
DROP TABLE IF EXISTS "StatutoryRateConfig" CASCADE;
DROP TABLE IF EXISTS "StatutoryPeriod" CASCADE;
DROP TABLE IF EXISTS "ComplianceObligation" CASCADE;

-- CreateTable: ComplianceObligation
CREATE TABLE "ComplianceObligation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "ComplianceObligationType" NOT NULL,
    "title" TEXT NOT NULL,
    "authority" TEXT,
    "referenceNumber" TEXT,
    "status" "ComplianceObligationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "riskLevel" "ComplianceRiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "ownerUserId" TEXT,
    "effectiveDate" DATE,
    "dueDate" DATE,
    "expiryDate" DATE,
    "expectedAmount" DECIMAL(14,2),
    "paidAmount" DECIMAL(14,2),
    "notes" TEXT,
    "primaryEvidenceDocumentId" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "managementOverrideReason" TEXT,
    "managementOverrideById" TEXT,
    "managementOverrideAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ComplianceObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: StatutoryPeriod
CREATE TABLE "StatutoryPeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scheme" "StatutoryScheme" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "expectedEmployeeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expectedEmployerAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expectedOtherAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expectedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "declaredTotal" DECIMAL(14,2),
    "successfulPaidTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "varianceExpectedVsDeclared" DECIMAL(14,2),
    "outstandingAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "filedAt" TIMESTAMP(3),
    "status" "StatutoryPeriodStatus" NOT NULL DEFAULT 'CALCULATED',
    "externalReference" TEXT,
    "notes" TEXT,
    "sourcePayrollRunIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StatutoryPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable: StatutoryPayment
CREATE TABLE "StatutoryPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "statutoryPeriodId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentDate" DATE NOT NULL,
    "status" "StatutoryPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentReference" TEXT,
    "externalReference" TEXT,
    "failureReason" TEXT,
    "proofDocumentId" TEXT,
    "capturedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StatutoryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EmployeeStatutoryContribution
CREATE TABLE "EmployeeStatutoryContribution" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "statutoryPeriodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "scheme" "StatutoryScheme" NOT NULL,
    "pensionableOrFundEarnings" DECIMAL(14,2) NOT NULL,
    "employeeRate" DECIMAL(7,4) NOT NULL,
    "employerRate" DECIMAL(7,4) NOT NULL,
    "employeeAmount" DECIMAL(14,2) NOT NULL,
    "employerAmount" DECIMAL(14,2) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "rateConfigId" TEXT,
    "rateSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployeeStatutoryContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable: StatutoryRateConfig
CREATE TABLE "StatutoryRateConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scheme" "StatutoryScheme" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "employeeRate" DECIMAL(7,4),
    "employerRate" DECIMAL(7,4),
    "earningsCeiling" DECIMAL(14,2),
    "configuration" JSONB,
    "sourceReference" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StatutoryRateConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ComplianceRemediationPlan
CREATE TABLE "ComplianceRemediationPlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "obligationId" TEXT,
    "scheme" "StatutoryScheme",
    "title" TEXT NOT NULL,
    "originalBalance" DECIMAL(14,2) NOT NULL,
    "currentBalance" DECIMAL(14,2) NOT NULL,
    "installmentAmount" DECIMAL(14,2) NOT NULL,
    "frequency" "RemediationFrequency" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "nextPaymentDate" DATE,
    "status" "RemediationPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "externalAgreementReference" TEXT,
    "primaryEvidenceDocumentId" TEXT,
    "ownerUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ComplianceRemediationPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ComplianceLegalCase
CREATE TABLE "ComplianceLegalCase" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT,
    "caseNumber" TEXT NOT NULL,
    "caseType" "LegalCaseType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "riskLevel" "ComplianceRiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "status" "LegalCaseStatus" NOT NULL DEFAULT 'OPEN',
    "dateReceived" DATE NOT NULL,
    "nextEventDate" DATE,
    "assignedToId" TEXT,
    "nextAction" TEXT,
    "primaryDocumentId" TEXT,
    "outcome" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ComplianceLegalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CashCommitment
CREATE TABLE "CashCommitment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "CashCommitmentCategory" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "frequency" "CashCommitmentFrequency" NOT NULL DEFAULT 'MONTHLY',
    "dueDay" INTEGER,
    "protected" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "supplierOrPayee" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CashCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CashPositionSnapshot
CREATE TABLE "CashPositionSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "availableCash" DECIMAL(14,2) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedById" TEXT NOT NULL,
    "notes" TEXT,
    CONSTRAINT "CashPositionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EmploymentExit
CREATE TABLE "EmploymentExit" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "lastWorkingDate" DATE NOT NULL,
    "reason" TEXT,
    "siteId" TEXT,
    "redeployed" BOOLEAN NOT NULL DEFAULT false,
    "newSiteId" TEXT,
    "terminationStatus" TEXT NOT NULL DEFAULT 'pending',
    "uifDeclarationCompleted" BOOLEAN NOT NULL DEFAULT false,
    "certificateOfServiceCompleted" BOOLEAN NOT NULL DEFAULT false,
    "finalPayrollCompleted" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "processedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmploymentExit_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "ComplianceObligation_companyId_type_idx" ON "ComplianceObligation"("companyId", "type");
CREATE INDEX "ComplianceObligation_companyId_status_idx" ON "ComplianceObligation"("companyId", "status");
CREATE INDEX "ComplianceObligation_companyId_expiryDate_idx" ON "ComplianceObligation"("companyId", "expiryDate");
CREATE INDEX "ComplianceObligation_ownerUserId_idx" ON "ComplianceObligation"("ownerUserId");

CREATE INDEX "StatutoryPeriod_companyId_scheme_status_idx" ON "StatutoryPeriod"("companyId", "scheme", "status");
CREATE INDEX "StatutoryPeriod_companyId_dueDate_idx" ON "StatutoryPeriod"("companyId", "dueDate");
CREATE INDEX "StatutoryPeriod_companyId_status_idx" ON "StatutoryPeriod"("companyId", "status");
CREATE UNIQUE INDEX "StatutoryPeriod_companyId_scheme_periodStart_periodEnd_key" ON "StatutoryPeriod"("companyId", "scheme", "periodStart", "periodEnd");

CREATE INDEX "StatutoryPayment_companyId_statutoryPeriodId_idx" ON "StatutoryPayment"("companyId", "statutoryPeriodId");
CREATE INDEX "StatutoryPayment_companyId_status_idx" ON "StatutoryPayment"("companyId", "status");
CREATE INDEX "StatutoryPayment_statutoryPeriodId_status_idx" ON "StatutoryPayment"("statutoryPeriodId", "status");

CREATE INDEX "EmployeeStatutoryContribution_companyId_scheme_idx" ON "EmployeeStatutoryContribution"("companyId", "scheme");
CREATE INDEX "EmployeeStatutoryContribution_statutoryPeriodId_idx" ON "EmployeeStatutoryContribution"("statutoryPeriodId");
CREATE INDEX "EmployeeStatutoryContribution_employeeId_idx" ON "EmployeeStatutoryContribution"("employeeId");
CREATE UNIQUE INDEX "EmployeeStatutoryContribution_companyId_statutoryPeriodId_e_key" ON "EmployeeStatutoryContribution"("companyId", "statutoryPeriodId", "employeeId", "scheme");

CREATE INDEX "StatutoryRateConfig_companyId_scheme_effectiveFrom_idx" ON "StatutoryRateConfig"("companyId", "scheme", "effectiveFrom");
CREATE INDEX "StatutoryRateConfig_companyId_scheme_idx" ON "StatutoryRateConfig"("companyId", "scheme");

CREATE INDEX "ComplianceRemediationPlan_companyId_status_idx" ON "ComplianceRemediationPlan"("companyId", "status");
CREATE INDEX "ComplianceRemediationPlan_companyId_nextPaymentDate_idx" ON "ComplianceRemediationPlan"("companyId", "nextPaymentDate");
CREATE INDEX "ComplianceRemediationPlan_obligationId_idx" ON "ComplianceRemediationPlan"("obligationId");

CREATE INDEX "ComplianceLegalCase_companyId_status_idx" ON "ComplianceLegalCase"("companyId", "status");
CREATE INDEX "ComplianceLegalCase_companyId_riskLevel_idx" ON "ComplianceLegalCase"("companyId", "riskLevel");
CREATE INDEX "ComplianceLegalCase_companyId_nextEventDate_idx" ON "ComplianceLegalCase"("companyId", "nextEventDate");
CREATE INDEX "ComplianceLegalCase_employeeId_idx" ON "ComplianceLegalCase"("employeeId");
CREATE INDEX "ComplianceLegalCase_assignedToId_idx" ON "ComplianceLegalCase"("assignedToId");
CREATE UNIQUE INDEX "ComplianceLegalCase_companyId_caseNumber_key" ON "ComplianceLegalCase"("companyId", "caseNumber");

CREATE INDEX "CashCommitment_companyId_active_idx" ON "CashCommitment"("companyId", "active");
CREATE INDEX "CashCommitment_companyId_category_idx" ON "CashCommitment"("companyId", "category");

CREATE INDEX "CashPositionSnapshot_companyId_capturedAt_idx" ON "CashPositionSnapshot"("companyId", "capturedAt");

CREATE INDEX "EmploymentExit_companyId_idx" ON "EmploymentExit"("companyId");
CREATE INDEX "EmploymentExit_employeeId_idx" ON "EmploymentExit"("employeeId");
CREATE INDEX "EmploymentExit_companyId_terminationStatus_idx" ON "EmploymentExit"("companyId", "terminationStatus");

-- Foreign Keys
ALTER TABLE "ComplianceObligation" ADD CONSTRAINT "ComplianceObligation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComplianceObligation" ADD CONSTRAINT "ComplianceObligation_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplianceObligation" ADD CONSTRAINT "ComplianceObligation_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplianceObligation" ADD CONSTRAINT "ComplianceObligation_managementOverrideById_fkey" FOREIGN KEY ("managementOverrideById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StatutoryPeriod" ADD CONSTRAINT "StatutoryPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StatutoryPayment" ADD CONSTRAINT "StatutoryPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatutoryPayment" ADD CONSTRAINT "StatutoryPayment_statutoryPeriodId_fkey" FOREIGN KEY ("statutoryPeriodId") REFERENCES "StatutoryPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatutoryPayment" ADD CONSTRAINT "StatutoryPayment_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeStatutoryContribution" ADD CONSTRAINT "EmployeeStatutoryContribution_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeStatutoryContribution" ADD CONSTRAINT "EmployeeStatutoryContribution_statutoryPeriodId_fkey" FOREIGN KEY ("statutoryPeriodId") REFERENCES "StatutoryPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeStatutoryContribution" ADD CONSTRAINT "EmployeeStatutoryContribution_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeStatutoryContribution" ADD CONSTRAINT "EmployeeStatutoryContribution_rateConfigId_fkey" FOREIGN KEY ("rateConfigId") REFERENCES "StatutoryRateConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StatutoryRateConfig" ADD CONSTRAINT "StatutoryRateConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatutoryRateConfig" ADD CONSTRAINT "StatutoryRateConfig_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ComplianceRemediationPlan" ADD CONSTRAINT "ComplianceRemediationPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComplianceRemediationPlan" ADD CONSTRAINT "ComplianceRemediationPlan_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "ComplianceObligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplianceRemediationPlan" ADD CONSTRAINT "ComplianceRemediationPlan_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ComplianceLegalCase" ADD CONSTRAINT "ComplianceLegalCase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComplianceLegalCase" ADD CONSTRAINT "ComplianceLegalCase_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ComplianceLegalCase" ADD CONSTRAINT "ComplianceLegalCase_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashCommitment" ADD CONSTRAINT "CashCommitment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CashPositionSnapshot" ADD CONSTRAINT "CashPositionSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashPositionSnapshot" ADD CONSTRAINT "CashPositionSnapshot_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmploymentExit" ADD CONSTRAINT "EmploymentExit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmploymentExit" ADD CONSTRAINT "EmploymentExit_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmploymentExit" ADD CONSTRAINT "EmploymentExit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmploymentExit" ADD CONSTRAINT "EmploymentExit_newSiteId_fkey" FOREIGN KEY ("newSiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmploymentExit" ADD CONSTRAINT "EmploymentExit_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
`;

export async function applyComplianceTables(client) {
  console.log("[applyComplianceTables] Aligning exact compliance hub schema...");
  await client.query(complianceDdl);
  console.log("[applyComplianceTables] Compliance hub tables, columns, indexes, and FKs aligned.");
}
