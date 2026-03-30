-- AlterTable
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "passwordSetupRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "passwordSetupTokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "passwordSetupTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "passwordSetupTokenConsumedAt" TIMESTAMP(3);
