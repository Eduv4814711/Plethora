"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { hasCapability } from "@/lib/permissions";
import {
  downloadStatementPdf,
  getClientHistory,
  getClientStatement,
  type ClientStatement,
  type Invoice,
  type Quote,
} from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency } from "@/lib/currency";
import { StatusBadge } from "../../_components/status-badge";

/** First day of the current year — a sensible default statement window. */
function startOfYear(): string {
  return `${new Date().getUTCFullYear()}-01-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ClientStatementPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const params = useParams<{ id: string }>();
  const currency = currencyFromSettings(settings);
  const canExport = user ? hasCapability(user, "/payroll/billing", "export") : false;

  const [from, setFrom] = useState(startOfYear);
  const [to, setTo] = useState(today);
  const [statement, setStatement] = useState<ClientStatement | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [statementRes, historyRes] = await Promise.all([
        getClientStatement(token, params.id, from, to),
        getClientHistory(token, params.id),
      ]);
      setStatement(statementRes);
      setQuotes(historyRes.quotes);
      setInvoices(historyRes.invoices);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load statement");
    } finally {
      setLoading(false);
    }
  }, [token, params.id, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async () => {
    if (!token || !statement) return;
    setBusy(true);
    setError(null);
    try {
      await downloadStatementPdf(
        token,
        params.id,
        from,
        to,
        `Statement ${statement.client.name} ${from} to ${to}.pdf`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download statement");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="animate-fade-in space-y-5 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/payroll/billing/clients"
            className="inline-flex min-h-11 items-center text-sm font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
          >
            ← Back to clients
          </Link>
          <h1 className="text-xl font-semibold text-security-navy-900 dark:text-security-navy-100">
            {statement?.client.name ?? "Client statement"}
          </h1>
          <p className="mt-1 text-sm text-security-navy-500 dark:text-security-navy-400">
            Account statement and purchase history.
          </p>
        </div>
        {canExport && (
          <button
            type="button"
            onClick={download}
            disabled={busy || loading || !statement}
            className="btn-primary min-h-11 disabled:opacity-50"
          >
            {busy ? "Preparing…" : "Download statement PDF"}
          </button>
        )}
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input-modern mt-1"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-modern mt-1" />
        </label>
      </div>

      {loading ? (
        <div className="h-64 animate-pulse rounded-security-lg bg-security-navy-100 dark:bg-security-navy-700" aria-label="Loading statement" />
      ) : statement ? (
        <>
          <section className="overflow-x-auto rounded-security-lg border border-security-navy-100 dark:border-security-navy-700">
            <table className="min-w-full divide-y divide-security-navy-100 text-sm dark:divide-security-navy-700">
              <thead className="bg-security-navy-50 dark:bg-security-navy-900">
                <tr className="text-left text-[10px] uppercase tracking-wider text-security-navy-500">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-100 dark:divide-security-navy-800">
                <tr className="bg-security-navy-50 font-semibold dark:bg-security-navy-900">
                  <td className="px-3 py-2" colSpan={4}>
                    Opening balance
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatCurrency(statement.openingBalance, { currency })}
                  </td>
                </tr>
                {statement.transactions.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-security-navy-500" colSpan={5}>
                      No transactions in this period.
                    </td>
                  </tr>
                ) : (
                  statement.transactions.map((t) => (
                    <tr key={`${t.kind}-${t.documentId}`}>
                      <td className="px-3 py-2">{t.date}</td>
                      <td className="px-3 py-2">
                        {t.kind === "invoice" && t.reference ? (
                          <Link
                            href={`/payroll/billing/invoices/${t.documentId}`}
                            className="text-security-navy-700 hover:underline dark:text-security-navy-300"
                          >
                            {t.description} · {t.reference}
                          </Link>
                        ) : (
                          <>
                            {t.description}
                            {t.reference ? ` · ${t.reference}` : ""}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {Number(t.debit) ? formatCurrency(t.debit, { currency }) : ""}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {Number(t.credit) ? formatCurrency(t.credit, { currency }) : ""}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatCurrency(t.balance, { currency })}
                      </td>
                    </tr>
                  ))
                )}
                <tr className="border-t-2 border-security-navy-800 font-bold dark:border-security-navy-200">
                  <td className="px-3 py-2" colSpan={4}>
                    Closing balance
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatCurrency(statement.closingBalance, { currency })}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-security-navy-900 dark:text-security-navy-100">Outstanding by age</h2>
            <div className="grid gap-2 sm:grid-cols-5">
              {(
                [
                  ["Current", statement.aging.current],
                  ["1–30 days", statement.aging.d1_30],
                  ["31–60 days", statement.aging.d31_60],
                  ["61–90 days", statement.aging.d61_90],
                  ["90+ days", statement.aging.d90_plus],
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

          <section className="grid gap-4 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-security-navy-900 dark:text-security-navy-100">Invoices</h2>
              {invoices.length === 0 ? (
                <p className="rounded-security-lg border border-security-navy-100 bg-security-navy-50 px-4 py-6 text-center text-sm text-security-navy-600 dark:border-security-navy-700 dark:bg-security-navy-900">
                  No invoices yet.
                </p>
              ) : (
                <ul className="divide-y divide-security-navy-100 rounded-security-lg border border-security-navy-100 dark:divide-security-navy-800 dark:border-security-navy-700">
                  {invoices.map((invoice) => (
                    <li key={invoice.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <Link
                        href={`/payroll/billing/invoices/${invoice.id}`}
                        className="font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                      <span className="text-security-navy-500">{invoice.invoiceDate?.slice(0, 10)}</span>
                      <span className="font-mono tabular-nums">
                        {formatCurrency(invoice.totalAmount, { currency })}
                      </span>
                      <StatusBadge status={invoice.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold text-security-navy-900 dark:text-security-navy-100">Quotes</h2>
              {quotes.length === 0 ? (
                <p className="rounded-security-lg border border-security-navy-100 bg-security-navy-50 px-4 py-6 text-center text-sm text-security-navy-600 dark:border-security-navy-700 dark:bg-security-navy-900">
                  No quotes yet.
                </p>
              ) : (
                <ul className="divide-y divide-security-navy-100 rounded-security-lg border border-security-navy-100 dark:divide-security-navy-800 dark:border-security-navy-700">
                  {quotes.map((quote) => (
                    <li key={quote.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <Link
                        href={`/payroll/billing/quotes/${quote.id}`}
                        className="font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
                      >
                        {quote.quoteNumber}
                      </Link>
                      <span className="text-security-navy-500">{quote.quoteDate?.slice(0, 10)}</span>
                      <span className="font-mono tabular-nums">
                        {formatCurrency(quote.totalAmount, { currency })}
                      </span>
                      <StatusBadge status={quote.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
