-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ClientEntityType" AS ENUM (
    'PRIVATE_COMPANY',
    'CLOSE_CORPORATION',
    'TRUST',
    'PARTNERSHIP',
    'SOLE_PROPRIETOR',
    'NATURAL_PERSON',
    'GOVERNMENT',
    'MUNICIPALITY',
    'BODY_CORPORATE_HOA',
    'NPO',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ClientOnboardingStatus" AS ENUM (
    'DRAFT',
    'IN_REVIEW',
    'READY',
    'ACTIVE',
    'SUSPENDED',
    'CLOSED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ClientContactType" AS ENUM (
    'PRIMARY',
    'OPERATIONS',
    'BILLING',
    'EMERGENCY',
    'PROCUREMENT',
    'LEGAL',
    'INFORMATION_OFFICER',
    'AUTHORISED_SIGNATORY',
    'REPORT_RECIPIENT',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ClientRelationshipType" AS ENUM (
    'DIRECTOR',
    'MEMBER',
    'TRUSTEE',
    'PARTNER',
    'BENEFICIAL_OWNER',
    'AUTHORISED_SIGNATORY',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ClientContractStatus" AS ENUM (
    'DRAFT',
    'ACTIVE',
    'PENDING_RENEWAL',
    'EXPIRED',
    'TERMINATED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ContractRenewalType" AS ENUM (
    'FIXED_TERM',
    'AUTO_RENEW_MONTHLY',
    'AUTO_RENEW_ANNUAL',
    'MONTH_TO_MONTH',
    'EVERGREEN'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "OperatorAgreementStatus" AS ENUM (
    'NOT_APPLICABLE',
    'REQUIRED',
    'SENT',
    'SIGNED',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable: Client
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "legalName" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tradingName" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "entityType" "ClientEntityType";
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "taxNumber" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "registeredAddress" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "onboardingStatus" "ClientOnboardingStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);

-- AlterTable: ManagedDocument
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "clientContractId" TEXT;

-- CreateTable: ClientContact
CREATE TABLE IF NOT EXISTS "ClientContact" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT,
  "jobTitle" TEXT,
  "department" TEXT,
  "email" TEXT,
  "mobile" TEXT,
  "contactType" "ClientContactType" NOT NULL DEFAULT 'OTHER',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ClientRelatedParty
CREATE TABLE IF NOT EXISTS "ClientRelatedParty" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "relationshipType" "ClientRelationshipType" NOT NULL,
  "ownershipPercent" DECIMAL(5,2),
  "isAuthorisedSignatory" BOOLEAN NOT NULL DEFAULT false,
  "authorityReference" TEXT,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientRelatedParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ClientContract
CREATE TABLE IF NOT EXISTS "ClientContract" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "contractNumber" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "ClientContractStatus" NOT NULL DEFAULT 'ACTIVE',
  "signedDate" DATE,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "noticePeriodDays" INTEGER NOT NULL DEFAULT 30,
  "renewalType" "ContractRenewalType" NOT NULL DEFAULT 'FIXED_TERM',
  "autoRenew" BOOLEAN NOT NULL DEFAULT false,
  "scopeSummary" TEXT,
  "serviceTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ClientContractSite
CREATE TABLE IF NOT EXISTS "ClientContractSite" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientContractSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ClientDataProcessingProfile
CREATE TABLE IF NOT EXISTS "ClientDataProcessingProfile" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "responsiblePartyName" TEXT,
  "informationOfficerName" TEXT,
  "informationOfficerEmail" TEXT,
  "informationOfficerPhone" TEXT,
  "processingPurposes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "dataCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "hasCrossBorderTransfer" BOOLEAN NOT NULL DEFAULT false,
  "crossBorderDetails" TEXT,
  "operatorAgreementStatus" "OperatorAgreementStatus" NOT NULL DEFAULT 'REQUIRED',
  "operatorAgreementSignedDate" DATE,
  "operatorAgreementDocumentId" TEXT,
  "privacyNoticeProvided" BOOLEAN NOT NULL DEFAULT false,
  "privacyNoticeDate" DATE,
  "retentionPolicyNotes" TEXT,
  "securityMeasuresNotes" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientDataProcessingProfile_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "ManagedDocument_clientContractId_idx" ON "ManagedDocument"("clientContractId");

CREATE INDEX IF NOT EXISTS "ClientContact_companyId_idx" ON "ClientContact"("companyId");
CREATE INDEX IF NOT EXISTS "ClientContact_clientId_idx" ON "ClientContact"("clientId");
CREATE INDEX IF NOT EXISTS "ClientContact_companyId_clientId_idx" ON "ClientContact"("companyId", "clientId");
CREATE INDEX IF NOT EXISTS "ClientContact_companyId_isPrimary_idx" ON "ClientContact"("companyId", "isPrimary");

CREATE INDEX IF NOT EXISTS "ClientRelatedParty_companyId_idx" ON "ClientRelatedParty"("companyId");
CREATE INDEX IF NOT EXISTS "ClientRelatedParty_clientId_idx" ON "ClientRelatedParty"("clientId");

CREATE UNIQUE INDEX IF NOT EXISTS "ClientContract_companyId_contractNumber_key" ON "ClientContract"("companyId", "contractNumber");
CREATE INDEX IF NOT EXISTS "ClientContract_companyId_idx" ON "ClientContract"("companyId");
CREATE INDEX IF NOT EXISTS "ClientContract_clientId_idx" ON "ClientContract"("clientId");
CREATE INDEX IF NOT EXISTS "ClientContract_companyId_status_idx" ON "ClientContract"("companyId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "ClientContractSite_contractId_siteId_key" ON "ClientContractSite"("contractId", "siteId");
CREATE INDEX IF NOT EXISTS "ClientContractSite_companyId_idx" ON "ClientContractSite"("companyId");
CREATE INDEX IF NOT EXISTS "ClientContractSite_contractId_idx" ON "ClientContractSite"("contractId");
CREATE INDEX IF NOT EXISTS "ClientContractSite_siteId_idx" ON "ClientContractSite"("siteId");

CREATE UNIQUE INDEX IF NOT EXISTS "ClientDataProcessingProfile_clientId_key" ON "ClientDataProcessingProfile"("clientId");
CREATE INDEX IF NOT EXISTS "ClientDataProcessingProfile_companyId_idx" ON "ClientDataProcessingProfile"("companyId");
CREATE INDEX IF NOT EXISTS "ClientDataProcessingProfile_clientId_idx" ON "ClientDataProcessingProfile"("clientId");

-- Foreign Keys
DO $$ BEGIN
  ALTER TABLE "ManagedDocument"
    ADD CONSTRAINT "ManagedDocument_clientContractId_fkey"
    FOREIGN KEY ("clientContractId") REFERENCES "ClientContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientContact"
    ADD CONSTRAINT "ClientContact_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientContact"
    ADD CONSTRAINT "ClientContact_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientRelatedParty"
    ADD CONSTRAINT "ClientRelatedParty_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientRelatedParty"
    ADD CONSTRAINT "ClientRelatedParty_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientContract"
    ADD CONSTRAINT "ClientContract_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientContract"
    ADD CONSTRAINT "ClientContract_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientContractSite"
    ADD CONSTRAINT "ClientContractSite_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientContractSite"
    ADD CONSTRAINT "ClientContractSite_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "ClientContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientContractSite"
    ADD CONSTRAINT "ClientContractSite_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientDataProcessingProfile"
    ADD CONSTRAINT "ClientDataProcessingProfile_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientDataProcessingProfile"
    ADD CONSTRAINT "ClientDataProcessingProfile_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
