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
  duplicateQuote,
  downloadQuotePdf,
  previewQuotePdf,
  getQuote,
  issueQuote,
  type Quote,
} from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency } from "@/lib/currency";
import { StatusBadge } from "../../_components/status-badge";
import { InvoiceDocument } from "../../_components/invoice-document";
import { BillingAccessRestricted } from "../../_components/billing-access-restricted";
import { clsx } from "clsx";

// Quote lifecycle pipeline
const QUOTE_LIFECYCLE: Array<{ status: string; label: string }> = [
  { status: "draft", label: "Draft" },
  { status: "issued", label: "Issued" },
  { status: "accepted", label: "Accepted" },
];

function QuoteLifecycleBar({ status }: { status: string }) {
  const declined = status === "declined";
  const expired = status === "expired";
  const cancelled = status === "cancelled";
  const activeLabel = (declined || expired || cancelled) ? "issued" : status;
  const activeIdx = QUOTE_LIFECYCLE.findIndex((s) => s.status === activeLabel);

  if (declined || expired || cancelled) {
    return (
      <div className={clsx(
        "inline-flex items-center gap-2 rounded-security border px-3 py-2",
        declined ? "border-red-200 bg-red-50" : "border-security-navy-200 bg-security-navy-50"
      )}>
        <span className={clsx("h-2 w-2 rounded-full", declined ? "bg-red-500" : "bg-security-navy-400")} />
        <span className={clsx("text-xs font-semibold", declined ? "text-red-700" : "text-security-navy-600")}>
          {declined ? "Quote Declined" : expired ? "Quote Expired" : "Quote Cancelled"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0">
      {QUOTE_LIFECYCLE.map((step, i) => {
        const isActive = i === activeIdx;
        const isPast = i < activeIdx;
        const isLast = i === QUOTE_LIFECYCLE.length - 1;
        return (
          <div key={step.status} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={clsx(
                "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold transition-colors",
                isPast && "bg-security-emerald-500 text-white",
                isActive && "bg-security-navy-900 text-white",
                !isPast && !isActive && "border-2 border-security-navy-200 bg-white text-security-navy-400"
              )}>
                {isPast ? "✓" : i + 1}
              </div>
              <span className={clsx(
                "mt-1 hidden whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide sm:block",
                isPast && "text-security-emerald-600",
                isActive && "text-security-navy-900",
                !isPast && !isActive && "text-security-navy-400"
              )}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div className={clsx("mx-1 h-0.5 w-8 sm:w-12 transition-colors", isPast ? "bg-security-emerald-400" : "bg-security-navy-200")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function QuoteDetailPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const currency = currencyFromSettings(settings);

  const canView = user ? hasCapability(user, "/payroll/billing", "view") : false;
  const canApprove = user ? hasCapability(user, "/payroll/billing", "approve") : false;
  const canCreate = user ? hasCapability(user, "/payroll/billing", "create") : false;
  const canExport = user ? hasCapability(user, "/payroll/billing", "export") : false;

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !canView) return;
    setLoading(true);
    setError(null);
    try {
      setQuote(await getQuote(token, params.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quote");
    } finally {
      setLoading(false);
    }
  }, [token, canView, params.id]);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      if (msg) { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(null), 4000); }
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
      setError(err instanceof Error ? err.message : "Failed to convert quote to invoice");
    } finally {
      setBusy(false);
    }
  };

  if (user && !canView) {
    return <BillingAccessRestricted />;
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="h-8 w-48 animate-pulse rounded-security bg-security-navy-100" />
        <div className="h-96 animate-pulse rounded-security-lg bg-security-navy-100" />
      </div>
    );
  }

  if (!quote) {
    return (
      <main className="space-y-4">
        <Link href="/payroll/billing/quotes" className="text-sm font-semibold text-security-navy-700 hover:underline">← Back to quotes</Link>
        <p className="rounded-security-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error ?? "Quote not found"}</p>
      </main>
    );
  }

  const convertedInvoice = quote.invoices?.[0];
  const isTerminal = ["declined", "expired", "cancelled", "accepted"].includes(quote.status);
  const isExpired = new Date(quote.validUntil) < new Date() && quote.status === "issued";

  return (
    <main className="animate-fade-in space-y-5 pb-16">
      {/* Header */}
      <header className="space-y-4">
        <Link href="/payroll/billing/quotes" className="section-title hover:underline">← Quotes</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="page-title">{quote.quoteNumber}</h1>
              <StatusBadge status={quote.status} />
              {isExpired && <span className="badge-warning text-[10px]">Expired</span>}
            </div>
            <p className="mt-1 text-sm text-security-navy-500">
              {quote.client?.name} · Valid until{" "}
              <span className={new Date(quote.validUntil) < new Date() ? "font-semibold text-red-600" : ""}>
                {new Date(quote.validUntil).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })}
              </span>
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {canExport && (
              <>
                <button type="button" disabled={busy} onClick={() => run(() => previewQuotePdf(token!, quote.id))} className="btn-secondary min-h-10">Preview PDF</button>
                <button type="button" disabled={busy} onClick={() => run(() => downloadQuotePdf(token!, quote.id, `${quote.quoteNumber}.pdf`))} className="btn-secondary min-h-10">Download PDF</button>
              </>
            )}
            {canCreate && (
              <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const dup = await duplicateQuote(token!, quote.id); router.push(`/payroll/billing/quotes/${dup.id}`); } catch (err) { setError(err instanceof Error ? err.message : "Failed"); setBusy(false); } }} className="btn-secondary min-h-10">
                Duplicate
              </button>
            )}
            {canApprove && quote.status === "draft" && (
              <button type="button" disabled={busy} onClick={() => run(() => issueQuote(token!, quote.id), "Quote issued.")} className="btn-amber min-h-10">
                Issue Quote
              </button>
            )}
            {canApprove && quote.status === "issued" && (
              <>
                <button type="button" disabled={busy} onClick={() => run(() => declineQuote(token!, quote.id), "Quote declined.")} className="btn-secondary min-h-10 border-red-200 text-red-700 hover:bg-red-50">
                  Decline
                </button>
                <button type="button" disabled={busy} onClick={() => run(() => acceptQuote(token!, quote.id), "Quote accepted.")} className="btn-primary min-h-10">
                  Accept
                </button>
              </>
            )}
            {canCreate && quote.status === "accepted" && !convertedInvoice && (
              <button type="button" disabled={busy} onClick={convert} className="btn-amber min-h-10">
                Convert to Invoice →
              </button>
            )}
          </div>
        </div>

        <QuoteLifecycleBar status={isExpired ? "expired" : quote.status} />
      </header>

      {/* Alert banners */}
      {error && <div className="rounded-security-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
      {successMsg && <div className="rounded-security-lg border border-security-emerald-200 bg-security-emerald-50 px-3 py-2 text-sm text-security-emerald-800" role="status">{successMsg}</div>}

      {/* Converted invoice banner */}
      {convertedInvoice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-security-lg border border-security-emerald-200 bg-security-emerald-50 px-4 py-3 text-sm text-security-emerald-700">
          <span>✓ Converted to invoice {convertedInvoice.invoiceNumber}</span>
          <Link href={`/payroll/billing/invoices/${convertedInvoice.id}`} className="font-semibold underline">
            Open invoice →
          </Link>
        </div>
      )}

      {/* Quote document */}
      <InvoiceDocument
        header={{
          type: "QUOTE",
          number: quote.quoteNumber,
          date: quote.quoteDate,
          dueOrValidUntil: quote.validUntil,
          status: isExpired ? "expired" : quote.status,
          reference: quote.reference,
          notes: quote.notes,
        }}
        party={{
          clientName: quote.client?.name ?? "Unknown",
          clientEmail: (quote.client as unknown as Record<string, string | null>)?.billingEmail ?? (quote.client as unknown as Record<string, string | null>)?.email,
          clientAddress: (quote.client as unknown as Record<string, string | null>)?.billingAddress,
          clientVatNumber: (quote.client as unknown as Record<string, string | null>)?.vatNumber,
          clientPhone: (quote.client as unknown as Record<string, string | null>)?.phone,
        }}
        financials={{
          subtotal: quote.subtotal,
          discountAmount: quote.discountAmount,
          vatRate: quote.vatRate,
          vatAmount: quote.vatAmount,
          totalAmount: quote.totalAmount,
        }}
        lines={quote.items}
        currency={currency}
      />

      {/* CTA for accepted quotes that haven't been converted yet */}
      {canCreate && quote.status === "accepted" && !convertedInvoice && (
        <div className="rounded-security-lg border border-security-emerald-200 bg-security-emerald-50 p-5 text-center">
          <p className="text-sm font-semibold text-security-emerald-800 mb-2">
            This quote has been accepted — convert it to a tax invoice to begin billing.
          </p>
          <button type="button" disabled={busy} onClick={convert} className="btn-amber">
            {busy ? "Converting…" : "Convert to Invoice →"}
          </button>
        </div>
      )}
    </main>
  );
}
