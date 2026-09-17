"use client";

import { clsx } from "clsx";
import { formatCurrency } from "@/lib/currency";
import type { Payment } from "@/lib/billing-api";

const METHOD_LABELS: Record<string, string> = {
  eft: "EFT",
  cash: "Cash",
  card: "Card",
  debit_order: "Debit Order",
  cheque: "Cheque",
};

function methodLabel(method: string | null | undefined): string {
  if (!method) return "Payment";
  return METHOD_LABELS[method] ?? method;
}

export function PaymentTimeline({
  payments,
  currency,
  onReverse,
  canReverse = false,
  reversingId = null,
}: {
  payments: Payment[];
  currency?: string;
  onReverse?: (paymentId: string) => void;
  canReverse?: boolean;
  reversingId?: string | null;
}) {
  if (payments.length === 0) {
    return (
      <p className="py-4 text-sm text-security-navy-500">No payments recorded yet.</p>
    );
  }

  return (
    <ol className="relative space-y-0 border-l border-security-navy-200 pl-6">
      {payments.map((payment, i) => {
        const isLast = i === payments.length - 1;
        const isReversing = reversingId === payment.id;
        return (
          <li key={payment.id} className="relative pb-6 last:pb-0">
            {/* Timeline dot */}
            <span
              className={clsx(
                "absolute -left-[21px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-white",
                isLast ? "bg-security-emerald-500" : "bg-security-navy-300"
              )}
            />

            <div className="rounded-security-lg border border-security-navy-100 bg-white p-3 shadow-security-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-security-navy-900">
                    {methodLabel(payment.paymentMethod)}
                    {payment.referenceNumber && (
                      <span className="ml-2 font-mono text-xs font-normal text-security-navy-500">
                        Ref: {payment.referenceNumber}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-security-navy-500">
                    {new Date(payment.paymentDate).toLocaleDateString("en-ZA", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                    {payment.receipt?.receiptNumber && (
                      <> · Receipt #{payment.receipt.receiptNumber}</>
                    )}
                  </p>
                  {payment.notes && (
                    <p className="mt-1 text-xs text-security-navy-500 italic">{payment.notes}</p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <p className="font-mono text-sm font-bold text-security-emerald-700 tabular-nums">
                    +{formatCurrency(payment.amount, { currency })}
                  </p>
                  {canReverse && onReverse && (
                    <button
                      type="button"
                      onClick={() => onReverse(payment.id)}
                      disabled={isReversing}
                      className="text-[10px] font-semibold uppercase tracking-wide text-red-600 hover:underline disabled:opacity-50"
                    >
                      {isReversing ? "Reversing…" : "Reverse"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
