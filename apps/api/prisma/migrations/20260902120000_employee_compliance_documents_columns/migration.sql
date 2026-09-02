-- Add employee document and compliance columns to ManagedDocument table
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "documentCategory" TEXT;
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "documentNumber" TEXT;
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "issuingAuthority" TEXT;
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "issueDate" TIMESTAMP(3);
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "doesNotExpire" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "isSensitive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION';
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "verifiedById" TEXT;
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "replacedByDocumentId" TEXT;
ALTER TABLE "ManagedDocument" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Add indexes
CREATE INDEX IF NOT EXISTS "ManagedDocument_companyId_documentCategory_idx" ON "ManagedDocument"("companyId", "documentCategory");
CREATE INDEX IF NOT EXISTS "ManagedDocument_companyId_verificationStatus_idx" ON "ManagedDocument"("companyId", "verificationStatus");

-- Add foreign key for verifiedById if it doesn't already exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ManagedDocument_verifiedById_fkey'
    ) THEN
        ALTER TABLE "ManagedDocument" ADD CONSTRAINT "ManagedDocument_verifiedById_fkey"
            FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
