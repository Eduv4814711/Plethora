-- Academy Management Phase 2 — Finance (invoices, payments, receipts)

CREATE TYPE "AcademyInvoiceStatus" AS ENUM (
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled'
);

CREATE TYPE "AcademyPaymentVerificationStatus" AS ENUM ('pending', 'verified', 'rejected');

CREATE TABLE "AcademyInvoice" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "enrolmentId" TEXT,
  "invoiceNumber" TEXT NOT NULL,
  "invoiceDate" DATE NOT NULL,
  "dueDate" DATE NOT NULL,
  "subtotal" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "discountAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "status" "AcademyInvoiceStatus" NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AcademyInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcademyInvoiceLine" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unitAmount" DECIMAL(12, 2) NOT NULL,
  "lineTotal" DECIMAL(12, 2) NOT NULL,

  CONSTRAINT "AcademyInvoiceLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcademyPayment" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "paymentDate" DATE NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "paymentMethod" TEXT,
  "referenceNumber" TEXT,
  "proofDocumentId" TEXT,
  "verificationStatus" "AcademyPaymentVerificationStatus" NOT NULL DEFAULT 'pending',
  "verifiedByUserId" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "rejectionRemarks" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AcademyPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcademyReceipt" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "receiptDate" DATE NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "issuedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AcademyReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AcademyInvoice_companyId_invoiceNumber_key" ON "AcademyInvoice" ("companyId", "invoiceNumber");
CREATE INDEX "AcademyInvoice_companyId_idx" ON "AcademyInvoice" ("companyId");
CREATE INDEX "AcademyInvoice_studentId_idx" ON "AcademyInvoice" ("studentId");
CREATE INDEX "AcademyInvoice_enrolmentId_idx" ON "AcademyInvoice" ("enrolmentId");
CREATE INDEX "AcademyInvoice_status_idx" ON "AcademyInvoice" ("status");
CREATE INDEX "AcademyInvoice_dueDate_idx" ON "AcademyInvoice" ("dueDate");

CREATE INDEX "AcademyInvoiceLine_invoiceId_idx" ON "AcademyInvoiceLine" ("invoiceId");

CREATE INDEX "AcademyPayment_companyId_idx" ON "AcademyPayment" ("companyId");
CREATE INDEX "AcademyPayment_invoiceId_idx" ON "AcademyPayment" ("invoiceId");
CREATE INDEX "AcademyPayment_studentId_idx" ON "AcademyPayment" ("studentId");
CREATE INDEX "AcademyPayment_verificationStatus_idx" ON "AcademyPayment" ("verificationStatus");

CREATE UNIQUE INDEX "AcademyReceipt_paymentId_key" ON "AcademyReceipt" ("paymentId");
CREATE UNIQUE INDEX "AcademyReceipt_companyId_receiptNumber_key" ON "AcademyReceipt" ("companyId", "receiptNumber");
CREATE INDEX "AcademyReceipt_companyId_idx" ON "AcademyReceipt" ("companyId");
CREATE INDEX "AcademyReceipt_issuedByUserId_idx" ON "AcademyReceipt" ("issuedByUserId");

ALTER TABLE "AcademyInvoice"
  ADD CONSTRAINT "AcademyInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AcademyInvoice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AcademyInvoice_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "Enrolment" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AcademyInvoiceLine"
  ADD CONSTRAINT "AcademyInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "AcademyInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AcademyPayment"
  ADD CONSTRAINT "AcademyPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AcademyPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "AcademyInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AcademyPayment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AcademyPayment_proofDocumentId_fkey" FOREIGN KEY ("proofDocumentId") REFERENCES "StudentDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AcademyPayment_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AcademyReceipt"
  ADD CONSTRAINT "AcademyReceipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AcademyReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "AcademyPayment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AcademyReceipt_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
