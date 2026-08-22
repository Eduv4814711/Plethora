"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { hasCapability } from "@/lib/permissions";
import {
  cancelInvoice,
  downloadInvoicePdf,
  downloadReceiptPdf,
  getInvoice,
  issueInvoice,
  recordPayment,
  reversePayment,
  type Invoice,
} from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency, formatQuantity } from "@/lib/currency";
import { StatusBadge } from "../../_components/status-badge";

const METHODS = [
  { value: "eft", label: "EFT" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "debit_order", label: "Debit order" },
  { value: "other", label: "Other" },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function InvoiceDetailPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const params = useParams<{ id: string }>();
  const currency = currencyFromSettings(settings);

  const canApprove = user ? hasCapability(user, "/payroll/billing", "approve") : false;
  const canCreate = user ? hasCapability(user, "/payroll/billing", "create") : false;
  const canDelete = user ? hasCapability(user, "/payroll/billing", "delete") : false;
  const canEdit = user ? hasCapability(user, "/payroll/billing", "edit") : false;
  const canExport = user ? hasCapability(user, "/payroll/billing", "export") : false;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showPayment, setShowPayment] = useState(false);
  const [paymentDate, setPaymentDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("eft");
  const [paymentRef, setPaymentRef] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setInvoice(await getInvoice(token, params.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoice");
    } finally {
      setLoading(false);
    }
  }, [token, params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !invoice) return;
    if (!amount || Number(amount) <= 0) {
      setError("Enter a payment amount greater than zero.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordPayment(token, invoice.id, {
        paymentDate,
        amount,
        paymentMethod: method,
        referenceNumber: paymentRef || null,
      });
      setAmount("");
      setPaymentRef("");
      setShowPayment(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="h-72 animate-pulse rounded-security-lg bg-security-navy-100 dark:bg-security-navy-700" aria-label="Loading invoice" />;
  }

  if (!invoice) {
    return (
      <main className="space-y-4">
        <Link href="/payroll/billing/invoices" className="text-sm font-medium text-security-navy-700 hover:underline">
          ← Back to invoices
        </Link>
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error ?? "Invoice not found"}
        </p>
      </main>
    );
  }

  const payments = invoice.payments ?? [];
  const settled = invoice.status === "paid" || invoice.status === "cancelled";

  return (
    <main className="animate-fade-in space-y-5 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/payroll/billing/invoices"
            className="inline-flex min-h-11 items-center text-sm font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
          >
            ← Back to invoices
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-security-navy-900 dark:text-security-navy-100">{invoice.invoiceNumber}</h1>
            <StatusBadge status={invoice.status} />
          </div>
          <p className="mt-1 text-sm text-security-navy-500 dark:text-security-navy-400">
            {invoice.client?.name} · issued {invoice.invoiceDate?.slice(0, 10)} · due {invoice.dueDate?.slice(0, 10)}
            {invoice.quote ? ` · from quote ${invoice.quote.quoteNumber}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canExport && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => downloadInvoicePdf(token!, invoice.id, `${invoice.invoiceNumber}.pdf`))}
              className="btn-secondary min-h-11 disabled:opacity-50"
            >
              Download PDF
            </button>
          )}
          {canEdit && invoice.status !== "draft" && !settled && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => cancelInvoice(token!, invoice.id))}
              className="btn-secondary min-h-11 disabled:opacity-50"
            >
              Cancel invoice
            </button>
          )}
          {canApprove && invoice.status === "draft" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => issueInvoice(token!, invoice.id))}
              className="btn-primary min-h-11 disabled:opacity-50"
            >
              Issue invoice
            </button>
          )}
          {canCreate && !settled && invoice.status !== "draft" && (
            <button
              type="button"
              onClick={() => setShowPayment((o) => !o)}
              className="btn-primary min-h-11"
            >
              {showPayment ? "Close" : "Record payment"}
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {invoice.status === "draft" && (
        <p className="rounded-lg border border-security-amber-200 bg-security-amber-50 px-3 py-2 text-sm text-security-amber-900 dark:border-security-amber-900 dark:bg-security-amber-950/30 dark:text-security-amber-200">
          This invoice is still a draft. Issue it before recording payments — drafts are not sent to the client.
        </p>
      )}

      {showPayment && canCreate && (
        <form
          onSubmit={submitPayment}
          className="grid gap-3 rounded-security-lg border border-security-navy-100 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5 dark:border-security-navy-700 dark:bg-security-navy-900"
        >
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">Date</span>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="input-modern mt-1 w-full"
              required
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">Amount</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder={invoice.amountDue ?? "0.00"}
              className="input-modern mt-1 w-full text-right"
              required
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">Method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="input-modern mt-1 w-full">
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">Reference</span>
            <input
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
              placeholder="Optional"
              className="input-modern mt-1 w-full"
            />
          </label>
          <div className="flex items-end">
            <button type="submit" disabled={busy} className="btn-primary min-h-11 w-full disabled:opacity-50">
              {busy ? "Saving…" : "Record"}
            </button>
          </div>
        </form>
      )}

      <section className="overflow-x-auto rounded-security-lg border border-security-navy-100 dark:border-security-navy-700">
        <table className="min-w-full divide-y divide-security-navy-100 text-sm dark:divide-security-navy-700">
          <thead className="bg-security-navy-50 dark:bg-security-navy-900">
            <tr className="text-left text-[10px] uppercase tracking-wider text-security-navy-500">
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Unit price</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-security-navy-100 dark:divide-security-navy-800">
            {invoice.items.map((item, i) => (
              <tr key={item.id ?? i}>
                <td className="px-3 py-2">{item.description}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatQuantity(item.quantity)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatCurrency(item.unitAmount, { currency })}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatCurrency(item.lineTotal, { currency })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="ml-auto w-full max-w-xs space-y-1.5">
        <div className="flex justify-between text-sm text-security-navy-700 dark:text-security-navy-300">
          <span>Subtotal</span>
          <span className="font-mono tabular-nums">{formatCurrency(invoice.subtotal, { currency })}</span>
        </div>
        {Number(invoice.discountAmount) !== 0 && (
          <div className="flex justify-between text-sm text-security-navy-700 dark:text-security-navy-300">
            <span>Discount</span>
            <span className="font-mono tabular-nums">-{formatCurrency(invoice.discountAmount, { currency })}</span>
          </div>
        )}
        <div className="flex justify-between text-sm text-security-navy-700 dark:text-security-navy-300">
          <span>VAT ({invoice.vatRate}%)</span>
          <span className="font-mono tabular-nums">{formatCurrency(invoice.vatAmount, { currency })}</span>
        </div>
        <div className="flex justify-between border-t border-security-navy-200 pt-2 text-base font-bold text-security-navy-900 dark:border-security-navy-600 dark:text-security-navy-100">
          <span>Total</span>
          <span className="font-mono tabular-nums">{formatCurrency(invoice.totalAmount, { currency })}</span>
        </div>
        <div className="flex justify-between text-sm text-security-navy-700 dark:text-security-navy-300">
          <span>Paid</span>
          <span className="font-mono tabular-nums">{formatCurrency(invoice.amountPaid ?? "0", { currency })}</span>
        </div>
        <div className="flex justify-between text-sm font-semibold text-security-navy-900 dark:text-security-navy-100">
          <span>Balance due</span>
          <span className="font-mono tabular-nums">
            {formatCurrency(invoice.amountDue ?? invoice.totalAmount, { currency })}
          </span>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-security-navy-900 dark:text-security-navy-100">Payments & receipts</h2>
        {payments.length === 0 ? (
          <p className="rounded-security-lg border border-security-navy-100 bg-security-navy-50 px-4 py-6 text-center text-sm text-security-navy-600 dark:border-security-navy-700 dark:bg-security-navy-900">
            No payments recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-security-lg border border-security-navy-100 dark:border-security-navy-700">
            <table className="min-w-full divide-y divide-security-navy-100 text-sm dark:divide-security-navy-700">
              <thead className="bg-security-navy-50 dark:bg-security-navy-900">
                <tr className="text-left text-[10px] uppercase tracking-wider text-security-navy-500">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Receipt</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-100 dark:divide-security-navy-800">
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-3 py-2">{payment.paymentDate?.slice(0, 10)}</td>
                    <td className="px-3 py-2 capitalize">{payment.paymentMethod?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="px-3 py-2">{payment.referenceNumber ?? "—"}</td>
                    <td className="px-3 py-2">
                      {payment.receipt ? (
                        canExport ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              run(() =>
                                downloadReceiptPdf(
                                  token!,
                                  payment.receipt!.id,
                                  `${payment.receipt!.receiptNumber}.pdf`
                                )
                              )
                            }
                            className="font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
                          >
                            {payment.receipt.receiptNumber}
                          </button>
                        ) : (
                          payment.receipt.receiptNumber
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatCurrency(payment.amount, { currency })}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canDelete && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => run(() => reversePayment(token!, payment.id))}
                          className="min-h-11 px-2 text-sm text-red-600 hover:underline disabled:opacity-40"
                        >
                          Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {invoice.notes && (
        <section className="rounded-security-lg border border-security-navy-100 bg-security-navy-50 p-4 text-sm dark:border-security-navy-700 dark:bg-security-navy-900">
          <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">Notes</h2>
          <p className="whitespace-pre-wrap text-security-navy-900 dark:text-security-navy-200">{invoice.notes}</p>
        </section>
      )}
    </main>
  );
}
