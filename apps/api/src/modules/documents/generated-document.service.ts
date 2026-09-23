import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createDocumentVersion } from "./document-version.service.js";
import { createDocumentRecord } from "./documents.service.js";
import {
  generateBillingDocumentPDF,
  generateBillingReceiptPDF,
  type BillingPartyDetails,
} from "../../services/billing-pdf.service.js";
import {
  BRANDING_COMPANY_SELECT,
  currencyFrom,
  issuerFrom,
} from "../../services/company-branding.js";
import { startOfUtcDay } from "../../services/client-billing.service.js";
import { generatePayslipPDFFromTemplate, type PayslipTemplateData } from "../../services/payslip-pdf.service.js";
import { storage } from "../../lib/storage.js";
import { randomUUID } from "node:crypto";

function dateOnly(value: Date): string {
  return startOfUtcDay(new Date(value)).toISOString().slice(0, 10);
}

function dec(value: Prisma.Decimal | number | null | undefined): string {
  if (value === null || value === undefined) return "0.00";
  if (typeof value === "number") return value.toFixed(2);
  return value.toFixed(2);
}

function watermarkFor(status: string, isQuote: boolean): string | null {
  if (status === "draft") return "DRAFT";
  if (status === "cancelled") return "CANCELLED";
  if (status === "declined") return "DECLINED";
  if (status === "expired") return "EXPIRED";
  if (status === "paid") return "PAID";
  if (isQuote && status === "accepted") return "ACCEPTED";
  return null;
}

export function getSourceEntityInfo(
  sourceModule?: string | null,
  sourceEntityType?: string | null,
  sourceEntityId?: string | null
): { editSourceUrl?: string; sourceLabel: string; isGenerated: boolean } {
  if (!sourceModule || !sourceEntityType || !sourceEntityId) {
    return { sourceLabel: "Uploaded File", isGenerated: false };
  }

  const moduleUpper = sourceModule.toUpperCase();
  const entityUpper = sourceEntityType.toUpperCase();

  if (moduleUpper.includes("BILLING") || entityUpper.includes("INVOICE")) {
    if (entityUpper.includes("QUOTE")) {
      return {
        editSourceUrl: `/payroll/billing?tab=quotes&quoteId=${sourceEntityId}`,
        sourceLabel: "Billing Quotation",
        isGenerated: true,
      };
    }
    if (entityUpper.includes("RECEIPT")) {
      return {
        editSourceUrl: `/payroll/billing?tab=receipts&receiptId=${sourceEntityId}`,
        sourceLabel: "Payment Receipt",
        isGenerated: true,
      };
    }
    return {
      editSourceUrl: `/payroll/billing?tab=invoices&invoiceId=${sourceEntityId}`,
      sourceLabel: "Tax Invoice",
      isGenerated: true,
    };
  }

  if (moduleUpper.includes("PAYROLL") || entityUpper.includes("PAYSLIP") || entityUpper.includes("PAYROLL")) {
    return {
      editSourceUrl: `/payroll?runId=${sourceEntityId}`,
      sourceLabel: "Payroll / Payslip Record",
      isGenerated: true,
    };
  }

  if (moduleUpper.includes("ROSTER")) {
    return {
      editSourceUrl: `/rostering`,
      sourceLabel: "Workforce Roster",
      isGenerated: true,
    };
  }

  if (moduleUpper.includes("ATTENDANCE") || entityUpper.includes("TIMESHEET")) {
    return {
      editSourceUrl: `/attendance`,
      sourceLabel: "Site Timesheet",
      isGenerated: true,
    };
  }

  return {
    sourceLabel: `${sourceModule} · ${sourceEntityType}`,
    isGenerated: true,
  };
}

/**
 * Regenerate the PDF for a system-generated document directly from current database records,
 * creating a new DocumentVersion.
 */
export async function regenerateDocumentPdf(
  companyId: string,
  documentId: string,
  userId: string
): Promise<{ version: any; document: any }> {
  const doc = await prisma.managedDocument.findFirst({
    where: { id: documentId, companyId },
  });
  if (!doc) {
    throw new Error("DOCUMENT_NOT_FOUND");
  }

  if (doc.origin !== "GENERATED") {
    throw new Error("NOT_A_GENERATED_DOCUMENT: Only system-generated documents can be regenerated from database state.");
  }

  const { sourceModule, sourceEntityType, sourceEntityId } = doc;
  if (!sourceModule || !sourceEntityType || !sourceEntityId) {
    throw new Error("MISSING_SOURCE_METADATA: This document does not have valid source entity references.");
  }

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: BRANDING_COMPANY_SELECT,
  });

  let pdfBuffer: Buffer;
  let fileName = doc.fileName || `${doc.title}.pdf`;

  const entityUpper = sourceEntityType.toUpperCase();

  if (entityUpper.includes("INVOICE")) {
    const invoice = await prisma.clientInvoice.findFirst({
      where: { id: sourceEntityId, companyId },
      include: {
        client: true,
        items: { orderBy: { sortOrder: "asc" } },
        payments: { select: { amount: true } },
      },
    });
    if (!invoice) throw new Error("SOURCE_RECORD_NOT_FOUND: The source invoice could not be found.");

    let paid = new Prisma.Decimal(0);
    for (const payment of invoice.payments) paid = paid.add(payment.amount);

    pdfBuffer = await generateBillingDocumentPDF({
      docType: "TAX INVOICE",
      documentNumber: invoice.invoiceNumber,
      status: invoice.status,
      watermark: watermarkFor(invoice.status, false),
      issuer: issuerFrom(company),
      billTo: invoice.client
        ? {
            name: invoice.client.name,
            address: invoice.client.billingAddress,
            email: invoice.client.billingEmail ?? invoice.client.email,
            phone: invoice.client.phone,
            vatNumber: invoice.client.vatNumber,
            registrationNumber: invoice.client.registrationNumber,
          }
        : { name: "Client" },
      issueDateLabel: "Invoice date",
      issueDate: dateOnly(invoice.invoiceDate),
      dueDateLabel: "Due date",
      dueDate: dateOnly(invoice.dueDate),
      reference: invoice.reference,
      notes: invoice.notes,
      currency: currencyFrom(company),
      lines: invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unitAmount: dec(item.unitAmount),
        lineTotal: dec(item.lineTotal),
      })),
      subtotal: dec(invoice.subtotal),
      discountAmount: dec(invoice.discountAmount),
      vatRate: invoice.vatRate.toString(),
      vatAmount: dec(invoice.vatAmount),
      totalAmount: dec(invoice.totalAmount),
      amountPaid: dec(paid),
      amountDue: dec(invoice.totalAmount.sub(paid)),
    });
    fileName = `${invoice.invoiceNumber}.pdf`;
  } else if (entityUpper.includes("QUOTE")) {
    const quote = await prisma.clientQuote.findFirst({
      where: { id: sourceEntityId, companyId },
      include: { client: true, items: { orderBy: { sortOrder: "asc" } } },
    });
    if (!quote) throw new Error("SOURCE_RECORD_NOT_FOUND: The source quote could not be found.");

    pdfBuffer = await generateBillingDocumentPDF({
      docType: "QUOTE",
      documentNumber: quote.quoteNumber,
      status: quote.status,
      watermark: watermarkFor(quote.status, true),
      issuer: issuerFrom(company),
      billTo: quote.client
        ? {
            name: quote.client.name,
            address: quote.client.billingAddress,
            email: quote.client.billingEmail ?? quote.client.email,
            phone: quote.client.phone,
            vatNumber: quote.client.vatNumber,
            registrationNumber: quote.client.registrationNumber,
          }
        : { name: quote.prospectName || "Valued Client" },
      issueDateLabel: "Date",
      issueDate: dateOnly(quote.quoteDate),
      dueDateLabel: "Valid until",
      dueDate: dateOnly(quote.validUntil),
      reference: quote.reference,
      notes: quote.notes,
      currency: currencyFrom(company),
      lines: quote.items.map((item) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unitAmount: dec(item.unitAmount),
        lineTotal: dec(item.lineTotal),
      })),
      subtotal: dec(quote.subtotal),
      discountAmount: dec(quote.discountAmount),
      vatRate: quote.vatRate.toString(),
      vatAmount: dec(quote.vatAmount),
      totalAmount: dec(quote.totalAmount),
    });
    fileName = `${quote.quoteNumber}.pdf`;
  } else if (entityUpper.includes("RECEIPT")) {
    const receipt = await prisma.clientReceipt.findFirst({
      where: { id: sourceEntityId, companyId },
      include: {
        payment: {
          include: {
            client: true,
            invoice: { include: { payments: { select: { amount: true } } } },
          },
        },
        issuedBy: { select: { name: true } },
      },
    });
    if (!receipt) throw new Error("SOURCE_RECORD_NOT_FOUND: The source receipt could not be found.");

    const invoice = receipt.payment.invoice;
    let paid = new Prisma.Decimal(0);
    for (const payment of invoice.payments) paid = paid.add(payment.amount);

    pdfBuffer = await generateBillingReceiptPDF({
      receiptNumber: receipt.receiptNumber,
      receiptDate: dateOnly(receipt.receiptDate),
      issuer: issuerFrom(company),
      billTo: receipt.payment.client ? { name: receipt.payment.client.name } : { name: "Client" },
      currency: currencyFrom(company),
      amount: dec(receipt.amount),
      paymentMethod: receipt.payment.paymentMethod,
      referenceNumber: receipt.payment.referenceNumber,
      invoiceNumber: invoice.invoiceNumber,
      invoiceTotal: dec(invoice.totalAmount),
      invoicePaid: dec(paid),
      invoiceDue: dec(invoice.totalAmount.sub(paid)),
      issuedBy: receipt.issuedBy?.name ?? null,
    });
    fileName = `${receipt.receiptNumber}.pdf`;
  } else {
    throw new Error(`UNSUPPORTED_REGENERATION_TYPE: Regeneration for entity type ${sourceEntityType} is not yet supported.`);
  }

  return createDocumentVersion({
    companyId,
    documentId,
    userId,
    fileBuffer: pdfBuffer,
    fileName,
    mimeType: "application/pdf",
    changeSummary: "Regenerated from latest Plethora database records",
    sourceType: "SYSTEM_REGENERATION",
  });
}
