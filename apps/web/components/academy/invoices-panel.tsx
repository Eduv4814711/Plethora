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

interface InvoicesPanelProps {
  /** Hide the H2 header (useful when this panel is hosted in a tabbed page that already shows a section title). */
  hideHeader?: boolean;
}

/**
 * Reusable academy invoices panel.
 * - Shows a "Create draft invoice" form for admins (read-only otherwise).
 * - Lists invoices with status filter and pagination.
 *
 * Used standalone via the `/academy/finance?tab=invoices` route (Finance hub) and
 * historically on `/academy/invoices` (now redirected).
 */
export function AcademyInvoicesPanel({ hideHeader = false }: InvoicesPanelProps) {
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
  const [createOpen, setCreateOpen] = useState(false);

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

  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {!hideHeader && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="page-title">Invoices</h2>
            <p className="mt-1 text-sm text-black">Issue, track, and reconcile course fee invoices.</p>
          </div>
        </div>
      )}

      {!canManage && (
        <div className="notice-info" role="status">
          Read-only: only admins can create invoices.
        </div>
      )}

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      {/* Create draft form (collapsible for admins) */}
      {canManage && (
        <details
          className="card-wireframe overflow-hidden"
          open={createOpen}
          onToggle={(e) => setCreateOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <div>
              <p className="section-title">New invoice</p>
              <p className="mt-0.5 text-sm text-black">Create a draft invoice for an enrolled student.</p>
            </div>
            <span aria-hidden className="text-sm font-semibold text-black">
              {createOpen ? "Hide" : "Show"}
            </span>
          </summary>
          <div className="border-t border-[var(--hairline)] p-4 sm:p-5">
            <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="label-text mb-1 block">Student</label>
                <select
                  className="input-compact w-full"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  disabled={saving}
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
                  disabled={saving}
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
                <input
                  type="date"
                  className="input-compact w-full"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div>
                <label className="label-text mb-1 block">Due date</label>
                <input
                  type="date"
                  className="input-compact w-full"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div>
                <label className="label-text mb-1 block">Discount</label>
                <input
                  className="input-compact w-full"
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label-text mb-1 block">Line description</label>
                <input
                  className="input-compact w-full"
                  value={lineDesc}
                  onChange={(e) => setLineDesc(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div>
                <label className="label-text mb-1 block">Amount (excl. discount)</label>
                <input
                  className="input-compact w-full"
                  inputMode="decimal"
                  value={unitAmount}
                  onChange={(e) => setUnitAmount(e.target.value)}
                  placeholder="0.00"
                  disabled={saving}
                />
              </div>
              <div className="flex items-end sm:col-span-2 lg:col-span-3">
                <button
                  type="submit"
                  className="btn-primary text-sm"
                  disabled={!students.length || saving || !unitAmount.trim()}
                >
                  {saving ? "Creating…" : "Create draft invoice"}
                </button>
              </div>
            </form>
          </div>
        </details>
      )}

      {/* Filter + count toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-security-lg border border-[var(--hairline)] bg-white p-3 shadow-security-card">
        <p className="text-sm text-black">
          <span className="font-semibold tabular-nums">{total}</span> invoice{total === 1 ? "" : "s"}
          {total > 0 && (
            <span className="ml-2 text-black/70">
              · showing <span className="tabular-nums">{start}</span>–<span className="tabular-nums">{end}</span>
            </span>
          )}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-black">Status</span>
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

      {/* Table */}
      <div className="table-scroll">
        <table className="table-module">
          <thead>
            <tr>
              <th>Number</th>
              <th>Student</th>
              <th>Status</th>
              <th className="text-right">Total</th>
              <th>Due</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-black">
                  Loading invoices…
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-black">
                  No invoices found{statusFilter ? ` for status "${statusFilter.replace(/_/g, " ")}"` : ""}.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="font-mono text-xs">{inv.invoiceNumber}</td>
                  <td className="text-xs">
                    {inv.student.firstName} {inv.student.lastName}
                    <span className="block font-mono text-[11px] text-black/60">{inv.student.studentNumber}</span>
                  </td>
                  <td>
                    <span className={statusBadgeClass(inv.status)}>{inv.status.replace(/_/g, " ")}</span>
                  </td>
                  <td className="text-right font-mono text-xs">{inv.totalAmount}</td>
                  <td className="text-xs">{String(inv.dueDate).slice(0, 10)}</td>
                  <td className="text-right">
                    <Link href={`/academy/invoices/${inv.id}`} className="link-inline text-xs font-semibold">
                      Open
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={offset <= 0 || loading}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={loading || offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
