"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { hasCapability } from "@/lib/permissions";
import {
  acceptQuote,
  convertQuoteToInvoice,
  declineQuote,
  downloadQuotePdf,
  getQuote,
  issueQuote,
  type Quote,
} from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency, formatQuantity } from "@/lib/currency";
import { StatusBadge } from "../../_components/status-badge";

export default function QuoteDetailPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const currency = currencyFromSettings(settings);

  const canApprove = user ? hasCapability(user, "/payroll/billing", "approve") : false;
  const canCreate = user ? hasCapability(user, "/payroll/billing", "create") : false;
  const canExport = user ? hasCapability(user, "/payroll/billing", "export") : false;

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setQuote(await getQuote(token, params.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quote");
    } finally {
      setLoading(false);
    }
  }, [token, params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs a workflow action and refreshes, surfacing any server-side rejection. */
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    if (!token || !quote) return;
    setBusy(true);
    setError(null);
    try {
      const invoice = await convertQuoteToInvoice(token, quote.id);
      router.push(`/payroll/billing/invoices/${invoice.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to convert quote");
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="h-72 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-700" aria-label="Loading quote" />;
  }

  if (!quote) {
    return (
      <main className="space-y-4">
        <Link href="/payroll/billing/quotes" className="text-sm font-medium text-security-navy-700 hover:underline">
          ← Back to quotes
        </Link>
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error ?? "Quote not found"}
        </p>
      </main>
    );
  }

  const convertedInvoice = quote.invoices?.[0];

  return (
    <main className="animate-fade-in space-y-5 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/payroll/billing/quotes"
            className="inline-flex min-h-11 items-center text-sm font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
          >
            ← Back to quotes
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{quote.quoteNumber}</h1>
            <StatusBadge status={quote.status} />
          </div>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {quote.client?.name} · {quote.quoteDate?.slice(0, 10)} · valid until {quote.validUntil?.slice(0, 10)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canExport && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() => downloadQuotePdf(token!, quote.id, `${quote.quoteNumber}.pdf`))
              }
              className="btn-secondary min-h-11 disabled:opacity-50"
            >
              Download PDF
            </button>
          )}
          {canApprove && quote.status === "draft" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => issueQuote(token!, quote.id))}
              className="btn-primary min-h-11 disabled:opacity-50"
            >
              Issue quote
            </button>
          )}
          {canApprove && quote.status === "issued" && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => declineQuote(token!, quote.id))}
                className="btn-secondary min-h-11 disabled:opacity-50"
              >
                Decline
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => acceptQuote(token!, quote.id))}
                className="btn-primary min-h-11 disabled:opacity-50"
              >
                Accept
              </button>
            </>
          )}
          {canCreate && quote.status === "accepted" && !convertedInvoice && (
            <button type="button" disabled={busy} onClick={convert} className="btn-primary min-h-11 disabled:opacity-50">
              Convert to invoice
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {convertedInvoice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <span>This quote was converted to invoice {convertedInvoice.invoiceNumber}.</span>
          <Link href={`/payroll/billing/invoices/${convertedInvoice.id}`} className="font-semibold underline">
            Open invoice
          </Link>
        </div>
      )}

      <section className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700">
        <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-700">
          <thead className="bg-neutral-50 dark:bg-neutral-900">
            <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-500">
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Unit price</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {quote.items.map((item, i) => (
              <tr key={item.id ?? i}>
                <td className="px-3 py-2">{item.description}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatQuantity(item.quantity)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatCurrency(item.unitAmount, { currency })}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatCurrency(item.lineTotal, { currency })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="ml-auto w-full max-w-xs space-y-1.5">
        <div className="flex justify-between text-sm text-neutral-700 dark:text-neutral-300">
          <span>Subtotal</span>
          <span className="font-mono tabular-nums">{formatCurrency(quote.subtotal, { currency })}</span>
        </div>
        {Number(quote.discountAmount) !== 0 && (
          <div className="flex justify-between text-sm text-neutral-700 dark:text-neutral-300">
            <span>Discount</span>
            <span className="font-mono tabular-nums">-{formatCurrency(quote.discountAmount, { currency })}</span>
          </div>
        )}
        <div className="flex justify-between text-sm text-neutral-700 dark:text-neutral-300">
          <span>VAT ({quote.vatRate}%)</span>
          <span className="font-mono tabular-nums">{formatCurrency(quote.vatAmount, { currency })}</span>
        </div>
        <div className="flex justify-between border-t border-neutral-300 pt-2 text-base font-bold text-neutral-900 dark:border-neutral-600 dark:text-neutral-100">
          <span>Total</span>
          <span className="font-mono tabular-nums">{formatCurrency(quote.totalAmount, { currency })}</span>
        </div>
      </section>

      {quote.notes && (
        <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Notes</h2>
          <p className="whitespace-pre-wrap text-neutral-800 dark:text-neutral-200">{quote.notes}</p>
        </section>
      )}
    </main>
  );
}
