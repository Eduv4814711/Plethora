-- CreateTable
CREATE TABLE "SiteBillingConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT,
    "siteId" TEXT,
    "quotePrefix" TEXT,
    "quoteStartingNumber" INTEGER NOT NULL DEFAULT 1,
    "quoteNextNumber" INTEGER NOT NULL DEFAULT 1,
    "quotePadding" INTEGER NOT NULL DEFAULT 4,
    "invoicePrefix" TEXT,
    "invoiceStartingNumber" INTEGER NOT NULL DEFAULT 1,
    "invoiceNextNumber" INTEGER NOT NULL DEFAULT 1,
    "invoicePadding" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteBillingConfig_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ClientQuote" ADD COLUMN "siteId" TEXT;

-- AlterTable
ALTER TABLE "ClientInvoice" ADD COLUMN "siteId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SiteBillingConfig_siteId_key" ON "SiteBillingConfig"("siteId");

-- CreateIndex
CREATE INDEX "SiteBillingConfig_companyId_idx" ON "SiteBillingConfig"("companyId");

-- CreateIndex
CREATE INDEX "SiteBillingConfig_clientId_idx" ON "SiteBillingConfig"("clientId");

-- CreateIndex
CREATE INDEX "ClientQuote_siteId_idx" ON "ClientQuote"("siteId");

-- CreateIndex
CREATE INDEX "ClientInvoice_siteId_idx" ON "ClientInvoice"("siteId");

-- AddForeignKey
ALTER TABLE "SiteBillingConfig" ADD CONSTRAINT "SiteBillingConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteBillingConfig" ADD CONSTRAINT "SiteBillingConfig_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteBillingConfig" ADD CONSTRAINT "SiteBillingConfig_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientQuote" ADD CONSTRAINT "ClientQuote_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
