"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { hasCapability } from "@/lib/permissions";
import {
  cancelInvoice,
  deleteInvoice,
  duplicateInvoice,
  downloadInvoicePdf,
  downloadReceiptPdf,
  getClientSitesBilling,
  previewInvoicePdf,
  previewReceiptPdf,
  getInvoice,
  issueInvoice,
  recordPayment,
  reversePayment,
  updateInvoice,
  type Invoice,
  type Payment,
  type SiteBillingSummary,
} from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency } from "@/lib/currency";
import { StatusBadge } from "../../_components/status-badge";
import { InvoiceDocument } from "../../_components/invoice-document";
import { PaymentTimeline } from "../../_components/payment-timeline";
import { BillingAccessRestricted } from "../../_components/billing-access-restricted";
import { computeTotalsPreview, DocumentTotals } from "../../_components/document-totals";
import { emptyLine, LineItemsEditor, type EditableLine } from "../../_components/line-items-editor";
import { clsx } from "clsx";

const METHODS = [
  { value: "eft", label: "EFT" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "debit_order", label: "Debit Order" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

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
              <div
                className={clsx(
                  "mx-1 h-0.5 w-8 sm:w-12 transition-colors",
                  isPast ? "bg-security-emerald-400" : "bg-security-navy-200"
                )}
              />
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
  const canEdit = user
    ? hasCapability(user, "/payroll/billing", "edit") || hasCapability(user, "/payroll/billing", "create")
    : false;
  const canExport = user ? hasCapability(user, "/payroll/billing", "export") : false;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Client sites for editing
  const [clientSites, setClientSites] = useState<SiteBillingSummary[]>([]);

  // Payment Recording State
  const [showPayment, setShowPayment] = useState(false);
  const [paymentDate, setPaymentDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("eft");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");

  // Edit Invoice Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editInvoiceDate, setEditInvoiceDate] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editSiteId, setEditSiteId] = useState("");
  const [editReference, setEditReference] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDiscount, setEditDiscount] = useState("0.00");
  const [editVatRate, setEditVatRate] = useState("15");
  const [editLines, setEditLines] = useState<EditableLine[]>([emptyLine()]);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete Confirmation Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Cancel Confirmation Modal State
  const [showCancelModal, setShowCancelModal] = useState(false);

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

  useEffect(() => {
    void load();
  }, [load]);

  // Load client sites if the invoice has a client
  useEffect(() => {
    if (!token || !invoice?.clientId) {
      setClientSites([]);
      return;
    }
    getClientSitesBilling(token, invoice.clientId)
      .then((res) => {
        setClientSites(res.sites || []);
      })
      .catch(() => {
        setClientSites([]);
      });
  }, [token, invoice?.clientId]);

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
    if (!amount || Number(amount) <= 0) {
      setError("Enter a payment amount greater than zero.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await recordPayment(token, invoice.id, {
        paymentDate,
        amount,
        paymentMethod: method,
        referenceNumber: paymentRef || null,
        notes: paymentNotes || null,
      });
      setAmount("");
      setPaymentRef("");
      setPaymentNotes("");
      setShowPayment(false);
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

  // Open Edit Modal
  const openEditModal = () => {
    if (!invoice) return;
    setEditInvoiceDate(invoice.invoiceDate ? invoice.invoiceDate.slice(0, 10) : "");
    setEditDueDate(invoice.dueDate ? invoice.dueDate.slice(0, 10) : "");
    setEditSiteId(invoice.siteId || "");
    setEditReference(invoice.reference || "");
    setEditNotes(invoice.notes || "");
    setEditDiscount(invoice.discountAmount || "0.00");
    setEditVatRate(invoice.vatRate || "15");
    setEditLines(
      invoice.items && invoice.items.length > 0
        ? invoice.items.map((it) => ({
            siteId: it.siteId ?? null,
            description: it.description,
            quantity: String(it.quantity),
            unitAmount: String(it.unitAmount),
          }))
        : [emptyLine()]
    );
    setEditError(null);
    setShowEditModal(true);
  };

  const executeSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !invoice) return;

    const validLines = editLines.filter((l) => l.description.trim() !== "");
    if (validLines.length === 0) {
      setEditError("Invoice must have at least one line item with a description.");
      return;
    }

    setBusy(true);
    setEditError(null);
    try {
      await updateInvoice(token, invoice.id, {
        invoiceDate: editInvoiceDate,
        dueDate: editDueDate,
        siteId: editSiteId || null,
        reference: editReference.trim() || null,
        notes: editNotes.trim() || null,
        discountAmount: editDiscount,
        vatRate: editVatRate,
        items: validLines,
      });
      setShowEditModal(false);
      await load();
      setSuccessMsg("Invoice updated successfully.");
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update invoice");
    } finally {
      setBusy(false);
    }
  };

  const executeDelete = async () => {
    if (!token || !invoice) return;
    setBusy(true);
    try {
      await deleteInvoice(token, invoice.id);
      router.push("/payroll/billing/invoices");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete invoice");
      setShowDeleteModal(false);
    } finally {
      setBusy(false);
    }
  };

  const executeCancel = async () => {
    if (!token || !invoice) return;
    setShowCancelModal(false);
    await run(() => cancelInvoice(token, invoice.id), "Invoice cancelled.");
  };

  const editTotals = useMemo(
    () => computeTotalsPreview(editLines, editDiscount, editVatRate),
    [editLines, editDiscount, editVatRate]
  );

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
        <Link href="/payroll/billing/invoices" className="text-sm font-semibold text-security-navy-700 hover:underline">
          ← Back to invoices
        </Link>
        <p className="rounded-security-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error ?? "Invoice not found"}
        </p>
      </main>
    );
  }

  const payments = invoice.payments ?? [];
  const settled = invoice.status === "paid" || invoice.status === "cancelled";
  const isDraft = invoice.status === "draft";
  const canRecordPayment = canCreate && !settled && !isDraft;
  const amountDue = Number(invoice.amountDue ?? invoice.totalAmount);
  const isOverdue =
    invoice.status === "overdue" ||
    ((invoice.status === "issued" || invoice.status === "partially_paid") && new Date(invoice.dueDate) < new Date());

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
              {isOverdue && invoice.status !== "overdue" && (
                <span className="badge-danger text-[10px]">Overdue</span>
              )}
              {invoice.quote && (
                <span className="text-xs text-security-navy-500">
                  From quote{" "}
                  <Link href={`/payroll/billing/quotes/${invoice.quote.id}`} className="font-semibold hover:underline">
                    {invoice.quote.quoteNumber}
                  </Link>
                </span>
              )}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-security-navy-500">
              <span className="font-semibold text-security-navy-900">{invoice.client?.name}</span>
              {invoice.site?.name && (
                <span className="inline-flex items-center rounded-full bg-security-navy-100 px-2 py-0.5 text-[10px] font-medium text-security-navy-700">
                  📍 {invoice.site.name}
                </span>
              )}
              <span>
                · {new Date(invoice.invoiceDate).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })}
              </span>
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {canExport && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => previewInvoicePdf(token!, invoice.id))}
                  className="btn-secondary min-h-10"
                >
                  Preview PDF
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => downloadInvoicePdf(token!, invoice.id, `${invoice.invoiceNumber}.pdf`))}
                  className="btn-secondary min-h-10"
                >
                  Download PDF
                </button>
              </>
            )}

            {canCreate && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const dup = await duplicateInvoice(token!, invoice.id);
                    router.push(`/payroll/billing/invoices/${dup.id}`);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to duplicate");
                    setBusy(false);
                  }
                }}
                className="btn-secondary min-h-10"
              >
                Duplicate
              </button>
            )}

            {/* Draft Actions: Edit, Delete, Issue */}
            {isDraft && canEdit && (
              <button
                type="button"
                disabled={busy}
                onClick={openEditModal}
                className="btn-secondary min-h-10 font-semibold"
                id="edit-invoice-btn"
              >
                Edit Invoice
              </button>
            )}

            {isDraft && canDelete && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowDeleteModal(true)}
                className="btn-secondary min-h-10 border-red-200 text-red-700 hover:bg-red-50"
                id="delete-invoice-btn"
              >
                Delete
              </button>
            )}

            {isDraft && canApprove && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => issueInvoice(token!, invoice.id), "Invoice issued.")}
                className="btn-amber min-h-10"
              >
                Issue Invoice
              </button>
            )}

            {/* Issued / Overdue Actions: Cancel (if no payments) */}
            {canEdit && !settled && !isDraft && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowCancelModal(true)}
                className="btn-secondary min-h-10 text-red-700 border-red-200 hover:bg-red-50"
              >
                Cancel
              </button>
            )}

            {canRecordPayment && (
              <button
                type="button"
                onClick={() => setShowPayment((o) => !o)}
                className="btn-primary min-h-10"
              >
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
        <div className="rounded-security-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="rounded-security-lg border border-security-emerald-200 bg-security-emerald-50 px-3 py-2 text-sm text-security-emerald-800" role="status">
          {successMsg}
        </div>
      )}

      {/* Payment recording panel */}
      {showPayment && canRecordPayment && (
        <form
          onSubmit={submitPayment}
          className="rounded-security-lg border border-security-navy-200 bg-white p-5 shadow-security-card space-y-4 animate-scale-in"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-security-navy-900">
              Record Client Payment — Balance Due: {formatCurrency(amountDue, { currency })}
            </h2>
            <button
              type="button"
              onClick={() => setAmount(String(amountDue.toFixed(2)))}
              className="text-xs font-semibold text-security-amber-700 hover:underline"
            >
              Pay in Full ({formatCurrency(amountDue, { currency })})
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="label-text mb-1 block">Payment Date</span>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                required
                className="input-modern w-full"
              />
            </label>
            <label className="block">
              <span className="label-text mb-1 block">Amount</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={amountDue}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
                className="input-modern w-full font-mono"
              />
            </label>
            <label className="block">
              <span className="label-text mb-1 block">Payment Method</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="input-modern w-full"
              >
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label-text mb-1 block">Reference / Proof #</span>
              <input
                type="text"
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                placeholder="e.g. EFT-99238"
                className="input-modern w-full"
              />
            </label>
          </div>

          <label className="block">
            <span className="label-text mb-1 block">Internal Notes (optional)</span>
            <input
              type="text"
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              placeholder="e.g. Paid via FNB online banking"
              className="input-modern w-full"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowPayment(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="btn-primary"
            >
              {busy ? "Recording…" : "Save Payment & Issue Receipt"}
            </button>
          </div>
        </form>
      )}

      {/* Invoice document representation */}
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
          clientEmail:
            (invoice.client as unknown as Record<string, string | null>)?.billingEmail ??
            (invoice.client as unknown as Record<string, string | null>)?.email,
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

      {/* Audit & Document Timeline */}
      <section className="rounded-security-lg border border-security-navy-200 bg-white p-5 shadow-security-card space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-security-navy-500">
          Document History & Financial Audit Trail
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs text-security-navy-700">
          <div className="rounded-security border border-security-navy-100 bg-security-navy-50/50 p-3">
            <span className="text-[10px] font-semibold uppercase text-security-navy-400 block mb-0.5">Invoice Date</span>
            <span className="font-medium text-security-navy-900">
              {new Date(invoice.invoiceDate).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })}
            </span>
          </div>
          <div className="rounded-security border border-security-navy-100 bg-security-navy-50/50 p-3">
            <span className="text-[10px] font-semibold uppercase text-security-navy-400 block mb-0.5">Due Date</span>
            <span className={clsx("font-medium", isOverdue ? "text-red-700 font-bold" : "text-security-navy-900")}>
              {new Date(invoice.dueDate).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })}
            </span>
          </div>
          <div className="rounded-security border border-security-navy-100 bg-security-navy-50/50 p-3">
            <span className="text-[10px] font-semibold uppercase text-security-navy-400 block mb-0.5">Status</span>
            <span className="font-semibold uppercase text-security-navy-900">{invoice.status}</span>
          </div>
          <div className="rounded-security border border-security-navy-100 bg-security-navy-50/50 p-3">
            <span className="text-[10px] font-semibold uppercase text-security-navy-400 block mb-0.5">Originating Quote</span>
            {invoice.quote ? (
              <Link href={`/payroll/billing/quotes/${invoice.quote.id}`} className="font-semibold text-security-amber-700 hover:underline">
                {invoice.quote.quoteNumber}
              </Link>
            ) : (
              <span className="text-security-navy-400">Direct Invoice</span>
            )}
          </div>
        </div>
      </section>

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
            {payments
              .filter((p): p is Payment & { receipt: NonNullable<Payment["receipt"]> } => Boolean(p.receipt))
              .map((p) => (
                <div key={p.id} className="flex items-center gap-1">
                  <span className="text-xs text-security-navy-500">Receipt #{p.receipt.receiptNumber}:</span>
                  <button
                    type="button"
                    onClick={() => run(() => previewReceiptPdf(token!, p.receipt.id))}
                    className="text-xs font-semibold text-security-amber-700 hover:underline"
                  >
                    Preview
                  </button>
                  <span className="text-security-navy-300">·</span>
                  <button
                    type="button"
                    onClick={() => run(() => downloadReceiptPdf(token!, p.receipt.id, `${p.receipt.receiptNumber}.pdf`))}
                    className="text-xs font-semibold text-security-navy-600 hover:underline"
                  >
                    Download
                  </button>
                </div>
              ))}
          </div>
        )}
      </section>

      {/* Edit Invoice Modal */}
      {showEditModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs animate-fade-in overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-invoice-modal-title"
        >
          <div className="w-full max-w-3xl rounded-security-lg border border-security-navy-200 bg-white p-6 shadow-xl space-y-5 animate-scale-in my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h2 id="edit-invoice-modal-title" className="text-lg font-bold text-security-navy-900">
                  Edit Invoice {invoice.invoiceNumber}
                </h2>
                <p className="text-xs text-security-navy-500 mt-0.5">
                  Update line items, pricing, billing dates, and notes for this draft invoice.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="text-security-navy-400 hover:text-security-navy-600 font-bold"
              >
                ✕
              </button>
            </div>

            {editError && (
              <div className="rounded-security-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {editError}
              </div>
            )}

            <form onSubmit={executeSaveEdit} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="label-text mb-1 block">Invoice Date</span>
                  <input
                    type="date"
                    value={editInvoiceDate}
                    onChange={(e) => setEditInvoiceDate(e.target.value)}
                    required
                    className="input-modern w-full"
                  />
                </label>
                <label className="block">
                  <span className="label-text mb-1 block">Due Date</span>
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    required
                    className="input-modern w-full"
                  />
                </label>
                {clientSites.length > 0 && (
                  <label className="block">
                    <span className="label-text mb-1 block">Target Site (optional)</span>
                    <select
                      value={editSiteId}
                      onChange={(e) => setEditSiteId(e.target.value)}
                      className="input-modern w-full"
                    >
                      <option value="">All Sites / Client-wide</option>
                      {clientSites.map((s) => (
                        <option key={s.siteId} value={s.siteId}>
                          {s.siteName}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label-text mb-1 block">Reference / PO #</span>
                  <input
                    type="text"
                    value={editReference}
                    onChange={(e) => setEditReference(e.target.value)}
                    placeholder="e.g. PO-2026-081"
                    className="input-modern w-full"
                  />
                </label>
                <label className="block">
                  <span className="label-text mb-1 block">Payment Terms & Notes</span>
                  <input
                    type="text"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Payment terms, bank details reference"
                    className="input-modern w-full"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label-text mb-1 block">Discount Amount</span>
                  <input
                    type="text"
                    value={editDiscount}
                    onChange={(e) => setEditDiscount(e.target.value)}
                    placeholder="0.00"
                    className="input-modern w-full font-mono"
                  />
                </label>
                <label className="block">
                  <span className="label-text mb-1 block">VAT Rate (%)</span>
                  <input
                    type="text"
                    value={editVatRate}
                    onChange={(e) => setEditVatRate(e.target.value)}
                    placeholder="15"
                    className="input-modern w-full font-mono"
                  />
                </label>
              </div>

              <LineItemsEditor
                token={token!}
                clientId={invoice.clientId}
                siteId={editSiteId || null}
                lines={editLines}
                onChange={setEditLines}
                currency={currency}
              />

              <DocumentTotals
                totals={editTotals}
                vatRate={editVatRate}
                currency={currency}
              />

              <div className="flex justify-end gap-2 pt-3 border-t border-security-navy-100">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  disabled={busy}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="btn-primary"
                  id="save-invoice-edit-btn"
                >
                  {busy ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Invoice Confirmation Modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-security-lg border border-red-200 bg-white p-6 shadow-xl space-y-4 animate-scale-in">
            <h2 className="text-lg font-bold text-red-700">Delete Draft Invoice?</h2>
            <p className="text-sm text-security-navy-600">
              Are you sure you want to permanently delete draft invoice <strong>{invoice.invoiceNumber}</strong>?
              This action cannot be undone.
            </p>
            <div className="rounded-security border border-security-navy-100 bg-security-navy-50/60 p-3 text-xs space-y-1">
              <div>Client: <strong>{invoice.client?.name}</strong></div>
              <div>Total: <strong>{formatCurrency(invoice.totalAmount, { currency })}</strong></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={busy}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeDelete}
                disabled={busy}
                className="btn-primary bg-red-600 hover:bg-red-700"
                id="confirm-delete-invoice-btn"
              >
                {busy ? "Deleting…" : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Invoice Confirmation Modal */}
      {showCancelModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-security-lg border border-red-200 bg-white p-6 shadow-xl space-y-4 animate-scale-in">
            <h2 className="text-lg font-bold text-red-700">Cancel Issued Invoice?</h2>
            <p className="text-sm text-security-navy-600">
              Are you sure you want to cancel invoice <strong>{invoice.invoiceNumber}</strong>?
              The invoice status will be changed to Cancelled, preserving it for accounting and audit records.
            </p>
            {payments.length > 0 && (
              <div className="rounded-security border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                ⚠ This invoice has recorded payments. You must reverse all payments before cancelling.
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                disabled={busy}
                className="btn-secondary"
              >
                Keep Active
              </button>
              <button
                type="button"
                onClick={executeCancel}
                disabled={busy || payments.length > 0}
                className="btn-primary bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? "Cancelling…" : "Confirm Cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
