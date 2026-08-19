-- Maker-checker on user access. An access manager proposes a change; the company owner
-- approves or declines it. Additive only: User.capabilities keeps its current meaning
-- (the grant in force) and is still written by the same code path — only the trigger
-- moves from "manager saved" to "owner approved".

-- CreateEnum
CREATE TYPE "AccessChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccessChangeKind" AS ENUM ('CREATE_USER', 'UPDATE_ACCESS', 'DEACTIVATE_USER');

-- CreateTable
CREATE TABLE "AccessChangeRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "AccessChangeKind" NOT NULL,
    "status" "AccessChangeStatus" NOT NULL DEFAULT 'PENDING',
    "targetUserId" TEXT,
    "targetLabel" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "beforeState" JSONB NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessChangeRequest_companyId_status_requestedAt_idx" ON "AccessChangeRequest"("companyId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "AccessChangeRequest_companyId_targetUserId_status_idx" ON "AccessChangeRequest"("companyId", "targetUserId", "status");

-- CreateIndex
CREATE INDEX "AccessChangeRequest_requestedById_status_idx" ON "AccessChangeRequest"("requestedById", "status");

-- AddForeignKey
ALTER TABLE "AccessChangeRequest" ADD CONSTRAINT "AccessChangeRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessChangeRequest" ADD CONSTRAINT "AccessChangeRequest_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessChangeRequest" ADD CONSTRAINT "AccessChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessChangeRequest" ADD CONSTRAINT "AccessChangeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
