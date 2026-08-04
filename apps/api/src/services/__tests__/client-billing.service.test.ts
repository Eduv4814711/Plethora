import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  canTransitionInvoice,
  canTransitionQuote,
  classifyAgingBucket,
  computeDocumentTotals,
  computeLineTotal,
  formatDocumentNumber,
  highestNumberForPrefix,
  isInvoiceEditable,
  isQuoteEditable,
} from "../client-billing.service.js";

describe("computeLineTotal", () => {
  it("multiplies quantity by unit amount", () => {
    expect(computeLineTotal(3, "1500.00").toString()).toBe("4500");
  });

  it("supports fractional quantities for part-month billing", () => {
    expect(computeLineTotal("1.5", "12500.00").toString()).toBe("18750");
  });

  it("rounds half-up at the line so lines sum to the printed subtotal", () => {
    expect(computeLineTotal("3", "10.005").toString()).toBe("30.02");
  });
});

describe("computeDocumentTotals", () => {
  const lines = [{ lineTotal: "1000.00" }, { lineTotal: "500.00" }];

  it("applies the default 15% VAT to the full subtotal when there is no discount", () => {
    const totals = computeDocumentTotals(lines, 0, "15.00");
    expect(totals.subtotal.toString()).toBe("1500");
    expect(totals.vatAmount.toString()).toBe("225");
    expect(totals.totalAmount.toString()).toBe("1725");
  });

  it("applies VAT after the discount, not before", () => {
    const totals = computeDocumentTotals(lines, "500.00", "15.00");
    expect(totals.subtotal.toString()).toBe("1500");
    expect(totals.discountAmount.toString()).toBe("500");
    // VAT is on 1000, not on 1500
    expect(totals.vatAmount.toString()).toBe("150");
    expect(totals.totalAmount.toString()).toBe("1150");
  });

  it("supports a zero VAT rate", () => {
    const totals = computeDocumentTotals(lines, 0, 0);
    expect(totals.vatAmount.toString()).toBe("0");
    expect(totals.totalAmount.toString()).toBe("1500");
  });

  it("supports a custom VAT rate", () => {
    const totals = computeDocumentTotals([{ lineTotal: "200.00" }], 0, "12.50");
    expect(totals.vatAmount.toString()).toBe("25");
    expect(totals.totalAmount.toString()).toBe("225");
  });

  it("rounds VAT half-up to the cent", () => {
    // 100.10 * 15% = 15.015 -> 15.02
    const totals = computeDocumentTotals([{ lineTotal: "100.10" }], 0, "15.00");
    expect(totals.vatAmount.toString()).toBe("15.02");
  });

  it("holds the invariant subtotal - discount + vat === total across many inputs", () => {
    for (let i = 0; i < 200; i += 1) {
      const lineTotal = (Math.round(Math.random() * 5_000_00) / 100).toFixed(2);
      const discount = (Math.round(Math.random() * 100_00) / 100).toFixed(2);
      const rate = [0, 15, 12.5, 7.25][i % 4];

      const totals = computeDocumentTotals([{ lineTotal }], discount, rate);
      const expected = totals.subtotal.sub(totals.discountAmount).add(totals.vatAmount);
      expect(totals.totalAmount.toString()).toBe(expected.toString());
    }
  });

  it("sums the already-rounded line totals", () => {
    const totals = computeDocumentTotals(
      [{ lineTotal: "0.01" }, { lineTotal: "0.02" }, { lineTotal: "0.03" }],
      0,
      0
    );
    expect(totals.subtotal.toString()).toBe("0.06");
  });

  it("accepts Prisma.Decimal inputs", () => {
    const totals = computeDocumentTotals([{ lineTotal: new Prisma.Decimal("99.99") }], 0, "15.00");
    expect(totals.subtotal.toString()).toBe("99.99");
  });
});

describe("document numbering", () => {
  it("starts at 0001 when nothing exists yet", () => {
    expect(formatDocumentNumber("QT", highestNumberForPrefix([], "QT") + 1)).toBe("QT-0001");
  });

  it("continues from the highest existing number, ignoring gaps", () => {
    const existing = ["INV-0001", "INV-0004", "INV-0002"];
    expect(highestNumberForPrefix(existing, "INV")).toBe(4);
  });

  it("ignores numbers belonging to a different prefix", () => {
    expect(highestNumberForPrefix(["QT-0009", "INV-0002"], "INV")).toBe(2);
  });

  it("ignores free-form numbers that do not match the pattern", () => {
    expect(highestNumberForPrefix(["INV-2026/07", "legacy-3", "INV-0007"], "INV")).toBe(7);
  });

  it("matches the prefix case-insensitively", () => {
    expect(highestNumberForPrefix(["inv-0012"], "INV")).toBe(12);
  });

  it("pads to four digits and beyond", () => {
    expect(formatDocumentNumber("RCT", 7)).toBe("RCT-0007");
    expect(formatDocumentNumber("RCT", 12345)).toBe("RCT-12345");
  });
});

describe("quote state machine", () => {
  it("allows a draft to be issued or cancelled", () => {
    expect(canTransitionQuote("draft", "issued")).toBe(true);
    expect(canTransitionQuote("draft", "cancelled")).toBe(true);
  });

  it("does not allow a draft to jump straight to accepted", () => {
    expect(canTransitionQuote("draft", "accepted")).toBe(false);
  });

  it("allows an issued quote to be decided", () => {
    expect(canTransitionQuote("issued", "accepted")).toBe(true);
    expect(canTransitionQuote("issued", "declined")).toBe(true);
    expect(canTransitionQuote("issued", "expired")).toBe(true);
  });

  it("treats decided quotes as terminal", () => {
    for (const from of ["accepted", "declined", "expired", "cancelled"] as const) {
      for (const to of ["draft", "issued", "accepted", "declined"] as const) {
        expect(canTransitionQuote(from, to)).toBe(false);
      }
    }
  });

  it("only allows editing while draft", () => {
    expect(isQuoteEditable("draft")).toBe(true);
    expect(isQuoteEditable("issued")).toBe(false);
    expect(isQuoteEditable("accepted")).toBe(false);
  });
});

describe("invoice state machine", () => {
  it("allows a draft to be issued or cancelled", () => {
    expect(canTransitionInvoice("draft", "issued")).toBe(true);
    expect(canTransitionInvoice("draft", "cancelled")).toBe(true);
  });

  it("does not allow a draft to be marked paid directly", () => {
    expect(canTransitionInvoice("draft", "paid")).toBe(false);
  });

  it("allows payment-driven progression", () => {
    expect(canTransitionInvoice("issued", "partially_paid")).toBe(true);
    expect(canTransitionInvoice("partially_paid", "paid")).toBe(true);
    expect(canTransitionInvoice("overdue", "paid")).toBe(true);
  });

  it("treats paid and cancelled as terminal", () => {
    for (const to of ["draft", "issued", "partially_paid", "overdue"] as const) {
      expect(canTransitionInvoice("paid", to)).toBe(false);
      expect(canTransitionInvoice("cancelled", to)).toBe(false);
    }
  });

  it("only allows editing while draft", () => {
    expect(isInvoiceEditable("draft")).toBe(true);
    expect(isInvoiceEditable("issued")).toBe(false);
    expect(isInvoiceEditable("paid")).toBe(false);
  });
});

describe("classifyAgingBucket", () => {
  const asOf = new Date("2026-08-02T00:00:00.000Z");

  it("treats an invoice due today as current", () => {
    expect(classifyAgingBucket(new Date("2026-08-02T00:00:00.000Z"), asOf)).toBe("current");
  });

  it("treats an invoice due in the future as current", () => {
    expect(classifyAgingBucket(new Date("2026-09-01T00:00:00.000Z"), asOf)).toBe("current");
  });

  it("buckets one day overdue into 1-30", () => {
    expect(classifyAgingBucket(new Date("2026-08-01T00:00:00.000Z"), asOf)).toBe("d1_30");
  });

  it("keeps exactly 30 days overdue in 1-30 and 31 days in 31-60", () => {
    expect(classifyAgingBucket(new Date("2026-07-03T00:00:00.000Z"), asOf)).toBe("d1_30");
    expect(classifyAgingBucket(new Date("2026-07-02T00:00:00.000Z"), asOf)).toBe("d31_60");
  });

  it("keeps exactly 60 days in 31-60 and 61 days in 61-90", () => {
    expect(classifyAgingBucket(new Date("2026-06-03T00:00:00.000Z"), asOf)).toBe("d31_60");
    expect(classifyAgingBucket(new Date("2026-06-02T00:00:00.000Z"), asOf)).toBe("d61_90");
  });

  it("moves past 90 days into the 90+ bucket", () => {
    expect(classifyAgingBucket(new Date("2026-05-04T00:00:00.000Z"), asOf)).toBe("d61_90");
    expect(classifyAgingBucket(new Date("2026-05-03T00:00:00.000Z"), asOf)).toBe("d90_plus");
  });
});
