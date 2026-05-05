"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

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
  const { token } = useAuth();
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
    if (!token) return;
    setError(null);
    try {
      await academyApi.issueInvoice(token, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Issue failed");
    }
  };

  const cancel = async () => {
    if (!token || !confirm("Cancel this invoice? Only allowed if there are no verified payments.")) return;
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
    if (!token || !payAmount.trim()) return;
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
    if (!token) return;
    setError(null);
    try {
      await academyApi.verifyPayment(token, paymentId);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verify failed");
    }
  };

  const reject = async (paymentId: string) => {
    if (!token) return;
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
        <p className="text-sm text-black">Loading…</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-6">
        <p className="text-red-800">{error}</p>
        <Link href="/academy/finance?tab=invoices" className="link-inline mt-2 inline-block text-sm font-semibold">
          Back to invoices
        </Link>
      </div>
    );
  }

  return (
    <div className="module-shell">
      <div>
        <Link href="/academy/finance?tab=invoices" className="link-inline text-sm font-semibold">
          ← Invoices
        </Link>
        <p className="label-text mt-1">Finance · Invoices</p>
        <h1 className="page-title mt-1 font-mono">{invoice.invoiceNumber}</h1>
        <p className="text-sm text-black">
          {invoice.student.firstName} {invoice.student.lastName} · {invoice.student.studentNumber}
        </p>
      </div>

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <span className="badge-neutral text-sm font-medium">{invoice.status}</span>
        {invoice.status === "draft" && (
          <>
            <button type="button" className="btn-primary text-sm py-2 px-4" onClick={issue}>
              Issue invoice
            </button>
            <button type="button" className="btn-ghost text-sm py-2 px-3 text-red-800" onClick={cancel}>
              Cancel
            </button>
          </>
        )}
        {(invoice.status === "issued" || invoice.status === "partially_paid" || invoice.status === "overdue") && (
          <button type="button" className="btn-ghost text-sm py-2 px-3 text-red-800" onClick={cancel}>
            Cancel (no verified payments)
          </button>
        )}
      </div>

      <div className="card-wireframe p-4 text-sm sm:p-5">
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

      <section className="card-wireframe p-4 sm:p-5">
        <h2 className="section-title normal-case text-base font-semibold tracking-tight">Record payment</h2>
        <form onSubmit={addPayment} className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="label py-0 text-xs">Date</label>
            <input type="date" className="input-compact" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </div>
          <div>
            <label className="label py-0 text-xs">Amount</label>
            <input className="input-compact w-28" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
          </div>
          <div>
            <label className="label py-0 text-xs">Method</label>
            <input className="input-compact w-24" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} />
          </div>
          <div>
            <label className="label py-0 text-xs">Reference</label>
            <input className="input-compact w-32" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary text-sm py-2 px-4" disabled={invoice.status === "draft" || invoice.status === "cancelled"}>
            Add payment (pending)
          </button>
        </form>
        <p className="mt-2 text-xs text-sm text-black">
          Upload proof of payment from the student profile (Documents → payment_proof), then optionally link the document id via API later.
        </p>
      </section>

      <section className="card-wireframe p-4 sm:p-5">
        <h2 className="section-title normal-case text-base font-semibold tracking-tight">Payments</h2>
        {invoice.payments.length === 0 ? (
          <p className="mt-2 text-sm text-black">None.</p>
        ) : (
          <div className="mt-2 table-scroll rounded-none border-0 shadow-none">
            <table className="table-module">
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
                      {p.verificationStatus === "pending" && (
                        <div className="flex gap-1">
                          <button type="button" className="btn-primary text-xs py-1 px-2 min-h-8" onClick={() => verify(p.id)}>
                            Verify
                          </button>
                          <button type="button" className="btn-ghost text-xs py-1 px-2 min-h-8 text-red-800" onClick={() => reject(p.id)}>
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
