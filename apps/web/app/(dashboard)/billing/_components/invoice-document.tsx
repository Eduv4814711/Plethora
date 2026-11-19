"use client";

import { clsx } from "clsx";
import { formatCurrency, formatQuantity } from "@/lib/currency";
import type { DocumentLine } from "@/lib/billing-api";
import { StatusBadge } from "./status-badge";

export interface DocumentHeaderInfo {
  type: "INVOICE" | "QUOTE";
  number: string;
  date: string;
  /** Due date (invoices) or valid until (quotes) */
  dueOrValidUntil: string;
  status: string;
  reference?: string | null;
  notes?: string | null;
}

export interface DocumentPartyInfo {
  companyName?: string;
  clientName: string;
  clientEmail?: string | null;
  clientAddress?: string | null;
  clientVatNumber?: string | null;
  clientPhone?: string | null;
}

export interface DocumentFinancialsInfo {
  subtotal: string;
  discountAmount: string;
  vatRate: string;
  vatAmount: string;
  totalAmount: string;
  amountPaid?: string | null;
  amountDue?: string | null;
}

export function InvoiceDocument({
  header,
  party,
  financials,
  lines,
  currency,
}: {
  header: DocumentHeaderInfo;
  party: DocumentPartyInfo;
  financials: DocumentFinancialsInfo;
  lines: DocumentLine[];
  currency?: string;
}) {
  const isInvoice = header.type === "INVOICE";
  const dueDateLabel = isInvoice ? "Due Date" : "Valid Until";
  const hasDiscount = Number(financials.discountAmount) !== 0;
  const paid = Number(financials.amountPaid ?? 0);
  const due = Number(financials.amountDue ?? financials.totalAmount);
  const total = Number(financials.totalAmount);
  const paidPct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;

  return (
    <div className="rounded-security-lg border border-security-navy-100 bg-white shadow-security-card">
      {/* Header band */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-security-navy-100 p-6">
        {/* Left: document identity */}
        <div>
          <div className="flex items-center gap-3">
            <p className="section-title">{header.type}</p>
            <StatusBadge status={header.status} />
          </div>
          <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-security-navy-900">
            #{header.number}
          </p>
          {header.reference && (
            <p className="mt-0.5 text-xs text-security-navy-500">
              Ref: {header.reference}
            </p>
          )}
        </div>

        {/* Right: dates */}
        <div className="flex flex-col gap-1 text-right">
          <div>
            <p className="label-text">Date</p>
            <p className="font-mono text-sm font-semibold tabular-nums text-security-navy-900">
              {new Date(header.date).toLocaleDateString("en-ZA", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
          <div>
            <p className="label-text">{dueDateLabel}</p>
            <p
              className={clsx(
                "font-mono text-sm font-semibold tabular-nums",
                isInvoice && new Date(header.dueOrValidUntil) < new Date() && due > 0
                  ? "text-red-700"
                  : "text-security-navy-900"
              )}
            >
              {new Date(header.dueOrValidUntil).toLocaleDateString("en-ZA", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
      </div>

      {/* From / To addresses */}
      <div className="grid grid-cols-1 gap-4 border-b border-security-navy-100 p-6 sm:grid-cols-2">
        <div>
          <p className="label-text mb-1.5">Billed By</p>
          <p className="font-semibold text-security-navy-900">
            {party.companyName ?? "Your Company"}
          </p>
        </div>
        <div>
          <p className="label-text mb-1.5">Billed To</p>
          <div className="space-y-0.5 text-sm">
            <p className="font-semibold text-security-navy-900">{party.clientName}</p>
            {party.clientAddress && (
              <p className="whitespace-pre-wrap text-security-navy-600">{party.clientAddress}</p>
            )}
            {party.clientEmail && (
              <p className="text-security-navy-600">{party.clientEmail}</p>
            )}
            {party.clientPhone && (
              <p className="text-security-navy-600">{party.clientPhone}</p>
            )}
            {party.clientVatNumber && (
              <p className="text-security-navy-500 text-xs">VAT: {party.clientVatNumber}</p>
            )}
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-security-navy-100 bg-security-navy-50 text-left">
              <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
                Description
              </th>
              <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
                Qty
              </th>
              <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
                Unit Price
              </th>
              <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-security-navy-50">
            {lines.map((line, i) => (
              <tr key={line.id ?? i} className="hover:bg-security-navy-50/50">
                <td className="px-6 py-3.5 text-sm text-security-navy-900">
                  {line.description}
                </td>
                <td className="px-4 py-3.5 text-right font-mono text-sm tabular-nums text-security-navy-700">
                  {formatQuantity(line.quantity)}
                </td>
                <td className="px-4 py-3.5 text-right font-mono text-sm tabular-nums text-security-navy-700">
                  {formatCurrency(line.unitAmount, { currency })}
                </td>
                <td className="px-6 py-3.5 text-right font-mono text-sm font-semibold tabular-nums text-security-navy-900">
                  {formatCurrency(line.lineTotal, { currency })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals block */}
      <div className="border-t border-security-navy-100 p-6">
        <div className="ml-auto w-full max-w-xs space-y-2">
          <div className="flex justify-between text-sm text-security-navy-700">
            <span>Subtotal</span>
            <span className="font-mono tabular-nums">
              {formatCurrency(financials.subtotal, { currency })}
            </span>
          </div>
          {hasDiscount && (
            <div className="flex justify-between text-sm text-security-navy-700">
              <span>Discount</span>
              <span className="font-mono tabular-nums text-security-emerald-700">
                -{formatCurrency(financials.discountAmount, { currency })}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm text-security-navy-700">
            <span>VAT ({financials.vatRate}%)</span>
            <span className="font-mono tabular-nums">
              {formatCurrency(financials.vatAmount, { currency })}
            </span>
          </div>
          <div className="flex justify-between border-t border-security-navy-200 pt-2 text-base font-bold text-security-navy-900">
            <span>Total</span>
            <span className="font-mono tabular-nums">
              {formatCurrency(financials.totalAmount, { currency })}
            </span>
          </div>

          {/* Payment progress — only for invoices that have payment data */}
          {financials.amountPaid !== null && financials.amountPaid !== undefined && (
            <>
              <div className="flex justify-between pt-1 text-sm text-security-navy-700">
                <span>Paid</span>
                <span className="font-mono tabular-nums text-security-emerald-700">
                  {formatCurrency(financials.amountPaid, { currency })}
                </span>
              </div>
              {/* Progress bar */}
              {total > 0 && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-security-navy-100">
                  <div
                    className="h-full rounded-full bg-security-emerald-500 transition-all duration-500"
                    style={{ width: `${paidPct.toFixed(1)}%` }}
                  />
                </div>
              )}
              <div
                className={clsx(
                  "flex justify-between text-sm font-semibold",
                  due > 0 ? "text-red-700" : "text-security-emerald-700"
                )}
              >
                <span>Balance Due</span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(financials.amountDue ?? "0", { currency })}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Notes */}
      {header.notes && (
        <div className="border-t border-security-navy-100 bg-security-navy-50 p-6">
          <p className="label-text mb-1.5">Notes</p>
          <p className="whitespace-pre-wrap text-sm text-security-navy-700">{header.notes}</p>
        </div>
      )}
    </div>
  );
}
