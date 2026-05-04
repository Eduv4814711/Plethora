"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

interface Summary {
  totalBilled: string;
  totalCollected: string;
  outstanding: string;
  overdueInvoiceCount: number;
  pendingVerificationCount: number;
  activeInvoiceCount: number;
}

interface RecentRow {
  id: string;
  invoiceId?: string;
  amount: string;
  verificationStatus: string;
  paymentDate: string;
  createdAt: string;
  invoiceNumber?: string;
  studentLabel?: string | null;
  receiptNumber?: string | null;
}

export default function AcademyFinancePage() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [pending, setPending] = useState<RecentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    Promise.all([
      academyApi.getFinanceDashboard(token),
      academyApi.listPayments(token, { verificationStatus: "pending" }),
    ])
      .then(([dash, pend]) => {
        setSummary(dash.summary as unknown as Summary);
        setRecent((dash.recentPayments as RecentRow[]) ?? []);
        setPending(((pend as { payments: RecentRow[] }).payments as RecentRow[]) ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  };

  useEffect(() => {
    load();
  }, [token]);

  return (
    <div className="module-shell">
      <div>
        <Link href="/academy" className="text-sm font-semibold text-security-navy-800 hover:underline lg:hidden">
          ← Academy
        </Link>
        <h1 className="page-title mt-1">Finance</h1>
        <p className="text-sm text-black">Academy billing overview and recent payment activity.</p>
      </div>

      {error && (
        <div className="rounded-md border-2 border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Kpi label="Total billed (active invoices)" value={summary.totalBilled} />
          <Kpi label="Total collected (verified)" value={summary.totalCollected} />
          <Kpi label="Outstanding" value={summary.outstanding} />
          <Kpi label="Active invoices" value={String(summary.activeInvoiceCount)} />
          <Kpi label="Overdue invoices" value={String(summary.overdueInvoiceCount)} />
          <Kpi label="Payments pending verification" value={String(summary.pendingVerificationCount)} />
        </div>
      )}

      <div className="flex gap-2">
        <Link href="/academy/invoices" className="btn-primary text-sm py-2 px-4">
          Invoices
        </Link>
        <button type="button" className="btn-ghost text-sm py-2 px-3" onClick={load}>
          Refresh
        </button>
      </div>

      <section className="rounded-lg border border-neutral-200 p-4">
        <h2 className="font-medium">Pending verification</h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-black">None.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-200 text-sm">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {p.invoiceNumber} · {p.studentLabel ?? "—"} ·{" "}
                  <span className="font-mono">{p.amount}</span>
                </span>
                <Link
                  href={p.invoiceId ? `/academy/invoices/${p.invoiceId}` : "/academy/invoices"}
                  className="text-xs font-semibold text-security-navy-800 underline hover:no-underline"
                >
                  Open invoice
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-neutral-200 p-4">
        <h2 className="font-medium">Recent payments</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-black">None yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="table-module">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Student</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.invoiceNumber ?? "—"}</td>
                    <td className="max-w-[200px] truncate text-xs">{p.studentLabel ?? "—"}</td>
                    <td className="font-mono text-xs">{p.amount}</td>
                    <td>{p.verificationStatus}</td>
                    <td className="font-mono text-xs">{p.receiptNumber ?? "—"}</td>
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

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <p className="text-xs text-sm text-black">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold">{value}</p>
    </div>
  );
}
