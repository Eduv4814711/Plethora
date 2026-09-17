"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { hasCapability } from "@/lib/permissions";
import {
  cancelInvoice,
  duplicateInvoice,
  downloadInvoicePdf,
  downloadReceiptPdf,
  previewInvoicePdf,
  previewReceiptPdf,
  getInvoice,
  issueInvoice,
  recordPayment,
  reversePayment,
  type Invoice,
  type Payment,
} from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency } from "@/lib/currency";
import { StatusBadge } from "../../_components/status-badge";
import { InvoiceDocument } from "../../_components/invoice-document";
import { PaymentTimeline } from "../../_components/payment-timeline";
import { BillingAccessRestricted } from "../../_components/billing-access-restricted";
import { clsx } from "clsx";

const METHODS = [
  { value: "eft", label: "EFT" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "debit_order", label: "Debit Order" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

function today(): string { return new Date().toISOString().slice(0, 10); }

// Lifecycle steps
const LIFECYCLE: Array<{ status: string; label: string }> = [
  { status: "draft", label: "Draft" },
  { status: "issued", label: "Issued" },
  { status: "partially_paid", label: "Partial Payment" },
  { status: "paid", label: "Paid" },
];

function LifecycleBar({ status }: { status: string }) {
  const cancelled = status === "cancelled";
  const overdue = status === "overdue";
  const activeLabel = overdue ? "issued" : status;
  const activeIdx = LIFECYCLE.findIndex((s) => s.status === activeLabel);

  if (cancelled) {
    return (
      <div className="flex items-center gap-2 rounded-security border border-red-200 bg-red-50 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span className="text-xs font-semibold text-red-700">Invoice Cancelled</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0">
      {LIFECYCLE.map((step, i) => {
        const isActive = i === activeIdx;
        const isPast = i < activeIdx;
        const isLast = i === LIFECYCLE.length - 1;
        return (
          <div key={step.status} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={clsx(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold transition-colors",
                  isPast && "bg-security-emerald-500 text-white",
                  isActive && (overdue ? "bg-red-500 text-white" : "bg-security-navy-900 text-white"),
                  !isPast && !isActive && "border-2 border-security-navy-200 bg-white text-security-navy-400"
                )}
              >
                {isPast ? "✓" : i + 1}
              </div>
              <span
                className={clsx(
                  "mt-1 hidden whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide sm:block",
                  isPast && "text-security-emerald-600",
                  isActive && (overdue ? "text-red-600" : "text-security-navy-900"),
                  !isPast && !isActive && "text-security-navy-400"
                )}
              >
                {isActive && overdue ? "Overdue" : step.label}
              </span>
            </div>
            {!isLast && (
              <div className={clsx("mx-1 h-0.5 w-8 sm:w-12 transition-colors", isPast ? "bg-security-emerald-400" : "bg-security-navy-200")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function InvoiceDetailPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const currency = currencyFromSettings(settings);

  const canView = user ? hasCapability(user, "/payroll/billing", "view") : false;
  const canApprove = user ? hasCapability(user, "/payroll/billing", "approve") : false;
  const canCreate = user ? hasCapability(user, "/payroll/billing", "create") : false;
  const canDelete = user ? hasCapability(user, "/payroll/billing", "delete") : false;
  const canEdit = user ? hasCapability(user, "/payroll/billing", "edit") : false;
  const canExport = user ? hasCapability(user, "/payroll/billing", "export") : false;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [showPayment, setShowPayment] = useState(false);
  const [paymentDate, setPaymentDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("eft");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");

  const load = useCallback(async () => {
    if (!token || !canView) return;
    setLoading(true);
    setError(null);
    try {
      setInvoice(await getInvoice(token, params.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoice");
    } finally {
      setLoading(false);
    }
  }, [token, canView, params.id]);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, successText?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      if (successText) {
        setSuccessMsg(successText);
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !invoice) return;
    if (!amount || Number(amount) <= 0) { setError("Enter a payment amount greater than zero."); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await recordPayment(token, invoice.id, {
        paymentDate, amount, paymentMethod: method,
        referenceNumber: paymentRef || null,
        notes: paymentNotes || null,
      });
      setAmount(""); setPaymentRef(""); setPaymentNotes(""); setShowPayment(false);
      await load();
      setSuccessMsg(`Payment of ${formatCurrency(amount, { currency })} recorded. Receipt: ${result.receipt.receiptNumber}`);
      setTimeout(() => setSuccessMsg(null), 6000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setBusy(false);
    }
  };

  const handleReverse = async (paymentId: string) => {
    if (!token) return;
    setReversingId(paymentId);
    setError(null);
    try {
      await reversePayment(token, paymentId);
      await load();
      setSuccessMsg("Payment reversed successfully.");
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reverse payment");
    } finally {
      setReversingId(null);
    }
  };

  if (user && !canView) {
    return <BillingAccessRestricted />;
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="h-8 w-48 animate-pulse rounded-security bg-security-navy-100" />
        <div className="h-96 animate-pulse rounded-security-lg bg-security-navy-100" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <main className="space-y-4">
        <Link href="/payroll/billing/invoices" className="text-sm font-semibold text-security-navy-700 hover:underline">← Back to invoices</Link>
        <p className="rounded-security-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error ?? "Invoice not found"}</p>
      </main>
    );
  }

  const payments = invoice.payments ?? [];
  const settled = invoice.status === "paid" || invoice.status === "cancelled";
  const isDraft = invoice.status === "draft";
  const canRecordPayment = canCreate && !settled && !isDraft;
  const amountDue = Number(invoice.amountDue ?? invoice.totalAmount);

  return (
    <main className="animate-fade-in space-y-5 pb-16">
      {/* Breadcrumb + header */}
      <header className="space-y-4">
        <Link href="/payroll/billing/invoices" className="section-title hover:underline">
          ← Invoices
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="page-title">{invoice.invoiceNumber}</h1>
              <StatusBadge status={invoice.status} />
              {invoice.quote && (
                <span className="text-xs text-security-navy-500">
                  From quote{" "}
                  <Link href={`/payroll/billing/quotes/${invoice.quote.id}`} className="font-semibold hover:underline">
                    {invoice.quote.quoteNumber}
                  </Link>
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-security-navy-500">
              {invoice.client?.name} ·{" "}
              {new Date(invoice.invoiceDate).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {canExport && (
              <>
                <button type="button" disabled={busy} onClick={() => run(() => previewInvoicePdf(token!, invoice.id))} className="btn-secondary min-h-10">
                  Preview PDF
                </button>
                <button type="button" disabled={busy} onClick={() => run(() => downloadInvoicePdf(token!, invoice.id, `${invoice.invoiceNumber}.pdf`))} className="btn-secondary min-h-10">
                  Download PDF
                </button>
              </>
            )}
            {canCreate && (
              <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const dup = await duplicateInvoice(token!, invoice.id); router.push(`/payroll/billing/invoices/${dup.id}`); } catch (err) { setError(err instanceof Error ? err.message : "Failed"); setBusy(false); } }} className="btn-secondary min-h-10">
                Duplicate
              </button>
            )}
            {canEdit && !settled && !isDraft && (
              <button type="button" disabled={busy} onClick={() => run(() => cancelInvoice(token!, invoice.id), "Invoice cancelled.")} className="btn-secondary min-h-10 text-red-700 border-red-200 hover:bg-red-50">
                Cancel
              </button>
            )}
            {canApprove && isDraft && (
              <button type="button" disabled={busy} onClick={() => run(() => issueInvoice(token!, invoice.id), "Invoice issued.")} className="btn-amber min-h-10">
                Issue Invoice
              </button>
            )}
            {canRecordPayment && (
              <button type="button" onClick={() => setShowPayment((o) => !o)} className="btn-primary min-h-10">
                {showPayment ? "Close" : "Record Payment"}
              </button>
            )}
          </div>
        </div>

        {/* Lifecycle bar */}
        <LifecycleBar status={invoice.status} />
      </header>

      {/* Alert banners */}
      {error && (
        <div className="rounded-security-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>
      )}
      {successMsg && (
        <div className="rounded-security-lg border border-security-emerald-200 bg-security-emerald-50 px-3 py-2 text-sm text-security-emerald-800" role="status">{successMsg}</div>
      )}
      {isDraft && (
        <div className="rounded-security-lg border border-security-amber-200 bg-security-amber-50 px-3 py-2 text-sm text-security-amber-900">
          ⚠ This invoice is a draft. Issue it to make it official and enable payment recording.
        </div>
      )}

      {/* Record Payment form */}
      {showPayment && canRecordPayment && (
        <section className="rounded-security-lg border border-security-navy-200 bg-white p-5 shadow-security-card">
          <h2 className="mb-4 text-sm font-semibold text-security-navy-900">Record Payment</h2>
          <form onSubmit={submitPayment} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className="label-text mb-1.5 block">Payment date</span>
                <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="input-modern w-full" required id="payment-date" />
              </label>
              <label className="block">
                <span className="label-text mb-1.5 block">Amount</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={invoice.amountDue ?? "0.00"} className="input-modern w-full text-right" required id="payment-amount" />
                {amountDue > 0 && (
                  <button type="button" onClick={() => setAmount(invoice.amountDue ?? "")} className="mt-1 text-[10px] font-semibold text-security-amber-700 hover:underline">
                    Use full balance {formatCurrency(amountDue, { currency })}
                  </button>
                )}
              </label>
              <label className="block">
                <span className="label-text mb-1.5 block">Method</span>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="input-modern w-full" id="payment-method">
                  {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label-text mb-1.5 block">Reference</span>
                <input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="Bank ref / proof #" className="input-modern w-full" id="payment-ref" />
              </label>
            </div>
            <label className="block">
              <span className="label-text mb-1.5 block">Notes (optional)</span>
              <input value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="Optional notes" className="input-modern w-full" id="payment-notes" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowPayment(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={busy} className="btn-primary">{busy ? "Saving…" : "Record Payment"}</button>
            </div>
          </form>
        </section>
      )}

      {/* Invoice document */}
      <InvoiceDocument
        header={{
          type: "INVOICE",
          number: invoice.invoiceNumber,
          date: invoice.invoiceDate,
          dueOrValidUntil: invoice.dueDate,
          status: invoice.status,
          reference: invoice.reference,
          notes: invoice.notes,
        }}
        party={{
          clientName: invoice.client?.name ?? "Unknown",
          clientEmail: (invoice.client as unknown as Record<string, string | null>)?.billingEmail ?? (invoice.client as unknown as Record<string, string | null>)?.email,
          clientAddress: (invoice.client as unknown as Record<string, string | null>)?.billingAddress,
          clientVatNumber: (invoice.client as unknown as Record<string, string | null>)?.vatNumber,
          clientPhone: (invoice.client as unknown as Record<string, string | null>)?.phone,
        }}
        financials={{
          subtotal: invoice.subtotal,
          discountAmount: invoice.discountAmount,
          vatRate: invoice.vatRate,
          vatAmount: invoice.vatAmount,
          totalAmount: invoice.totalAmount,
          amountPaid: invoice.amountPaid,
          amountDue: invoice.amountDue,
        }}
        lines={invoice.items}
        currency={currency}
      />

      {/* Payment history */}
      <section className="rounded-security-lg border border-security-navy-100 bg-white p-5 shadow-security-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-security-navy-900">
            Payment History
            {payments.length > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-security-navy-100 px-2 py-0.5 text-[10px] font-semibold text-security-navy-700">
                {payments.length}
              </span>
            )}
          </h2>
        </div>
        <PaymentTimeline
          payments={payments}
          currency={currency}
          canReverse={canDelete}
          onReverse={handleReverse}
          reversingId={reversingId}
        />

        {/* Receipt download links */}
        {canExport && payments.some((p) => p.receipt) && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-security-navy-100 pt-4">
            {payments.filter((p): p is Payment & { receipt: NonNullable<Payment["receipt"]> } => Boolean(p.receipt)).map((p) => (
              <div key={p.id} className="flex items-center gap-1">
                <span className="text-xs text-security-navy-500">Receipt #{p.receipt.receiptNumber}:</span>
                <button type="button" onClick={() => run(() => previewReceiptPdf(token!, p.receipt.id))} className="text-xs font-semibold text-security-amber-700 hover:underline">Preview</button>
                <span className="text-security-navy-300">·</span>
                <button type="button" onClick={() => run(() => downloadReceiptPdf(token!, p.receipt.id, `${p.receipt.receiptNumber}.pdf`))} className="text-xs font-semibold text-security-navy-600 hover:underline">Download</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
