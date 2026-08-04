import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  generateBillingDocumentPDF,
  generateBillingReceiptPDF,
  generateBillingStatementPDF,
  type BillingPartyDetails,
} from "../../services/billing-pdf.service.js";
import { getClientStatement, startOfUtcDay } from "../../services/client-billing.service.js";
import {
  BRANDING_COMPANY_SELECT,
  currencyFrom,
  issuerFrom,
  safeFilenamePart,
} from "../../services/company-branding.js";
import { parseDate, statementQuerySchema } from "./billing.schemas.js";

type ClientRow = {
  name: string;
  email: string | null;
  phone: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
  vatNumber: string | null;
  registrationNumber: string | null;
};

function billToFrom(client: ClientRow): BillingPartyDetails {
  return {
    name: client.name,
    address: client.billingAddress,
    email: client.billingEmail ?? client.email,
    phone: client.phone,
    vatNumber: client.vatNumber,
    registrationNumber: client.registrationNumber,
  };
}

function dateOnly(value: Date): string {
  return startOfUtcDay(new Date(value)).toISOString().slice(0, 10);
}

function dec(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

/** Watermark for anything that is not a live, payable document. */
function watermarkFor(status: string, isQuote: boolean): string | null {
  if (status === "draft") return "DRAFT";
  if (status === "cancelled") return "CANCELLED";
  if (status === "declined") return "DECLINED";
  if (status === "expired") return "EXPIRED";
  if (status === "paid") return "PAID";
  if (isQuote && status === "accepted") return "ACCEPTED";
  return null;
}

export async function registerBillingPdfRoutes(
  app: FastifyInstance,
  exportProtect: preHandlerHookHandler[]
) {
  async function loadCompany(companyId: string) {
    return prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: BRANDING_COMPANY_SELECT,
    });
  }

  app.get("/quotes/:id/pdf", { preHandler: exportProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };

    const quote = await prisma.clientQuote.findFirst({
      where: { id, companyId },
      include: { client: true, items: { orderBy: { sortOrder: "asc" } } },
    });
    if (!quote) return reply.code(404).send({ error: "Quote not found" });

    const company = await loadCompany(companyId);
    const pdf = await generateBillingDocumentPDF({
      docType: "QUOTE",
      documentNumber: quote.quoteNumber,
      status: quote.status,
      watermark: watermarkFor(quote.status, true),
      issuer: issuerFrom(company),
      billTo: billToFrom(quote.client),
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

    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${quote.quoteNumber}.pdf"`)
      .send(pdf);
  });

  app.get("/invoices/:id/pdf", { preHandler: exportProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };

    const invoice = await prisma.clientInvoice.findFirst({
      where: { id, companyId },
      include: {
        client: true,
        items: { orderBy: { sortOrder: "asc" } },
        payments: { select: { amount: true } },
      },
    });
    if (!invoice) return reply.code(404).send({ error: "Invoice not found" });

    let paid = new Prisma.Decimal(0);
    for (const payment of invoice.payments) paid = paid.add(payment.amount);

    const company = await loadCompany(companyId);
    const pdf = await generateBillingDocumentPDF({
      docType: "TAX INVOICE",
      documentNumber: invoice.invoiceNumber,
      status: invoice.status,
      watermark: watermarkFor(invoice.status, false),
      issuer: issuerFrom(company),
      billTo: billToFrom(invoice.client),
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

    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${invoice.invoiceNumber}.pdf"`)
      .send(pdf);
  });

  app.get("/receipts/:id/pdf", { preHandler: exportProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };

    const receipt = await prisma.clientReceipt.findFirst({
      where: { id, companyId },
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
    if (!receipt) return reply.code(404).send({ error: "Receipt not found" });

    const invoice = receipt.payment.invoice;
    let paid = new Prisma.Decimal(0);
    for (const payment of invoice.payments) paid = paid.add(payment.amount);

    const company = await loadCompany(companyId);
    const pdf = await generateBillingReceiptPDF({
      receiptNumber: receipt.receiptNumber,
      receiptDate: dateOnly(receipt.receiptDate),
      issuer: issuerFrom(company),
      billTo: billToFrom(receipt.payment.client),
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

    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${receipt.receiptNumber}.pdf"`)
      .send(pdf);
  });

  app.get("/clients/:clientId/statement/pdf", { preHandler: exportProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { clientId } = request.params as { clientId: string };
    const parsed = statementQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: "from and to dates are required" });
    }
    const from = parseDate(parsed.data.from);
    const to = parseDate(parsed.data.to);
    if (!from || !to) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid from or to date" });
    }
    if (from > to) {
      return reply.code(400).send({ error: "Validation error", message: "from must be on or before to" });
    }

    const client = await prisma.client.findFirst({ where: { id: clientId, companyId } });
    if (!client) return reply.code(404).send({ error: "Client not found" });

    const [company, statement] = await Promise.all([
      loadCompany(companyId),
      getClientStatement(companyId, clientId, from, to),
    ]);

    const periodStart = dateOnly(from);
    const periodEnd = dateOnly(to);

    const pdf = await generateBillingStatementPDF({
      issuer: issuerFrom(company),
      billTo: billToFrom(client),
      currency: currencyFrom(company),
      periodStart,
      periodEnd,
      openingBalance: dec(statement.openingBalance),
      closingBalance: dec(statement.closingBalance),
      transactions: statement.transactions.map((t) => ({
        date: t.date instanceof Date ? dateOnly(t.date) : String(t.date),
        reference: t.reference,
        description: t.description,
        debit: dec(t.debit),
        credit: dec(t.credit),
        balance: dec(t.balance),
      })),
      aging: {
        current: dec(statement.aging.current),
        d1_30: dec(statement.aging.d1_30),
        d31_60: dec(statement.aging.d31_60),
        d61_90: dec(statement.aging.d61_90),
        d90_plus: dec(statement.aging.d90_plus),
      },
    });

    const safeName = safeFilenamePart(client.name, "client");
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="Statement ${safeName} ${periodStart} to ${periodEnd}.pdf"`)
      .send(pdf);
  });
}
