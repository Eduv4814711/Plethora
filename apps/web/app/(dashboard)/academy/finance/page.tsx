"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { academyApi } from "@/lib/api";
import { AcademyInvoicesPanel } from "@/components/academy/invoices-panel";
import { clsx } from "clsx";

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

type TabId = "overview" | "invoices";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "invoices", label: "Invoices" },
];

function isTab(value: string | null | undefined): value is TabId {
  return value === "overview" || value === "invoices";
}

function formatMoney(fmt: Intl.NumberFormat, raw: string): string {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return raw;
  return fmt.format(n);
}

function VerificationBadge({ status }: { status: string }) {
  const cls =
    status === "verified"
      ? "badge-success"
      : status === "rejected"
        ? "badge-error"
        : "badge-warning";
  return <span className={cls}>{status.replace(/_/g, " ")}</span>;
}

export default function AcademyFinancePage() {
  const { token } = useAuth();
  const { settings } = useSettings();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab") ?? null;
  const activeTab: TabId = isTab(tabParam) ? tabParam : "overview";

  const currency = settings?.settings?.currency ?? "ZAR";
  const moneyFmt = useMemo(
    () => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }),
    [currency]
  );

  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [pending, setPending] = useState<RecentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      academyApi.getFinanceDashboard(token),
      academyApi.listPayments(token, { verificationStatus: "pending" }),
    ])
      .then(([dash, pend]) => {
        setSummary(dash.summary as unknown as Summary);
        setRecent((dash.recentPayments as RecentRow[]) ?? []);
        setPending(((pend as { payments: RecentRow[] }).payments as RecentRow[]) ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (activeTab === "overview") load();
  }, [token, activeTab]);

  const setTab = (next: TabId) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "overview") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(`/academy/finance${qs ? `?${qs}` : ""}`);
  };

  return (
    <div className="module-shell">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/academy" className="link-inline text-sm font-semibold lg:hidden">
            ← Academy
          </Link>
          <p className="label-text">Module · Academy</p>
          <h1 className="page-title mt-1">Finance</h1>
          <p className="mt-1 max-w-xl text-sm text-black">
            Billing overview, invoices, and payment verification — in one place.
          </p>
        </div>
        {activeTab === "overview" && (
          <button type="button" className="btn-secondary text-sm" onClick={load} disabled={loading}>
            <svg
              className={clsx("h-4 w-4", loading && "animate-spin")}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5m11 11v-5h-5M5.5 14a8 8 0 0014 4M18.5 10a8 8 0 00-14-4" />
            </svg>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </header>

      {/* Tabs */}
      <div className="segmented self-start" role="tablist" aria-label="Finance views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={clsx("segmented-option", activeTab === t.id && "segmented-option-active")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      {activeTab === "overview" && (
        <>
          {/* KPIs */}
          {summary ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <li className="kpi-tile">
                <p className="kpi-label">Total billed (active)</p>
                <p className="kpi-value mt-1">{formatMoney(moneyFmt, summary.totalBilled)}</p>
              </li>
              <li className="kpi-tile">
                <p className="kpi-label">Total collected</p>
                <p className="kpi-value mt-1">{formatMoney(moneyFmt, summary.totalCollected)}</p>
              </li>
              <li className="kpi-tile">
                <p className="kpi-label">Outstanding</p>
                <p className="kpi-value mt-1">{formatMoney(moneyFmt, summary.outstanding)}</p>
                {summary.overdueInvoiceCount > 0 && (
                  <p className="caption mt-0.5">{summary.overdueInvoiceCount} overdue</p>
                )}
              </li>
              <li className="kpi-tile">
                <p className="kpi-label">Active invoices</p>
                <p className="kpi-value mt-1 tabular-nums">{summary.activeInvoiceCount.toLocaleString()}</p>
              </li>
              <li className="kpi-tile">
                <p className="kpi-label">Overdue invoices</p>
                <p className="kpi-value mt-1 tabular-nums">{summary.overdueInvoiceCount.toLocaleString()}</p>
              </li>
              <li className="kpi-tile">
                <p className="kpi-label">Payments pending verification</p>
                <p className="kpi-value mt-1 tabular-nums">{summary.pendingVerificationCount.toLocaleString()}</p>
              </li>
            </ul>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <li key={i} className="kpi-tile animate-pulse">
                  <div className="h-2.5 w-32 rounded-full bg-[var(--bg-nav-hover)]" />
                  <div className="mt-2 h-6 w-24 rounded-md bg-[var(--bg-nav-hover)]" />
                </li>
              ))}
            </ul>
          )}

          {/* Pending verification */}
          <section aria-labelledby="finance-pending" className="card-wireframe overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline)] px-4 py-3 sm:px-5">
              <div>
                <h2 id="finance-pending" className="section-title">
                  Pending verification
                </h2>
                <p className="mt-0.5 text-sm text-black">Payments awaiting confirmation by an admin.</p>
              </div>
              <button type="button" className="btn-secondary text-xs" onClick={() => setTab("invoices")}>
                View invoices
              </button>
            </div>
            {pending.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-black sm:px-5">None — all clear.</p>
            ) : (
              <ul className="divide-y divide-[var(--hairline)] text-sm">
                {pending.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-black">
                        {p.invoiceNumber ?? "—"}
                      </p>
                      <p className="mt-0.5 text-xs text-black/80">
                        {p.studentLabel ?? "Unattached payment"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm tabular-nums text-black">
                        {formatMoney(moneyFmt, p.amount)}
                      </span>
                      <Link
                        href={p.invoiceId ? `/academy/invoices/${p.invoiceId}` : "/academy/finance?tab=invoices"}
                        className="link-inline text-xs font-semibold"
                      >
                        Open invoice
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recent payments */}
          <section aria-labelledby="finance-recent">
            <h2 id="finance-recent" className="section-title">
              Recent payments
            </h2>
            {recent.length === 0 ? (
              <div className="mt-3 rounded-security-lg border border-dashed border-[var(--hairline-strong)] bg-white p-6 text-center text-sm text-black">
                No payments recorded yet.
              </div>
            ) : (
              <div className="mt-3 table-scroll">
                <table className="table-module">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Student</th>
                      <th className="text-right">Amount</th>
                      <th>Status</th>
                      <th>Receipt</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((p) => (
                      <tr key={p.id}>
                        <td className="font-mono text-xs">{p.invoiceNumber ?? "—"}</td>
                        <td className="max-w-[220px] truncate text-xs">{p.studentLabel ?? "—"}</td>
                        <td className="text-right font-mono text-xs tabular-nums">
                          {formatMoney(moneyFmt, p.amount)}
                        </td>
                        <td>
                          <VerificationBadge status={p.verificationStatus} />
                        </td>
                        <td className="font-mono text-xs">{p.receiptNumber ?? "—"}</td>
                        <td className="text-xs">{String(p.paymentDate ?? p.createdAt).slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {activeTab === "invoices" && <AcademyInvoicesPanel hideHeader />}
    </div>
  );
}
