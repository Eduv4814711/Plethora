"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { DateInput } from "@/components/date-input";

interface StudentOpt {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
}

interface EnrolOpt {
  id: string;
  courseRun: { runCode: string; course: { code: string; title: string } };
}

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  totalAmount: string;
  student: { studentNumber: string; firstName: string; lastName: string };
}

const PAGE_SIZE = 20;

function statusBadgeClass(status: string): string {
  switch (status) {
    case "paid":
      return "badge-success";
    case "issued":
    case "partially_paid":
      return "badge-warning";
    case "overdue":
      return "badge-error";
    case "cancelled":
      return "badge-neutral border border-neutral-300";
    default:
      return "badge-neutral border border-neutral-300";
  }
}

export default function AcademyInvoicesPage() {
  const { token, user } = useAuth();
  const canManage = user?.role === "admin";
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [enrolments, setEnrolments] = useState<EnrolOpt[]>([]);
  const [studentId, setStudentId] = useState("");
  const [enrolmentId, setEnrolmentId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lineDesc, setLineDesc] = useState("Course fee");
  const [unitAmount, setUnitAmount] = useState("");
  const [discount, setDiscount] = useState("0");
  const [statusFilter, setStatusFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    setLoading(true);
    academyApi
      .listInvoices(token, {
        status: statusFilter || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      .then((d) => {
        setInvoices((d.invoices as InvoiceRow[]) ?? []);
        setTotal(Number(d.total ?? 0));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) return;
    academyApi.listStudents(token, undefined, 200).then((d) => {
      const list = (d.students as StudentOpt[]) ?? [];
      setStudents(list);
      if (list.length && !studentId) setStudentId(list[0].id);
    });
  }, [token]);

  useEffect(() => {
    load();
  }, [token, statusFilter, offset]);

  useEffect(() => {
    if (!token || !studentId) return;
    academyApi.listEnrolments(token, { studentId }).then((d) => {
      const list = (d.enrolments as EnrolOpt[]) ?? [];
      setEnrolments(list);
      setEnrolmentId("");
    });
  }, [token, studentId]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !studentId || !unitAmount.trim() || !canManage) return;
    setError(null);
    setSaving(true);
    try {
      const { invoice } = await academyApi.createInvoice(token, {
        studentId,
        enrolmentId: enrolmentId || null,
        invoiceDate,
        dueDate,
        discountAmount: Number(discount) || 0,
        items: [{ description: lineDesc || "Course fee", quantity: 1, unitAmount: Number(unitAmount) }],
      });
      const inv = invoice as { id: string };
      window.location.href = `/academy/invoices/${inv.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <Link href="/academy" className="text-sm text-security-navy-700 hover:underline lg:hidden">
          ← Academy
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Invoices</h1>
      </div>

      {!canManage && (
        <div className="rounded-lg border border-neutral-300 bg-neutral-100/50 px-3 py-2 text-sm">
          Read-only: only admins can create invoices.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={create} className="grid gap-3 rounded-lg border border-neutral-300 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label-text mb-1 block">Student</label>
          <select
            className="input-compact w-full"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            disabled={!canManage || saving}
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.studentNumber} — {s.firstName} {s.lastName}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label-text mb-1 block">Enrolment (optional)</label>
          <select
            className="input-compact w-full"
            value={enrolmentId}
            onChange={(e) => setEnrolmentId(e.target.value)}
            disabled={!canManage || saving}
          >
            <option value="">— None —</option>
            {enrolments.map((en) => (
              <option key={en.id} value={en.id}>
                {en.courseRun.course.code} / {en.courseRun.runCode}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-text mb-1 block">Invoice date</label>
          <DateInput
            value={invoiceDate}
            onChange={setInvoiceDate}
            className="input-compact"
            showToday
            disabled={!canManage || saving}
            ariaLabel="Invoice date"
          />
        </div>
        <div>
          <label className="label-text mb-1 block">Due date</label>
          <DateInput
            value={dueDate}
            onChange={setDueDate}
            className="input-compact"
            showToday
            disabled={!canManage || saving}
            ariaLabel="Invoice due date"
          />
        </div>
        <div>
          <label className="label-text mb-1 block">Discount</label>
          <input
            className="input-compact w-full"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            disabled={!canManage || saving}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label-text mb-1 block">Line description</label>
          <input
            className="input-compact w-full"
            value={lineDesc}
            onChange={(e) => setLineDesc(e.target.value)}
            disabled={!canManage || saving}
          />
        </div>
        <div>
          <label className="label-text mb-1 block">Amount (excl. discount)</label>
          <input
            className="input-compact w-full"
            value={unitAmount}
            onChange={(e) => setUnitAmount(e.target.value)}
            placeholder="0.00"
            disabled={!canManage || saving}
          />
        </div>
        <div className="flex items-end sm:col-span-2 lg:col-span-3">
          <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={!canManage || !students.length || saving}>
            Create draft invoice
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-300 p-3">
        <div className="text-sm">
          <span className="font-medium">{total}</span> invoice{total === 1 ? "" : "s"} found
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span>Status</span>
          <select
            className="input-compact"
            value={statusFilter}
            onChange={(e) => {
              setOffset(0);
              setStatusFilter(e.target.value);
            }}
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="partially_paid">Partially paid</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-300">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead>
            <tr>
              <th>Number</th>
              <th>Student</th>
              <th>Status</th>
              <th>Total</th>
              <th>Due</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-neutral-500">
                  Loading invoices...
                </td>
              </tr>
            ) : invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="font-mono text-xs">{inv.invoiceNumber}</td>
                <td className="text-xs">
                  {inv.student.firstName} {inv.student.lastName}
                </td>
                <td>
                  <span className={`badge-neutral ${statusBadgeClass(inv.status)}`}>
                    {inv.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="font-mono text-xs">{inv.totalAmount}</td>
                <td className="text-xs">{String(inv.dueDate).slice(0, 10)}</td>
                <td>
                  <Link href={`/academy/invoices/${inv.id}`} className="font-semibold text-security-navy-700 hover:underline text-xs">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && invoices.length === 0 && <p className="p-4 text-sm text-neutral-500">No invoices yet.</p>}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-xs"
          disabled={offset <= 0 || loading}
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-xs"
          disabled={loading || offset + PAGE_SIZE >= total}
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
