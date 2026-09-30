import { describe, expect, it } from "vitest";
import {
  createInvoiceSchema,
  createQuoteSchema,
  lineSchema,
  recordPaymentSchema,
  updateInvoiceSchema,
  updateQuoteSchema,
} from "../billing.schemas.js";

describe("lineSchema validation", () => {
  it("accepts valid line item", () => {
    const res = lineSchema.safeParse({
      description: "Armed response",
      quantity: 2,
      unitAmount: "1500.00",
    });
    expect(res.success).toBe(true);
  });

  it("rejects zero or negative quantity", () => {
    const zero = lineSchema.safeParse({
      description: "Guard",
      quantity: 0,
      unitAmount: "1000",
    });
    expect(zero.success).toBe(false);

    const negative = lineSchema.safeParse({
      description: "Guard",
      quantity: -1,
      unitAmount: "1000",
    });
    expect(negative.success).toBe(false);
  });

  it("rejects negative unit price", () => {
    const res = lineSchema.safeParse({
      description: "Guard",
      quantity: 1,
      unitAmount: "-500",
    });
    expect(res.success).toBe(false);
  });

  it("accepts zero unit price (e.g. complementary service)", () => {
    const res = lineSchema.safeParse({
      description: "Complimentary patrol",
      quantity: 1,
      unitAmount: "0.00",
    });
    expect(res.success).toBe(true);
  });

  it("rejects empty description", () => {
    const res = lineSchema.safeParse({
      description: "   ",
      quantity: 1,
      unitAmount: "100",
    });
    expect(res.success).toBe(false);
  });
});

describe("documentBase validation (discounts & VAT)", () => {
  it("rejects negative discount amount on quote creation", () => {
    const res = createQuoteSchema.safeParse({
      clientId: "client-1",
      quoteDate: "2026-09-30",
      validUntil: "2026-10-30",
      discountAmount: -50,
      items: [{ description: "Guard", quantity: 1, unitAmount: 100 }],
    });
    expect(res.success).toBe(false);
  });

  it("rejects negative or >100 VAT rate", () => {
    const negativeVat = createInvoiceSchema.safeParse({
      clientId: "client-1",
      invoiceDate: "2026-09-30",
      vatRate: -5,
      items: [{ description: "Guard", quantity: 1, unitAmount: 100 }],
    });
    expect(negativeVat.success).toBe(false);

    const overVat = createInvoiceSchema.safeParse({
      clientId: "client-1",
      invoiceDate: "2026-09-30",
      vatRate: 105,
      items: [{ description: "Guard", quantity: 1, unitAmount: 100 }],
    });
    expect(overVat.success).toBe(false);
  });

  it("rejects invoice without line items", () => {
    const res = createInvoiceSchema.safeParse({
      clientId: "client-1",
      invoiceDate: "2026-09-30",
      items: [],
    });
    expect(res.success).toBe(false);
  });

  it("rejects payment of zero or negative amount", () => {
    const zeroPay = recordPaymentSchema.safeParse({
      paymentDate: "2026-09-30",
      amount: 0,
    });
    expect(zeroPay.success).toBe(false);

    const negPay = recordPaymentSchema.safeParse({
      paymentDate: "2026-09-30",
      amount: -100,
    });
    expect(negPay.success).toBe(false);

    const validPay = recordPaymentSchema.safeParse({
      paymentDate: "2026-09-30",
      amount: "2500.50",
      paymentMethod: "eft",
    });
    expect(validPay.success).toBe(true);
  });
});
