-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LeaveDocumentKind" AS ENUM ('SICK_NOTE', 'STUDY_PROOF', 'FAMILY_RESPONSIBILITY_PROOF', 'PARENTAL_PROOF', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "decisionReason" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "LeaveSupportingDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "kind" "LeaveDocumentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileReference" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveSupportingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeaveSupportingDocument_companyId_leaveRequestId_idx" ON "LeaveSupportingDocument"("companyId", "leaveRequestId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LeaveSupportingDocument" ADD CONSTRAINT "LeaveSupportingDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LeaveSupportingDocument" ADD CONSTRAINT "LeaveSupportingDocument_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
