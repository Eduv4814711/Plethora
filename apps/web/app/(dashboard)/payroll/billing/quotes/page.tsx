"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { hasCapability } from "@/lib/permissions";
import {
  createQuote,
  duplicateQuote,
  downloadQuotePdf,
  previewQuotePdf,
  exportQuotesToCsv,
  listBillableClients,
  listQuotes,
  type BillableClient,
  type Quote,
  type QuoteStatus,
} from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency } from "@/lib/currency";
import { StatusBadge } from "../_components/status-badge";
import { computeTotalsPreview, DocumentTotals } from "../_components/document-totals";
import { emptyLine, LineItemsEditor, type EditableLine } from "../_components/line-items-editor";
import { BillingAccessRestricted } from "../_components/billing-access-restricted";
import { clsx } from "clsx";

const STATUSES: Array<QuoteStatus | "all"> = [
  "all", "draft", "issued", "accepted", "declined", "expired", "cancelled",
];

const STATUS_LABEL: Record<string, string> = {
  all: "All", draft: "Draft", issued: "Issued", accepted: "Accepted",
  declined: "Declined", expired: "Expired", cancelled: "Cancelled",
};

function today(): string { return new Date().toISOString().slice(0, 10); }
function plusDays(days: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function QuotesPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const currency = currencyFromSettings(settings);
  const canView = user ? hasCapability(user, "/payroll/billing", "view") : false;
  const canCreate = user ? hasCapability(user, "/payroll/billing", "create") : false;
  const canExport = user ? hasCapability(user, "/payroll/billing", "export") : false;

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clients, setClients] = useState<BillableClient[]>([]);
  const [status, setStatus] = useState<QuoteStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clientMode, setClientMode] = useState<"existing" | "prospect">("existing");
  const [clientId, setClientId] = useState("");
  const [prospectName, setProspectName] = useState("");
  const [prospectEmail, setProspectEmail] = useState("");
  const [prospectPhone, setProspectPhone] = useState("");
  const [prospectAddress, setProspectAddress] = useState("");
  const [quoteDate, setQuoteDate] = useState(today);
  const [validUntil, setValidUntil] = useState(() => plusDays(30));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0.00");
  const [vatRate, setVatRate] = useState("15");
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()]);

  const load = useCallback(async () => {
    if (!token || !canView) return;
    setLoading(true);
    setError(null);
    try {
      const [quoteRes, clientRes] = await Promise.all([
        listQuotes(token, {
          ...(status === "all" ? {} : { status }),
          ...(clientFilter ? { clientId: clientFilter } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(fromDate ? { from: fromDate } : {}),
          ...(toDate ? { to: toDate } : {}),
        }),
        listBillableClients(token),
      ]);
      setQuotes(quoteRes.quotes);
      setClients(clientRes.clients);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quotes");
    } finally {
      setLoading(false);
    }
  }, [token, canView, status, clientFilter, search, fromDate, toDate]);

  useEffect(() => { void load(); }, [load]);

  if (user && !canView) {
    return <BillingAccessRestricted />;
  }

  const totals = useMemo(() => computeTotalsPreview(lines, discount, vatRate), [lines, discount, vatRate]);

  // Pipeline stats for the funnel overview
  const pipelineStats = useMemo(() => ({
    draft: quotes.filter((q) => q.status === "draft").length,
    issued: quotes.filter((q) => q.status === "issued").length,
    accepted: quotes.filter((q) => q.status === "accepted").length,
    declined: quotes.filter((q) => q.status === "declined").length,
  }), [quotes]);

  const totalQuoteValue = useMemo(
    () => quotes.reduce((acc, q) => acc + Number(q.totalAmount), 0),
    [quotes]
  );

  const acceptedValue = useMemo(
    () => quotes.filter((q) => q.status === "accepted").reduce((acc, q) => acc + Number(q.totalAmount), 0),
    [quotes]
  );

  const resetForm = () => {
    setClientMode("existing");
    setClientId("");
    setProspectName("");
    setProspectEmail("");
    setProspectPhone("");
    setProspectAddress("");
    setQuoteDate(today());
    setValidUntil(plusDays(30));
    setReference("");
    setNotes("");
    setDiscount("0.00");
    setVatRate("15");
    setLines([emptyLine()]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const usable = lines.filter((l) => l.description.trim() !== "");
    if (clientMode === "existing" && !clientId) {
      setError("Select an existing client for this quote.");
      return;
    }
    if (clientMode === "prospect" && !prospectName.trim()) {
      setError("Enter the business name for the potential client.");
      return;
    }
    if (usable.length === 0) {
      setError("Add at least one line item.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createQuote(token, {
        clientId: clientMode === "existing" ? clientId : null,
        prospectName: clientMode === "prospect" ? prospectName.trim() : null,
        prospectEmail: clientMode === "prospect" && prospectEmail.trim() ? prospectEmail.trim() : null,
        prospectPhone: clientMode === "prospect" && prospectPhone.trim() ? prospectPhone.trim() : null,
        prospectAddress: clientMode === "prospect" && prospectAddress.trim() ? prospectAddress.trim() : null,
        quoteDate,
        validUntil,
        reference: reference || null,
        notes: notes || null,
        discountAmount: discount,
        vatRate,
        items: usable,
      });
      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create quote");
    } finally {
      setSaving(false);
    }
  };

  const hasActiveFilters = Boolean(status !== "all" || search.trim() || clientFilter || fromDate || toDate);
  const resetFilters = () => { setStatus("all"); setSearch(""); setClientFilter(""); setFromDate(""); setToDate(""); };

  return (
    <main className="animate-fade-in space-y-5 pb-16">
      {/* Header */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/payroll/billing" className="section-title hover:underline">← Client Billing</Link>
            <h1 className="page-title mt-0.5">Quotes</h1>
            <p className="mt-1 text-sm text-security-navy-500">Create and manage client quotes. Convert accepted quotes to invoices.</p>
          </div>
          <div className="flex items-center gap-2">
            {canExport && quotes.length > 0 && (
              <button type="button" onClick={() => exportQuotesToCsv(quotes)} className="btn-secondary min-h-10">Export CSV</button>
            )}
            {canCreate && (
              <button type="button" onClick={() => setShowForm((o) => !o)} className="btn-primary min-h-10">{showForm ? "Close" : "New Quote"}</button>
            )}
          </div>
        </div>
      </header>

      {/* Pipeline funnel */}
      {!loading && quotes.length > 0 && (
        <section className="grid gap-3 grid-cols-2 sm:grid-cols-4" aria-label="Quote pipeline">
          {[
            { label: "Draft", count: pipelineStats.draft, color: "text-security-navy-600", bg: "bg-security-navy-50 border-security-navy-200", handler: () => setStatus("draft") },
            { label: "Issued", count: pipelineStats.issued, color: "text-blue-700", bg: "bg-blue-50 border-blue-200", handler: () => setStatus("issued") },
            { label: "Accepted", count: pipelineStats.accepted, color: "text-security-emerald-700", bg: "bg-security-emerald-50 border-security-emerald-200", handler: () => setStatus("accepted") },
            { label: "Declined", count: pipelineStats.declined, color: "text-red-700", bg: "bg-red-50 border-red-200", handler: () => setStatus("declined") },
          ].map((bucket) => (
            <button
              key={bucket.label}
              type="button"
              onClick={bucket.handler}
              className={clsx("rounded-security-lg border p-3 text-left transition-all hover:opacity-80 active:scale-[0.98]", bucket.bg)}
            >
              <p className={clsx("font-mono text-2xl font-bold tabular-nums", bucket.color)}>{bucket.count}</p>
              <p className={clsx("text-xs font-semibold", bucket.color)}>{bucket.label}</p>
            </button>
          ))}
        </section>
      )}

      {/* Value summary */}
      {!loading && quotes.length > 0 && (
        <div className="flex flex-wrap items-center gap-6 rounded-security-lg border border-security-navy-100 bg-white px-5 py-3 shadow-security-card">
          <div>
            <p className="section-title">Total Quote Value</p>
            <p className="font-mono text-lg font-bold tabular-nums text-security-navy-900">{formatCurrency(totalQuoteValue, { currency })}</p>
          </div>
          <div>
            <p className="section-title">Accepted Value</p>
            <p className="font-mono text-lg font-bold tabular-nums text-security-emerald-700">{formatCurrency(acceptedValue, { currency })}</p>
          </div>
          {totalQuoteValue > 0 && (
            <div>
              <p className="section-title">Win Rate</p>
              <p className="font-mono text-lg font-bold tabular-nums text-security-navy-700">
                {((acceptedValue / totalQuoteValue) * 100).toFixed(0)}%
              </p>
            </div>
          )}
        </div>
      )}

      {actionSuccess && <div className="rounded-security-lg border border-security-emerald-200 bg-security-emerald-50 px-3 py-2 text-sm text-security-emerald-800" role="status">{actionSuccess}</div>}
      {error && <div className="rounded-security-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}

      {/* New Quote form */}
      {showForm && canCreate && (
        <form onSubmit={submit} className="space-y-4 rounded-security-lg border border-security-navy-200 bg-white p-5 shadow-security-card">
          <h2 className="text-sm font-semibold text-security-navy-900">New Quote</h2>
          {/* Client Selection (Existing Client vs Potential Client) */}
          <div className="rounded-security-md border border-security-navy-200 bg-security-navy-50/70 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-security-navy-700">Client Selection</span>
              <div className="inline-flex rounded-security bg-security-navy-200/60 p-0.5" role="radiogroup" aria-label="Client mode">
                <button
                  type="button"
                  onClick={() => setClientMode("existing")}
                  className={clsx(
                    "px-3 py-1 text-xs font-semibold rounded-security transition-all",
                    clientMode === "existing"
                      ? "bg-white text-security-navy-900 shadow-sm"
                      : "text-security-navy-600 hover:text-security-navy-900"
                  )}
                  id="client-mode-existing"
                >
                  🏢 Existing Client
                </button>
                <button
                  type="button"
                  onClick={() => setClientMode("prospect")}
                  className={clsx(
                    "px-3 py-1 text-xs font-semibold rounded-security transition-all",
                    clientMode === "prospect"
                      ? "bg-white text-security-navy-900 shadow-sm"
                      : "text-security-navy-600 hover:text-security-navy-900"
                  )}
                  id="client-mode-prospect"
                >
                  ✨ Potential Client / New Business
                </button>
              </div>
            </div>

            {clientMode === "existing" ? (
              <div>
                <label className="block">
                  <span className="label-text mb-1 block">Choose Existing Client <span className="text-red-500">*</span></span>
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="input-modern w-full"
                    required={clientMode === "existing"}
                    id="new-quote-client"
                  >
                    <option value="">Select client…</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="label-text mb-1 block">Business / Company Name <span className="text-red-500">*</span></span>
                    <input
                      value={prospectName}
                      onChange={(e) => setProspectName(e.target.value)}
                      placeholder="e.g. Apex Logistics (Pty) Ltd"
                      className="input-modern w-full"
                      required={clientMode === "prospect"}
                      id="new-quote-prospect-name"
                    />
                  </label>
                  <label className="block">
                    <span className="label-text mb-1 block">Contact Email (optional)</span>
                    <input
                      type="email"
                      value={prospectEmail}
                      onChange={(e) => setProspectEmail(e.target.value)}
                      placeholder="e.g. procurement@apexlogistics.co.za"
                      className="input-modern w-full"
                      id="new-quote-prospect-email"
                    />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="label-text mb-1 block">Contact Phone (optional)</span>
                    <input
                      value={prospectPhone}
                      onChange={(e) => setProspectPhone(e.target.value)}
                      placeholder="e.g. +27 11 555 1234"
                      className="input-modern w-full"
                      id="new-quote-prospect-phone"
                    />
                  </label>
                  <label className="block">
                    <span className="label-text mb-1 block">Billing / Physical Address (optional)</span>
                    <input
                      value={prospectAddress}
                      onChange={(e) => setProspectAddress(e.target.value)}
                      placeholder="e.g. 14 Katherine St, Sandton"
                      className="input-modern w-full"
                      id="new-quote-prospect-address"
                    />
                  </label>
                </div>
                <p className="text-[11px] text-security-navy-500">
                  💡 This quote will be prepared for a potential client. When accepted and converted to an invoice, the system will automatically create their client account.
                </p>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="label-text mb-1.5 block">Quote date</span>
              <input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} className="input-modern w-full" required id="new-quote-date" />
            </label>
            <label className="block">
              <span className="label-text mb-1.5 block">Valid until</span>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="input-modern w-full" required id="new-quote-valid-until" />
            </label>
            <label className="block">
              <span className="label-text mb-1.5 block">Reference</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" className="input-modern w-full" id="new-quote-ref" />
            </label>
          </div>

          <LineItemsEditor token={token ?? ""} clientId={clientMode === "existing" ? clientId : ""} lines={lines} onChange={setLines} currency={currency} disabled={saving} />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="label-text mb-1.5 block">Discount</span>
                  <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className="input-modern w-full text-right" id="new-quote-discount" />
                </label>
                <label className="block">
                  <span className="label-text mb-1.5 block">VAT %</span>
                  <input value={vatRate} onChange={(e) => setVatRate(e.target.value)} inputMode="decimal" className="input-modern w-full text-right" id="new-quote-vat" />
                </label>
              </div>
              <label className="block">
                <span className="label-text mb-1.5 block">Notes</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input-modern w-full" placeholder="Terms, scope of work, anything to print on the quote" id="new-quote-notes" />
              </label>
            </div>
            <DocumentTotals totals={totals} currency={currency} vatRate={vatRate} />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : "Create Quote"}</button>
          </div>
        </form>
      )}

      {/* Filter toolbar */}
      <div className="space-y-3 rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="label-text mb-1 block">Search</span>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Quote #, client, reference…" className="input-modern w-full" id="quote-search" />
          </label>
          <label className="block">
            <span className="label-text mb-1 block">Client</span>
            <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="input-modern w-full" id="quote-client-filter">
              <option value="">All clients</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label-text mb-1 block">From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="input-modern w-full" id="quote-from-date" />
          </label>
          <label className="block">
            <span className="label-text mb-1 block">To</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="input-modern w-full" id="quote-to-date" />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button key={s} type="button" onClick={() => setStatus(s)} aria-pressed={status === s}
                className={clsx("rounded-security border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                  status === s ? "border-security-navy-900 bg-security-navy-900 text-white" : "border-security-navy-200 bg-white text-security-navy-600 hover:border-security-navy-300 hover:bg-security-navy-50"
                )}>
                {STATUS_LABEL[s] ?? s}
              </button>
            ))}
          </div>
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="text-xs font-semibold text-security-navy-500 hover:underline">Reset filters</button>
          )}
        </div>
      </div>

      {/* Quotes table */}
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-security-lg bg-security-navy-100" />)}</div>
      ) : quotes.length === 0 ? (
        <div className="rounded-security-lg border border-security-navy-100 bg-white px-4 py-12 text-center shadow-security-card">
          <p className="text-sm text-security-navy-500">No quotes match your filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-security-lg border border-security-navy-100 bg-white shadow-security-card">
          <table className="min-w-full divide-y divide-security-navy-50 text-sm">
            <thead className="bg-security-navy-50">
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
                <th className="px-4 py-3">Quote</th>
                <th className="px-4 py-3">Client</th>
                <th className="hidden px-4 py-3 sm:table-cell">Date</th>
                <th className="hidden px-4 py-3 sm:table-cell">Valid Until</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="hidden px-4 py-3 md:table-cell">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-security-navy-50">
              {quotes.map((quote) => {
                const isExpired = new Date(quote.validUntil) < new Date() && quote.status === "issued";
                const isAccepted = quote.status === "accepted";
                const hasInvoice = (quote.invoices?.length ?? 0) > 0;
                return (
                  <tr key={quote.id} className={clsx("group hover:bg-security-navy-50/50 transition-colors", isExpired && "bg-security-navy-50/60")}>
                    <td className="px-4 py-3">
                      <Link href={`/payroll/billing/quotes/${quote.id}`} className="font-mono font-semibold text-security-navy-900 hover:text-security-amber-700 hover:underline">
                        {quote.quoteNumber}
                      </Link>
                      {isExpired && <span className="ml-1 badge-warning text-[9px]">Expired</span>}
                      {isAccepted && !hasInvoice && <span className="ml-1 badge-success text-[9px]">Ready to convert</span>}
                      {quote.reference && <p className="text-[11px] text-security-navy-500">{quote.reference}</p>}
                    </td>
                    <td className="px-4 py-3 font-medium text-security-navy-800">
                      <div className="flex items-center gap-1.5">
                        <span>{quote.client?.name || quote.prospectName || "—"}</span>
                        {!quote.clientId && quote.prospectName && (
                          <span className="inline-flex items-center rounded-full bg-security-amber-50 px-2 py-0.5 text-[10px] font-semibold text-security-amber-700 ring-1 ring-inset ring-security-amber-600/20">
                            Potential
                          </span>
                        )}
                      </div>
                      {quote.prospectEmail && (
                        <p className="text-[11px] text-security-navy-400">{quote.prospectEmail}</p>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 tabular-nums text-security-navy-600 sm:table-cell">{quote.quoteDate?.slice(0, 10)}</td>
                    <td className={clsx("hidden px-4 py-3 tabular-nums sm:table-cell", isExpired ? "font-semibold text-red-600" : "text-security-navy-600")}>
                      {quote.validUntil?.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono font-semibold tabular-nums text-security-navy-900">{formatCurrency(quote.totalAmount, { currency })}</span>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell"><StatusBadge status={isExpired ? "expired" : quote.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/payroll/billing/quotes/${quote.id}`} className="btn-ghost min-h-8 px-2 py-1 text-xs">View</Link>
                        {canExport && (
                          <button type="button" onClick={async () => { setActionLoadingId(quote.id); try { await previewQuotePdf(token!, quote.id); } finally { setActionLoadingId(null); } }} disabled={actionLoadingId === quote.id} className="btn-ghost min-h-8 px-2 py-1 text-xs">PDF</button>
                        )}
                        {canCreate && (
                          <button type="button" onClick={async () => { setActionLoadingId(quote.id); try { const dup = await duplicateQuote(token!, quote.id); setActionSuccess(`Duplicated as ${dup.quoteNumber}`); await load(); setTimeout(() => setActionSuccess(null), 5000); } catch (err) { setError(err instanceof Error ? err.message : "Failed"); } finally { setActionLoadingId(null); }}} disabled={actionLoadingId === quote.id} className="btn-ghost min-h-8 px-2 py-1 text-xs">Copy</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
