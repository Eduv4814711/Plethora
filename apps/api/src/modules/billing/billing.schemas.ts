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

const positiveMoney = money.refine(
  (val) => {
    try {
      const dec = toDec(val);
      return !dec.isNaN() && dec.gt(0);
    } catch {
      return false;
    }
  },
  { message: "Must be a positive number greater than zero" }
);

const nonNegativeMoney = money.refine(
  (val) => {
    try {
      const dec = toDec(val);
      return !dec.isNaN() && dec.gte(0);
    } catch {
      return false;
    }
  },
  { message: "Must be zero or greater" }
);

const vatRateSchema = money.refine(
  (val) => {
    try {
      const dec = toDec(val);
      return !dec.isNaN() && dec.gte(0) && dec.lte(100);
    } catch {
      return false;
    }
  },
  { message: "VAT rate must be between 0% and 100%" }
);

export const lineSchema = z.object({
  siteId: z.string().min(1).optional().nullable(),
  description: z.string().trim().min(1, "Description cannot be empty").max(500),
  quantity: positiveMoney.default(1),
  unitAmount: nonNegativeMoney,
});

export type LineInput = z.infer<typeof lineSchema>;

const documentBase = {
  clientId: z.string().min(1, "Client is required"),
  reference: z.string().max(200).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  discountAmount: nonNegativeMoney.optional().default(0),
  vatRate: vatRateSchema.optional().default(15),
  items: z.array(lineSchema).min(1, "At least one line item is required"),
};

export const createQuoteSchema = z
  .object({
    clientId: z.string().min(1).optional().nullable(),
    siteId: z.string().min(1).optional().nullable(),
    prospectName: z.string().max(250).optional().nullable(),
    prospectEmail: z.string().max(250).optional().nullable(),
    prospectPhone: z.string().max(50).optional().nullable(),
    prospectAddress: z.string().max(1000).optional().nullable(),
    reference: z.string().max(200).optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
    discountAmount: nonNegativeMoney.optional().default(0),
    vatRate: vatRateSchema.optional().default(15),
    items: z.array(lineSchema).min(1, "At least one line item is required"),
    quoteNumber: z.string().max(50).optional().nullable(),
    quoteDate: z.string().min(1),
    validUntil: z.string().min(1),
  })
  .refine((data) => Boolean(data.clientId?.trim() || data.prospectName?.trim()), {
    message: "Either an existing client or a business name for a potential client is required",
    path: ["clientId"],
  });

export const updateQuoteSchema = z.object({
  clientId: z.string().min(1).optional().nullable(),
  siteId: z.string().min(1).optional().nullable(),
  prospectName: z.string().max(250).optional().nullable(),
  prospectEmail: z.string().max(250).optional().nullable(),
  prospectPhone: z.string().max(50).optional().nullable(),
  prospectAddress: z.string().max(1000).optional().nullable(),
  reference: z.string().max(200).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  discountAmount: nonNegativeMoney.optional(),
  vatRate: vatRateSchema.optional(),
  items: z.array(lineSchema).min(1, "At least one line item is required").optional(),
  quoteDate: z.string().optional(),
  validUntil: z.string().optional(),
});

export const createInvoiceSchema = z.object({
  ...documentBase,
  siteId: z.string().min(1).optional().nullable(),
  invoiceNumber: z.string().max(50).optional().nullable(),
  invoiceDate: z.string().min(1),
  /** Omit to derive from the client's paymentTermsDays. */
  dueDate: z.string().optional(),
});

export const updateInvoiceSchema = z.object({
  clientId: z.string().min(1).optional(),
  siteId: z.string().min(1).optional().nullable(),
  reference: z.string().max(200).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  discountAmount: nonNegativeMoney.optional(),
  vatRate: vatRateSchema.optional(),
  items: z.array(lineSchema).min(1, "At least one line item is required").optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
});

export const declineQuoteSchema = z.object({
  reason: z.string().max(1000).optional(),
});

export const recordPaymentSchema = z.object({
  paymentDate: z.string().min(1),
  amount: positiveMoney,
  paymentMethod: z.enum(["eft", "cash", "card", "debit_order", "cheque", "other"]).optional(),
  referenceNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const statementQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const configureSiteBillingRateSchema = z.object({
  ratePerGuard: z.coerce.number().min(0, "Rate per guard must be 0 or greater").max(10_000_000),
  billingMethod: z.literal("PER_GUARD").default("PER_GUARD"),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveFrom must be YYYY-MM-DD"),
  effectiveTo: z
    .preprocess(
      (val) => (val === "" || val === undefined ? null : val),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveTo must be YYYY-MM-DD").nullable()
    )
    .optional(),
  notes: z
    .preprocess(
      (val) => (val === "" || val === undefined ? null : val),
      z.string().max(2000).nullable()
    )
    .optional(),
});

export const configureSiteBillingNumberingSchema = z.object({
  quotePrefix: z
    .preprocess(
      (val) => (val === "" || val === undefined ? null : val),
      z.string().max(30).nullable()
    )
    .optional(),
  quoteStartingNumber: z.coerce.number().int().min(1).default(1),
  quoteNextNumber: z.coerce.number().int().min(1).optional(),
  quotePadding: z.coerce.number().int().min(1).max(10).default(4),
  invoicePrefix: z
    .preprocess(
      (val) => (val === "" || val === undefined ? null : val),
      z.string().max(30).nullable()
    )
    .optional(),
  invoiceStartingNumber: z.coerce.number().int().min(1).default(1),
  invoiceNextNumber: z.coerce.number().int().min(1).optional(),
  invoicePadding: z.coerce.number().int().min(1).max(10).default(4),
});

export const previewNumberQuerySchema = z.object({
  kind: z.enum(["quote", "invoice"]),
  clientId: z.string().optional().nullable(),
  siteId: z.string().optional().nullable(),
});

export const convertQuoteSchema = z.object({
  invoiceNumber: z.string().max(50).optional().nullable(),
  siteId: z.string().min(1).optional().nullable(),
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
