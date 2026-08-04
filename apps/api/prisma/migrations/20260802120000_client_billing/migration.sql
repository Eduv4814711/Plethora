-- Client billing: quotes, invoices, payments, receipts.
-- Purely additive: new enums, new tables, and nullable/defaulted columns on Client and Company.
-- No existing column, table, index or constraint is altered or dropped.

-- CreateEnum
CREATE TYPE "ClientQuoteStatus" AS ENUM ('draft', 'issued', 'accepted', 'declined', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "ClientInvoiceStatus" AS ENUM ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "billingAddress" TEXT,
ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "vatNumber" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "vatNumber" TEXT;

-- CreateTable
CREATE TABLE "ClientQuote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "quoteDate" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "ClientQuoteStatus" NOT NULL DEFAULT 'draft',
    "issuedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientQuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "siteId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unitAmount" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ClientQuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "quoteId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "ClientInvoiceStatus" NOT NULL DEFAULT 'draft',
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "siteId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unitAmount" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ClientInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "paymentDate" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" TEXT,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientReceipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "receiptDate" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "issuedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientQuote_companyId_status_idx" ON "ClientQuote"("companyId", "status");

-- CreateIndex
CREATE INDEX "ClientQuote_clientId_idx" ON "ClientQuote"("clientId");

-- CreateIndex
CREATE INDEX "ClientQuote_companyId_quoteDate_idx" ON "ClientQuote"("companyId", "quoteDate");

-- CreateIndex
CREATE UNIQUE INDEX "ClientQuote_companyId_quoteNumber_key" ON "ClientQuote"("companyId", "quoteNumber");

-- CreateIndex
CREATE INDEX "ClientQuoteLine_quoteId_idx" ON "ClientQuoteLine"("quoteId");

-- CreateIndex
CREATE INDEX "ClientQuoteLine_siteId_idx" ON "ClientQuoteLine"("siteId");

-- CreateIndex
CREATE INDEX "ClientInvoice_companyId_status_idx" ON "ClientInvoice"("companyId", "status");

-- CreateIndex
CREATE INDEX "ClientInvoice_clientId_idx" ON "ClientInvoice"("clientId");

-- CreateIndex
CREATE INDEX "ClientInvoice_quoteId_idx" ON "ClientInvoice"("quoteId");

-- CreateIndex
CREATE INDEX "ClientInvoice_companyId_dueDate_idx" ON "ClientInvoice"("companyId", "dueDate");

-- CreateIndex
CREATE INDEX "ClientInvoice_companyId_invoiceDate_idx" ON "ClientInvoice"("companyId", "invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "ClientInvoice_companyId_invoiceNumber_key" ON "ClientInvoice"("companyId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "ClientInvoiceLine_invoiceId_idx" ON "ClientInvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "ClientInvoiceLine_siteId_idx" ON "ClientInvoiceLine"("siteId");

-- CreateIndex
CREATE INDEX "ClientPayment_companyId_paymentDate_idx" ON "ClientPayment"("companyId", "paymentDate");

-- CreateIndex
CREATE INDEX "ClientPayment_invoiceId_idx" ON "ClientPayment"("invoiceId");

-- CreateIndex
CREATE INDEX "ClientPayment_clientId_idx" ON "ClientPayment"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientReceipt_paymentId_key" ON "ClientReceipt"("paymentId");

-- CreateIndex
CREATE INDEX "ClientReceipt_companyId_receiptDate_idx" ON "ClientReceipt"("companyId", "receiptDate");

-- CreateIndex
CREATE UNIQUE INDEX "ClientReceipt_companyId_receiptNumber_key" ON "ClientReceipt"("companyId", "receiptNumber");

-- AddForeignKey
ALTER TABLE "ClientQuote" ADD CONSTRAINT "ClientQuote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientQuote" ADD CONSTRAINT "ClientQuote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientQuote" ADD CONSTRAINT "ClientQuote_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientQuoteLine" ADD CONSTRAINT "ClientQuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ClientQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientQuoteLine" ADD CONSTRAINT "ClientQuoteLine_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ClientQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoiceLine" ADD CONSTRAINT "ClientInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ClientInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoiceLine" ADD CONSTRAINT "ClientInvoiceLine_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPayment" ADD CONSTRAINT "ClientPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPayment" ADD CONSTRAINT "ClientPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ClientInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPayment" ADD CONSTRAINT "ClientPayment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPayment" ADD CONSTRAINT "ClientPayment_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReceipt" ADD CONSTRAINT "ClientReceipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReceipt" ADD CONSTRAINT "ClientReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "ClientPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReceipt" ADD CONSTRAINT "ClientReceipt_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
