"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { AlertBanner, Button, PageHeader, SkeletonBlock, TableEmptyRow, TableLoadingRow } from "@/components/ui";

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
  const [loading, setLoading] = useState(false);

  const load = () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    Promise.all([
      academyApi.getFinanceDashboard(token),
      academyApi.listPayments(token, { verificationStatus: "pending" }),
    ])
      .then(([dash, pend]) => {
        setSummary(dash.summary as unknown as Summary);
        setRecent((dash.recentPayments as RecentRow[]) ?? []);
        setPending(((pend as { payments: RecentRow[] }).payments as RecentRow[]) ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load finance dashboard."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [token]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Finance"
        description="Academy billing overview and recent payment activity."
        actions={
          <>
            <Link href="/academy/invoices" className="btn-primary px-3 py-1.5 text-xs">
              Invoices
            </Link>
            <Button variant="ghost" size="sm" onClick={load} loading={loading}>
              Refresh
            </Button>
          </>
        }
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {loading && !summary ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading finance metrics">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="rounded-lg border border-security-navy-200 bg-white p-3">
              <SkeletonBlock className="h-3 w-28" />
              <SkeletonBlock className="mt-3 h-6 w-20" />
            </div>
          ))}
        </div>
      ) : summary ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Kpi label="Total billed (active invoices)" value={summary.totalBilled} />
          <Kpi label="Total collected (verified)" value={summary.totalCollected} />
          <Kpi label="Outstanding" value={summary.outstanding} />
          <Kpi label="Active invoices" value={String(summary.activeInvoiceCount)} />
          <Kpi label="Overdue invoices" value={String(summary.overdueInvoiceCount)} />
          <Kpi label="Payments pending verification" value={String(summary.pendingVerificationCount)} />
        </div>
      ) : null}

      <section className="card-dashboard p-4">
        <h2 className="font-medium">Pending verification</h2>
        {loading ? (
          <p className="mt-2 text-sm text-security-navy-500">Loading pending payments...</p>
        ) : pending.length === 0 ? (
          <p className="mt-2 text-sm text-security-navy-500">No payments are waiting for verification.</p>
        ) : (
          <ul className="mt-2 divide-y divide-security-navy-100 text-sm">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {p.invoiceNumber} · {p.studentLabel ?? "—"} ·{" "}
                  <span className="font-mono">{p.amount}</span>
                </span>
                <Link
                  href={p.invoiceId ? `/academy/invoices/${p.invoiceId}` : "/academy/invoices"}
                  className="text-xs font-semibold text-security-navy-700 hover:underline"
                >
                  Open invoice
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card-dashboard p-4">
        <h2 className="font-medium">Recent payments</h2>
        <div className="mt-2 overflow-x-auto">
            <table className="min-w-full divide-y divide-security-navy-100 text-sm" aria-busy={loading}>
              <caption className="sr-only">Recent Academy payments</caption>
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-security-navy-500">
                  <th scope="col">Invoice</th>
                  <th scope="col">Student</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableLoadingRow colSpan={5} label="Loading recent payments..." />
                ) : recent.length === 0 ? (
                  <TableEmptyRow colSpan={5} message="No payments have been recorded yet." />
                ) : (
                  recent.map((p) => (
                    <tr key={p.id}>
                      <td className="font-mono text-xs">{p.invoiceNumber ?? "—"}</td>
                      <td className="max-w-[200px] truncate text-xs">{p.studentLabel ?? "—"}</td>
                      <td className="font-mono text-xs">{p.amount}</td>
                      <td>{p.verificationStatus}</td>
                      <td className="font-mono text-xs">{p.receiptNumber ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-dashboard p-3">
      <p className="text-xs text-security-navy-500">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold">{value}</p>
    </div>
  );
}
