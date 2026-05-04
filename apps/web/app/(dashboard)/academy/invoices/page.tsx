"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

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
      return "badge-neutral";
    default:
      return "badge-neutral";
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
    <div className="module-shell">
      <div>
        <Link href="/academy" className="text-sm font-semibold text-security-navy-800 hover:underline lg:hidden">
          ← Academy
        </Link>
        <h1 className="page-title mt-1">Invoices</h1>
      </div>

      {!canManage && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
          Read-only: only admins can create invoices.
        </div>
      )}

      {error && (
        <div className="rounded-md border-2 border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <form onSubmit={create} className="grid gap-3 rounded-lg border border-neutral-200 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label py-0 text-xs">Student</label>
          <select
            className="input-compact min-h-10 w-full"
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
          <label className="label py-0 text-xs">Enrolment (optional)</label>
          <select
            className="input-compact min-h-10 w-full"
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
          <label className="label py-0 text-xs">Invoice date</label>
          <input
            type="date"
            className="input-compact w-full"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            disabled={!canManage || saving}
          />
        </div>
        <div>
          <label className="label py-0 text-xs">Due date</label>
          <input
            type="date"
            className="input-compact w-full"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={!canManage || saving}
          />
        </div>
        <div>
          <label className="label py-0 text-xs">Discount</label>
          <input
            className="input-compact w-full"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            disabled={!canManage || saving}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label py-0 text-xs">Line description</label>
          <input
            className="input-compact w-full"
            value={lineDesc}
            onChange={(e) => setLineDesc(e.target.value)}
            disabled={!canManage || saving}
          />
        </div>
        <div>
          <label className="label py-0 text-xs">Amount (excl. discount)</label>
          <input
            className="input-compact w-full"
            value={unitAmount}
            onChange={(e) => setUnitAmount(e.target.value)}
            placeholder="0.00"
            disabled={!canManage || saving}
          />
        </div>
        <div className="flex items-end sm:col-span-2 lg:col-span-3">
          <button type="submit" className="btn-primary text-sm py-2 px-4" disabled={!canManage || !students.length || saving}>
            Create draft invoice
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3">
        <div className="text-sm">
          <span className="font-medium">{total}</span> invoice{total === 1 ? "" : "s"} found
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span>Status</span>
          <select
            className="input-compact min-h-10"
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

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="table-module">
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
                <td colSpan={6} className="py-8 text-center text-sm text-black">
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
                  <Link href={`/academy/invoices/${inv.id}`} className="text-xs font-semibold text-security-navy-800 underline hover:no-underline">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && invoices.length === 0 && <p className="p-4 text-sm text-black">No invoices yet.</p>}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn-secondary text-sm py-2 px-3"
          disabled={offset <= 0 || loading}
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary text-sm py-2 px-3"
          disabled={loading || offset + PAGE_SIZE >= total}
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
