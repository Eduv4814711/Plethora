"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { getBillingSummary, type BillingSummary } from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency } from "@/lib/currency";

const SECTIONS = [
  {
    href: "/payroll/billing/quotes",
    title: "Quotes",
    description: "Draft, issue and track quotes. Accepted quotes convert to invoices in one click.",
  },
  {
    href: "/payroll/billing/invoices",
    title: "Invoices",
    description: "Issue tax invoices, record payments and hand out receipts.",
  },
  {
    href: "/payroll/billing/clients",
    title: "Clients & statements",
    description: "Purchase history per client and printable account statements.",
  },
];

export default function BillingHubPage() {
  const { token } = useAuth();
  const { settings } = useSettings();
  const currency = currencyFromSettings(settings);

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setSummary(await getBillingSummary(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing summary");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const tile = (label: string, value: string, hint?: string) => (
    <div className="rounded-security-lg border border-security-navy-100 bg-white p-4 dark:border-security-navy-700 dark:bg-security-navy-900">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold tabular-nums text-security-navy-900 dark:text-security-navy-100">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-security-navy-500">{hint}</p>}
    </div>
  );

  return (
    <main className="animate-fade-in space-y-6 pb-16">
      <header>
        <Link
          href="/payroll"
          className="inline-flex min-h-11 items-center text-sm font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
        >
          ← Back to payroll
        </Link>
        <h1 className="text-xl font-semibold text-security-navy-900 dark:text-security-navy-100">Client billing</h1>
        <p className="mt-1 text-sm text-security-navy-500 dark:text-security-navy-400">
          Quotes, invoices, receipts and client statements.
        </p>
      </header>

      {error && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          <span>{error}</span>
          <button type="button" className="min-h-11 font-semibold underline" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Loading summary">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-security-lg bg-security-navy-100 dark:bg-security-navy-700" />
          ))}
        </div>
      ) : summary ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {tile("Billed", formatCurrency(summary.totalBilled, { currency }), `${summary.activeInvoiceCount} active invoices`)}
            {tile("Collected", formatCurrency(summary.totalCollected, { currency }))}
            {tile("Outstanding", formatCurrency(summary.outstanding, { currency }))}
            {tile(
              "Overdue",
              String(summary.overdueInvoiceCount),
              summary.overdueInvoiceCount === 1 ? "invoice past due" : "invoices past due"
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-security-navy-900 dark:text-security-navy-100">
              Outstanding by age
            </h2>
            <div className="grid gap-2 sm:grid-cols-5">
              {(
                [
                  ["Current", summary.aging.current],
                  ["1–30 days", summary.aging.d1_30],
                  ["31–60 days", summary.aging.d31_60],
                  ["61–90 days", summary.aging.d61_90],
                  ["90+ days", summary.aging.d90_plus],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-security-navy-100 bg-security-navy-50 px-3 py-2 dark:border-security-navy-700 dark:bg-security-navy-900"
                >
                  <p className="text-[10px] uppercase tracking-wider text-security-navy-500">{label}</p>
                  <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-security-navy-900 dark:text-security-navy-100">
                    {formatCurrency(value, { currency })}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}

      <section className="grid gap-3 md:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="rounded-security-lg border border-security-navy-100 bg-white p-4 transition-colors hover:border-security-navy-400 dark:border-security-navy-700 dark:bg-security-navy-900"
          >
            <h2 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-100">{section.title}</h2>
            <p className="mt-1 text-sm text-security-navy-500 dark:text-security-navy-400">{section.description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
