"use client";

import { formatCurrency } from "@/lib/currency";

export interface TotalsPreview {
  subtotal: number;
  discount: number;
  vatAmount: number;
  total: number;
}

/**
 * Client-side preview of a document's totals. Mirrors the server formula
 * (VAT applied after discount, VAT-exclusive amounts) but the value returned
 * by the API always wins once the document is saved.
 */
export function computeTotalsPreview(
  lines: readonly { quantity: string | number; unitAmount: string | number }[],
  discountAmount: string | number,
  vatRate: string | number
): TotalsPreview {
  const subtotal = lines.reduce((sum, line) => {
    const lineTotal = (Number(line.quantity) || 0) * (Number(line.unitAmount) || 0);
    return sum + Math.round(lineTotal * 100) / 100;
  }, 0);
  const discount = Number(discountAmount) || 0;
  const taxable = subtotal - discount;
  const rawVat = (taxable * (Number(vatRate) || 0)) / 100;
  const vatAmount = Math.round(rawVat * 100) / 100;
  return { subtotal, discount, vatAmount, total: taxable + vatAmount };
}

export function DocumentTotals({
  totals,
  currency,
  vatRate,
  amountPaid,
  amountDue,
}: {
  totals: TotalsPreview;
  currency?: string;
  vatRate: string | number;
  amountPaid?: string | null;
  amountDue?: string | null;
}) {
  const row = (label: string, value: string, strong = false) => (
    <div
      className={
        strong
          ? "flex justify-between border-t border-security-navy-200 pt-2 text-base font-bold text-security-navy-900 dark:border-security-navy-600 dark:text-security-navy-100"
          : "flex justify-between text-sm text-security-navy-700 dark:text-security-navy-300"
      }
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="ml-auto w-full max-w-xs space-y-1.5">
      {row("Subtotal", formatCurrency(totals.subtotal, { currency }))}
      {totals.discount !== 0 && row("Discount", `-${formatCurrency(totals.discount, { currency })}`)}
      {row(`VAT (${vatRate}%)`, formatCurrency(totals.vatAmount, { currency }))}
      {row("Total", formatCurrency(totals.total, { currency }), true)}
      {amountPaid != null && row("Paid", formatCurrency(amountPaid, { currency }))}
      {amountDue != null && row("Balance due", formatCurrency(amountDue, { currency }))}
    </div>
  );
}
