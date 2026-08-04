import { z } from "zod";
import { Prisma } from "@prisma/client";

/** Parses an ISO date string, returning undefined when invalid. */
export function parseDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function toDec(value: unknown): Prisma.Decimal {
  if (value == null) return new Prisma.Decimal(0);
  if (typeof value === "number") return new Prisma.Decimal(value);
  return new Prisma.Decimal(String(value));
}

/** Money crosses the wire as a string so float precision is never involved. */
export function decimalJson(value: Prisma.Decimal): string {
  return value.toString();
}

const money = z.union([z.number(), z.string()]);

export const lineSchema = z.object({
  siteId: z.string().min(1).optional().nullable(),
  description: z.string().min(1).max(500),
  quantity: money.default(1),
  unitAmount: money,
});

export type LineInput = z.infer<typeof lineSchema>;

const documentBase = {
  clientId: z.string().min(1),
  reference: z.string().max(200).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  discountAmount: money.optional().default(0),
  vatRate: money.optional().default(15),
  items: z.array(lineSchema).min(1),
};

export const createQuoteSchema = z.object({
  ...documentBase,
  quoteNumber: z.string().max(50).optional(),
  quoteDate: z.string().min(1),
  validUntil: z.string().min(1),
});

export const updateQuoteSchema = z.object({
  clientId: z.string().min(1).optional(),
  reference: z.string().max(200).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  discountAmount: money.optional(),
  vatRate: money.optional(),
  items: z.array(lineSchema).min(1).optional(),
  quoteDate: z.string().optional(),
  validUntil: z.string().optional(),
});

export const createInvoiceSchema = z.object({
  ...documentBase,
  invoiceNumber: z.string().max(50).optional(),
  invoiceDate: z.string().min(1),
  /** Omit to derive from the client's paymentTermsDays. */
  dueDate: z.string().optional(),
});

export const updateInvoiceSchema = z.object({
  clientId: z.string().min(1).optional(),
  reference: z.string().max(200).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  discountAmount: money.optional(),
  vatRate: money.optional(),
  items: z.array(lineSchema).min(1).optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
});

export const declineQuoteSchema = z.object({
  reason: z.string().max(1000).optional(),
});

export const recordPaymentSchema = z.object({
  paymentDate: z.string().min(1),
  amount: money,
  paymentMethod: z.enum(["eft", "cash", "card", "debit_order", "other"]).optional(),
  referenceNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const statementQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

/** Serializes a quote/invoice row, converting every Decimal field to a string. */
export function serializeDocument<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(out)) {
    if (value instanceof Prisma.Decimal) out[key] = decimalJson(value);
  }
  if (Array.isArray(out.items)) {
    out.items = (out.items as Record<string, unknown>[]).map((item) => serializeDocument(item));
  }
  if (Array.isArray(out.payments)) {
    out.payments = (out.payments as Record<string, unknown>[]).map((p) => serializeDocument(p));
  }
  if (out.receipt && typeof out.receipt === "object") {
    out.receipt = serializeDocument(out.receipt as Record<string, unknown>);
  }
  return out as T;
}
