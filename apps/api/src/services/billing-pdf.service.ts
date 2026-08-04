import { renderPdf } from "../lib/render-pdf.js";

export interface BillingPartyDetails {
  name: string;
  legalName?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  vatNumber?: string | null;
  registrationNumber?: string | null;
  logoUrl?: string | null;
}

export interface BillingDocumentLine {
  description: string;
  quantity: string;
  unitAmount: string;
  lineTotal: string;
}

export interface BillingDocumentTemplateData {
  docType: "QUOTE" | "TAX INVOICE";
  documentNumber: string;
  status: string;
  /** Rendered as a diagonal watermark for non-final states. */
  watermark?: string | null;
  issuer: BillingPartyDetails;
  billTo: BillingPartyDetails;
  issueDateLabel: string;
  issueDate: string;
  dueDateLabel: string;
  dueDate: string;
  reference?: string | null;
  notes?: string | null;
  currency: string;
  lines: BillingDocumentLine[];
  subtotal: string;
  discountAmount: string;
  vatRate: string;
  vatAmount: string;
  totalAmount: string;
  amountPaid?: string | null;
  amountDue?: string | null;
}

export interface BillingReceiptTemplateData {
  receiptNumber: string;
  receiptDate: string;
  issuer: BillingPartyDetails;
  billTo: BillingPartyDetails;
  currency: string;
  amount: string;
  paymentMethod?: string | null;
  referenceNumber?: string | null;
  invoiceNumber: string;
  invoiceTotal: string;
  invoicePaid: string;
  invoiceDue: string;
  issuedBy?: string | null;
}

export interface BillingStatementTransaction {
  date: string;
  reference: string | null;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface BillingStatementTemplateData {
  issuer: BillingPartyDetails;
  billTo: BillingPartyDetails;
  currency: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: string;
  closingBalance: string;
  transactions: BillingStatementTransaction[];
  aging: { current: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string };
}

/** Quote or tax invoice — one template, driven by `docType`. */
export function generateBillingDocumentPDF(data: BillingDocumentTemplateData): Promise<Buffer> {
  return renderPdf("billing-document.html", "__BILLING_DOC_DATA__", data);
}

export function generateBillingReceiptPDF(data: BillingReceiptTemplateData): Promise<Buffer> {
  return renderPdf("billing-receipt.html", "__BILLING_RECEIPT_DATA__", data);
}

export function generateBillingStatementPDF(data: BillingStatementTemplateData): Promise<Buffer> {
  return renderPdf("billing-statement.html", "__BILLING_STATEMENT_DATA__", data);
}
