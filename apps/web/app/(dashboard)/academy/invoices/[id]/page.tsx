"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { hasCapability } from "@/lib/permissions";
import { DateInput } from "@/components/date-input";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  SkeletonBlock,
  useConfirmDialog,
} from "@/components/ui";

interface PaymentRow {
  id: string;
  amount: string;
  paymentDate: string;
  verificationStatus: string;
  paymentMethod?: string | null;
  referenceNumber?: string | null;
  receipt?: { id: string; receiptNumber: string } | null;
}

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  status: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: string;
  discountAmount: string;
  totalAmount: string;
  student: { id: string; studentNumber: string; firstName: string; lastName: string };
  items: Array<{ id: string; description: string; quantity: number; unitAmount: string; lineTotal: string }>;
  payments: PaymentRow[];
}

export default function AcademyInvoiceDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { token, user } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
  const canCreate = Boolean(user && hasCapability(user, "/academy", "create"));
  const canEdit = Boolean(user && hasCapability(user, "/academy", "edit"));
  const canApprove = Boolean(user && hasCapability(user, "/academy", "approve"));

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Payment creation
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("EFT");
  const [payRef, setPayRef] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);

  // Rejection modal state (replaces window.prompt)
  const [rejectingPaymentId, setRejectingPaymentId] = useState<string | null>(null);
  const [rejectionRemarks, setRejectionRemarks] = useState("");
  const [savingReject, setSavingReject] = useState(false);

  const load = () => {
    if (!token || !id) return;
    setLoading(true);
    academyApi
      .getInvoice(token, id)
      .then((d) => setInvoice(d.invoice as InvoiceDetail))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load invoice"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [token, id]);

  const issue = async () => {
    if (!token || !id || !canApprove) return;
    const ok = await confirm({
      title: "Issue invoice?",
      message: "This finalizes the invoice and prepares it for learner payment reconciliation.",
      confirmLabel: "Issue invoice",
      danger: false,
    });
    if (!ok) return;
    setError(null);
    try {
      await academyApi.issueInvoice(token, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Issue failed");
    }
  };

  const cancel = async () => {
    if (!token || !id || !canEdit) return;
    const ok = await confirm({
      title: "Cancel invoice?",
      message: "This cancels the invoice. It cannot be issued if payments are already verified.",
      confirmLabel: "Cancel invoice",
    });
    if (!ok) return;
    setError(null);
    try {
      await academyApi.cancelInvoice(token, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  };

  const addPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !id || !payAmount.trim() || !canCreate) return;
    setError(null);
    setSavingPayment(true);
    try {
      await academyApi.createPayment(token, {
        invoiceId: id,
        studentId: invoice?.student.id,
        amount: payAmount.trim(),
        paymentMethod: payMethod.trim() || "EFT",
        paymentReference: payRef.trim() || null,
        receivedAt: new Date(payDate + "T12:00:00").toISOString(),
      });
      setPayAmount("");
      setPayRef("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment record failed");
    } finally {
      setSavingPayment(false);
    }
  };

  const verify = async (paymentId: string) => {
    if (!token || !canApprove) return;
    setError(null);
    try {
      await academyApi.verifyPayment(token, paymentId);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verify failed");
    }
  };

  const openRejectModal = (paymentId: string) => {
    setRejectingPaymentId(paymentId);
    setRejectionRemarks("");
  };

  const confirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !rejectingPaymentId || !canApprove) return;
    setError(null);
    setSavingReject(true);
    try {
      await academyApi.rejectPayment(token, rejectingPaymentId, rejectionRemarks.trim() || null);
      setRejectingPaymentId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setSavingReject(false);
    }
  };

  if (loading && !invoice) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <SkeletonBlock className="h-6 w-32" />
        <SkeletonBlock className="h-10 w-64" />
        <SkeletonBlock className="h-32 w-full" />
        <SkeletonBlock className="h-48 w-full" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-6">
        <AlertBanner variant="error">{error ?? "Invoice not found"}</AlertBanner>
        <Link
          href="/academy/invoices"
          className="mt-4 inline-block text-sm font-semibold text-security-navy-700 hover:underline"
        >
          ← Back to invoices
        </Link>
      </div>
    );
  }

  const invoiceStatusVariant = (st: string): "success" | "warning" | "error" | "neutral" => {
    switch (st) {
      case "paid":
        return "success";
      case "issued":
      case "partially_paid":
        return "warning";
      case "cancelled":
        return "error";
      case "draft":
      default:
        return "neutral";
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      {confirmDialog}
      <div>
        <Link href="/academy/invoices" className="text-sm text-security-navy-700 hover:underline">
          ← Invoices
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-security-navy-900">
            {invoice.invoiceNumber}
          </h1>
          <Badge variant={invoiceStatusVariant(invoice.status)}>{invoice.status}</Badge>
        </div>
        <p className="mt-1 text-sm text-security-navy-600">
          Learner: {invoice.student.firstName} {invoice.student.lastName} · {invoice.student.studentNumber}
        </p>
      </div>

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {/* Invoice Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {invoice.status === "draft" && (
          <>
            {canApprove && (
              <Button size="sm" onClick={issue}>
                Issue Invoice
              </Button>
            )}
            {canEdit && (
              <Button variant="ghost" size="sm" className="text-red-700 hover:bg-red-50" onClick={cancel}>
                Cancel Invoice
              </Button>
            )}
          </>
        )}
        {canEdit &&
          (invoice.status === "issued" ||
            invoice.status === "partially_paid" ||
            invoice.status === "overdue") && (
            <Button variant="ghost" size="sm" className="text-red-700 hover:bg-red-50" onClick={cancel}>
              Cancel Invoice
            </Button>
          )}
      </div>

      {/* Invoice Details Card */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-security-navy-100 pb-3">
          <span className="text-xs text-security-navy-500">
            Invoice Date: {String(invoice.invoiceDate).slice(0, 10)} · Due Date:{" "}
            {String(invoice.dueDate).slice(0, 10)}
          </span>
          <span className="font-mono text-xs font-semibold text-security-navy-900">
            Total: {invoice.totalAmount}
          </span>
        </div>
        <div className="mt-3 text-xs text-security-navy-600 flex flex-wrap gap-4 font-mono">
          <span>Subtotal: {invoice.subtotal}</span>
          <span>Discount: {invoice.discountAmount}</span>
          <span className="font-semibold text-security-navy-900">Net Due: {invoice.totalAmount}</span>
        </div>
        <ul className="mt-4 list-inside list-disc space-y-1 text-xs text-security-navy-700 border-t border-security-navy-100 pt-3">
          {invoice.items.map((it) => (
            <li key={it.id}>
              {it.description} × {it.quantity} @ {it.unitAmount} ={" "}
              <strong className="font-mono text-security-navy-900">{it.lineTotal}</strong>
            </li>
          ))}
        </ul>
      </Card>

      {/* Record Payment Section */}
      {canCreate && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-security-navy-500">
            Record Payment
          </h2>
          <form onSubmit={addPayment} className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="label-text mb-1 block">Date</label>
              <DateInput
                value={payDate}
                onChange={setPayDate}
                className="input-compact"
                showToday
                ariaLabel="Payment date"
              />
            </div>
            <div>
              <label className="label-text mb-1 block">Amount (ZAR)</label>
              <input
                className="input-compact w-28"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="e.g. 500"
                required
              />
            </div>
            <div>
              <label className="label-text mb-1 block">Method</label>
              <input
                className="input-compact w-28"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                placeholder="EFT / Cash"
              />
            </div>
            <div>
              <label className="label-text mb-1 block">Reference</label>
              <input
                className="input-compact w-36"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="Bank ref"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={invoice.status === "draft" || invoice.status === "cancelled" || savingPayment}
              loading={savingPayment}
            >
              Add Payment (Pending)
            </Button>
          </form>
          <p className="mt-2 text-xs text-security-navy-500">
            Recorded payments enter the pending verification queue until verified by a finance approver.
          </p>
        </Card>
      )}

      {/* Payments List */}
      <div className="overflow-hidden rounded-2xl border border-security-navy-100 bg-white shadow-security-card">
        <div className="border-b border-security-navy-100/80 px-5 py-4">
          <h2 className="text-base font-semibold text-security-navy-900">Payments & Receipts</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-security-navy-100 text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-security-navy-500">
                <th scope="col" className="px-4 py-3 text-left">Date</th>
                <th scope="col" className="px-4 py-3 text-left">Amount</th>
                <th scope="col" className="px-4 py-3 text-left">Status</th>
                <th scope="col" className="px-4 py-3 text-left">Receipt #</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoice.payments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-security-navy-500">
                    No payments recorded for this invoice yet.
                  </td>
                </tr>
              ) : (
                invoice.payments.map((p) => (
                  <tr key={p.id} className="hover:bg-security-navy-50/40">
                    <td className="px-4 py-3 text-xs text-security-navy-600">
                      {String(p.paymentDate).slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-security-navy-900">
                      {p.amount}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          p.verificationStatus === "verified"
                            ? "success"
                            : p.verificationStatus === "rejected"
                              ? "error"
                              : "warning"
                        }
                      >
                        {p.verificationStatus}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-security-navy-700">
                      {p.receipt?.receiptNumber ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {canApprove && p.verificationStatus === "pending" && (
                        <>
                          <Button size="sm" onClick={() => verify(p.id)}>
                            Verify
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => openRejectModal(p.id)}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Accessible Payment Rejection Modal Dialog (Replaces native browser prompt) */}
      {rejectingPaymentId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-security-navy-100 bg-white p-6 shadow-security-card">
            <h3 id="reject-dialog-title" className="text-lg font-semibold text-security-navy-900">
              Reject Payment Record
            </h3>
            <p className="mt-1 text-xs text-security-navy-600">
              Provide an optional note detailing why this payment proof or EFT was rejected.
            </p>

            <form onSubmit={confirmReject} className="mt-4 space-y-3">
              <div>
                <label className="label-text mb-1 block" htmlFor="rejection-note">
                  Rejection Note (optional)
                </label>
                <textarea
                  id="rejection-note"
                  className="input-modern w-full min-h-[80px]"
                  placeholder="e.g. Invalid bank reference, proof amount mismatch, duplicate deposit"
                  value={rejectionRemarks}
                  onChange={(e) => setRejectionRemarks(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setRejectingPaymentId(null)}
                  disabled={savingReject}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  type="submit"
                  loading={savingReject}
                >
                  Confirm Rejection
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
