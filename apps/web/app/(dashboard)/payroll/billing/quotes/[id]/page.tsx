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
  getClientSitesBilling,
  previewDocumentNumber,
  previewQuotePdf,
  getQuote,
  issueQuote,
  type Quote,
  type SiteBillingSummary,
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

  // Convert to Invoice Modal State
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [clientSites, setClientSites] = useState<SiteBillingSummary[]>([]);
  const [convertSiteId, setConvertSiteId] = useState("");
  const [convertNumberingMode, setConvertNumberingMode] = useState<"auto" | "manual">("auto");
  const [convertManualNumber, setConvertManualNumber] = useState("");
  const [convertNumberPreview, setConvertNumberPreview] = useState("");
  const [convertLoadingPreview, setConvertLoadingPreview] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

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

  // Load client sites if the quote is linked to an existing client
  useEffect(() => {
    if (!token || !quote?.clientId) {
      setClientSites([]);
      return;
    }
    getClientSitesBilling(token, quote.clientId)
      .then((res) => {
        setClientSites(res.sites || []);
      })
      .catch(() => {
        setClientSites([]);
      });
  }, [token, quote?.clientId]);

  // Live preview for invoice number when convert modal is open
  useEffect(() => {
    if (!showConvertModal || !token) return;
    let cancelled = false;
    setConvertLoadingPreview(true);
    previewDocumentNumber(token, "invoice", {
      clientId: quote?.clientId || null,
      siteId: convertSiteId || null,
    })
      .then((res) => {
        if (!cancelled) setConvertNumberPreview(res.nextNumber);
      })
      .catch(() => {
        if (!cancelled) setConvertNumberPreview("");
      })
      .finally(() => {
        if (!cancelled) setConvertLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showConvertModal, token, quote?.clientId, convertSiteId]);

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

  const openConvertModal = () => {
    setConvertSiteId(quote?.siteId || "");
    setConvertNumberingMode("auto");
    setConvertManualNumber("");
    setConvertError(null);
    setShowConvertModal(true);
  };

  const executeConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !quote) return;
    if (convertNumberingMode === "manual" && !convertManualNumber.trim()) {
      setConvertError("Please enter a manual invoice number.");
      return;
    }
    setBusy(true);
    setConvertError(null);
    try {
      const invoice = await convertQuoteToInvoice(token, quote.id, {
        siteId: convertSiteId || null,
        invoiceNumber: convertNumberingMode === "manual" ? convertManualNumber.trim() : undefined,
      });
      setShowConvertModal(false);
      router.push(`/payroll/billing/invoices/${invoice.id}`);
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : "Failed to convert quote to invoice");
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
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-security-navy-500">
              <span className="font-semibold text-security-navy-900">{quote.client?.name || quote.prospectName || "—"}</span>
              {!quote.clientId && quote.prospectName && (
                <span className="inline-flex items-center rounded-full bg-security-amber-50 px-2 py-0.5 text-[10px] font-semibold text-security-amber-700 ring-1 ring-inset ring-security-amber-600/20">
                  Potential Client
                </span>
              )}
              {quote.site?.name && (
                <span className="inline-flex items-center rounded-full bg-security-navy-100 px-2 py-0.5 text-[10px] font-medium text-security-navy-700">
                  📍 {quote.site.name}
                </span>
              )}
              <span>· Valid until{" "}
                <span className={new Date(quote.validUntil) < new Date() ? "font-semibold text-red-600" : ""}>
                  {new Date(quote.validUntil).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })}
                </span>
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
              <button type="button" disabled={busy} onClick={openConvertModal} className="btn-amber min-h-10">
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
          clientName: quote.client?.name ?? quote.prospectName ?? "Unknown",
          clientEmail: quote.client
            ? ((quote.client as unknown as Record<string, string | null>)?.billingEmail ?? (quote.client as unknown as Record<string, string | null>)?.email)
            : quote.prospectEmail,
          clientAddress: quote.client
            ? (quote.client as unknown as Record<string, string | null>)?.billingAddress
            : quote.prospectAddress,
          clientVatNumber: quote.client
            ? (quote.client as unknown as Record<string, string | null>)?.vatNumber
            : null,
          clientPhone: quote.client
            ? (quote.client as unknown as Record<string, string | null>)?.phone
            : quote.prospectPhone,
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
          <p className="text-sm font-semibold text-security-emerald-800 mb-1">
            This quote has been accepted — convert it to a tax invoice to begin billing.
          </p>
          {!quote.clientId && quote.prospectName && (
            <p className="text-xs text-security-emerald-700 mb-3">
              Converting will automatically onboard <strong>{quote.prospectName}</strong> as a client record in your system.
            </p>
          )}
          <button type="button" disabled={busy} onClick={openConvertModal} className="btn-amber">
            {busy ? "Converting…" : "Convert to Invoice →"}
          </button>
        </div>
      )}

      {/* Convert to Invoice Modal */}
      {showConvertModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="convert-modal-title"
        >
          <div className="w-full max-w-lg rounded-security-lg border border-security-navy-200 bg-white p-6 shadow-xl space-y-5 animate-scale-in">
            <div className="flex items-start justify-between">
              <div>
                <h2 id="convert-modal-title" className="text-lg font-bold text-security-navy-900">
                  Convert Quote to Tax Invoice
                </h2>
                <p className="text-xs text-security-navy-500 mt-0.5">
                  Quote <span className="font-mono font-semibold text-security-navy-700">{quote.quoteNumber}</span> → New Invoice
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowConvertModal(false)}
                className="text-security-navy-400 hover:text-security-navy-600 font-bold"
              >
                ✕
              </button>
            </div>

            {convertError && (
              <div className="rounded-security-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {convertError}
              </div>
            )}

            <form onSubmit={executeConvert} className="space-y-4">
              {/* Client & Target Site */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-security-navy-700">
                  Target Client
                </label>
                <div className="rounded-security border border-security-navy-100 bg-security-navy-50/50 px-3 py-2 text-sm text-security-navy-900 font-medium">
                  {quote.client?.name || quote.prospectName || "—"}
                  {!quote.clientId && (
                    <span className="ml-2 text-xs text-security-amber-700">
                      (Will be created as a new billable client)
                    </span>
                  )}
                </div>
              </div>

              {clientSites.length > 0 && (
                <label className="block">
                  <span className="label-text mb-1.5 block">Target Site (optional)</span>
                  <select
                    value={convertSiteId}
                    onChange={(e) => setConvertSiteId(e.target.value)}
                    className="input-modern w-full"
                    id="convert-target-site"
                  >
                    <option value="">All Sites / Client-wide</option>
                    {clientSites.map((s) => (
                      <option key={s.siteId} value={s.siteId}>
                        {s.siteName}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] text-security-navy-500">
                    Selecting a site applies that site's invoice prefix and sequence configuration.
                  </span>
                </label>
              )}

              {/* Invoice Numbering Section */}
              <div className="rounded-security-md border border-security-navy-200 bg-security-navy-50/70 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-security-navy-700">
                    Invoice Numbering
                  </span>
                  <div className="inline-flex rounded-security bg-security-navy-200/60 p-0.5" role="radiogroup" aria-label="Invoice numbering mode">
                    <button
                      type="button"
                      onClick={() => setConvertNumberingMode("auto")}
                      className={clsx(
                        "px-3 py-1 text-xs font-semibold rounded-security transition-all",
                        convertNumberingMode === "auto"
                          ? "bg-white text-security-navy-900 shadow-sm"
                          : "text-security-navy-600 hover:text-security-navy-900"
                      )}
                      id="convert-number-mode-auto"
                    >
                      ● Automatic
                    </button>
                    <button
                      type="button"
                      onClick={() => setConvertNumberingMode("manual")}
                      className={clsx(
                        "px-3 py-1 text-xs font-semibold rounded-security transition-all",
                        convertNumberingMode === "manual"
                          ? "bg-white text-security-navy-900 shadow-sm"
                          : "text-security-navy-600 hover:text-security-navy-900"
                      )}
                      id="convert-number-mode-manual"
                    >
                      ○ Manual
                    </button>
                  </div>
                </div>

                {convertNumberingMode === "auto" ? (
                  <div className="flex items-center justify-between rounded-security border border-security-navy-200 bg-white px-3 py-2 text-xs">
                    <span className="text-security-navy-600">Next number to be generated:</span>
                    <span className="font-mono font-bold text-security-amber-700">
                      {convertLoadingPreview ? "Checking…" : convertNumberPreview || "Generated on save (e.g. INV-0001)"}
                    </span>
                  </div>
                ) : (
                  <label className="block">
                    <span className="label-text mb-1 block">Manual Invoice Number <span className="text-red-500">*</span></span>
                    <input
                      type="text"
                      value={convertManualNumber}
                      onChange={(e) => setConvertManualNumber(e.target.value)}
                      placeholder="e.g. INV-WOL-0027"
                      className="input-modern w-full font-mono text-sm"
                      required={convertNumberingMode === "manual"}
                      id="convert-manual-number"
                    />
                    <span className="mt-1 block text-[11px] text-security-navy-500">
                      Specify a custom or historical invoice number. It will be validated to prevent collisions.
                    </span>
                  </label>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConvertModal(false)}
                  disabled={busy}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="btn-amber"
                  id="confirm-convert-btn"
                >
                  {busy ? "Converting…" : "Confirm & Create Invoice"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
