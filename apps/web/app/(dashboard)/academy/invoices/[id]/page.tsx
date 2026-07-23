"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { hasCapability } from "@/lib/permissions";
import { DateInput } from "@/components/date-input";
import { useConfirmDialog } from "@/components/ui";

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
  const [error, setError] = useState<string | null>(null);
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("EFT");
  const [payRef, setPayRef] = useState("");

  const load = () => {
    if (!token || !id) return;
    academyApi
      .getInvoice(token, id)
      .then((d) => setInvoice(d.invoice as InvoiceDetail))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  };

  useEffect(() => {
    load();
  }, [token, id]);

  useEffect(() => {
    if (invoice?.totalAmount) setPayAmount(String(invoice.totalAmount));
  }, [invoice?.id, invoice?.totalAmount]);

  const issue = async () => {
    if (!token || !canApprove) return;
    setError(null);
    try {
      await academyApi.issueInvoice(token, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Issue failed");
    }
  };

  const cancel = async () => {
    if (!token || !canEdit) return;
    const confirmed = await confirm({
      title: "Cancel invoice?",
      message: "Invoices can only be cancelled when there are no verified payments.",
      confirmLabel: "Cancel invoice",
    });
    if (!confirmed) return;
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
    if (!token || !payAmount.trim() || !canCreate) return;
    setError(null);
    try {
      await academyApi.createPayment(token, {
        invoiceId: id,
        paymentDate: payDate,
        amount: Number(payAmount),
        paymentMethod: payMethod || null,
        referenceNumber: payRef || null,
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
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

  const reject = async (paymentId: string) => {
    if (!token || !canApprove) return;
    const remarks = prompt("Rejection note (optional)") ?? "";
    setError(null);
    try {
      await academyApi.rejectPayment(token, paymentId, remarks || null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reject failed");
    }
  };

  if (!invoice && !error) {
    return (
      <div className="p-6">
        <p className="text-sm text-neutral-500">Loading…</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-6">
        <p className="text-red-700">{error}</p>
        <Link href="/academy/invoices" className="mt-2 inline-block font-semibold text-security-navy-700 hover:underline">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {confirmDialog}
      <div>
        <Link href="/academy/invoices" className="text-sm text-security-navy-700 hover:underline">
          ← Invoices
        </Link>
        <h1 className="mt-1 font-mono text-2xl font-semibold">{invoice.invoiceNumber}</h1>
        <p className="text-sm text-neutral-600">
          {invoice.student.firstName} {invoice.student.lastName} · {invoice.student.studentNumber}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="flex flex-wrap gap-2">
        <span className="badge-neutral px-3 py-1 text-sm">{invoice.status}</span>
        {invoice.status === "draft" && (
          <>
            {canApprove && (
            <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={issue}>
              Issue invoice
            </button>
            )}
            {canEdit && (
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs text-red-700" onClick={cancel}>
              Cancel
            </button>
            )}
          </>
        )}
        {canEdit && (invoice.status === "issued" || invoice.status === "partially_paid" || invoice.status === "overdue") && (
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs text-red-700" onClick={cancel}>
            Cancel (no verified payments)
          </button>
        )}
      </div>

      <div className="rounded-lg border border-neutral-300 p-4 text-sm">
        <p>
          Dates: {String(invoice.invoiceDate).slice(0, 10)} → due {String(invoice.dueDate).slice(0, 10)}
        </p>
        <p className="mt-1 font-mono">
          Subtotal {invoice.subtotal} · Discount {invoice.discountAmount} · <strong>Total {invoice.totalAmount}</strong>
        </p>
        <ul className="mt-2 list-inside list-disc text-xs">
          {invoice.items.map((it) => (
            <li key={it.id}>
              {it.description} × {it.quantity} @ {it.unitAmount} = {it.lineTotal}
            </li>
          ))}
        </ul>
      </div>

      {canCreate && <section className="rounded-lg border border-neutral-300 p-4">
        <h2 className="font-medium">Record payment</h2>
        <form onSubmit={addPayment} className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="label-text mb-1 block">Date</label>
            <DateInput value={payDate} onChange={setPayDate} className="input-compact" showToday ariaLabel="Payment date" />
          </div>
          <div>
            <label className="label-text mb-1 block">Amount</label>
            <input className="input-compact w-28" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
          </div>
          <div>
            <label className="label-text mb-1 block">Method</label>
            <input className="input-compact w-24" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} />
          </div>
          <div>
            <label className="label-text mb-1 block">Reference</label>
            <input className="input-compact w-32" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={invoice.status === "draft" || invoice.status === "cancelled"}>
            Add payment (pending)
          </button>
        </form>
        <p className="mt-2 text-xs text-neutral-500">
          Upload proof of payment from the student profile (Documents → payment_proof), then optionally link the document id via API later.
        </p>
      </section>}

      <section className="rounded-lg border border-neutral-300 p-4">
        <h2 className="font-medium">Payments</h2>
        {invoice.payments.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">None.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Receipt</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="text-xs">{String(p.paymentDate).slice(0, 10)}</td>
                    <td className="font-mono text-xs">{p.amount}</td>
                    <td>{p.verificationStatus}</td>
                    <td className="font-mono text-xs">{p.receipt?.receiptNumber ?? "—"}</td>
                    <td>
                      {canApprove && p.verificationStatus === "pending" && (
                        <div className="flex gap-1">
                          <button type="button" className="btn-primary px-2 py-1 text-xs" onClick={() => verify(p.id)}>
                            Verify
                          </button>
                          <button type="button" className="btn-ghost px-2 py-1 text-xs text-red-700" onClick={() => reject(p.id)}>
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
