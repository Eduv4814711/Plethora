-- AlterTable: make clientId optional on ClientQuote and add prospect/potential client fields
ALTER TABLE "ClientQuote" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "ClientQuote" ADD COLUMN "prospectName" TEXT;
ALTER TABLE "ClientQuote" ADD COLUMN "prospectEmail" TEXT;
ALTER TABLE "ClientQuote" ADD COLUMN "prospectPhone" TEXT;
ALTER TABLE "ClientQuote" ADD COLUMN "prospectAddress" TEXT;

-- CreateIndex
CREATE INDEX "ClientQuote_companyId_prospectName_idx" ON "ClientQuote"("companyId", "prospectName");
