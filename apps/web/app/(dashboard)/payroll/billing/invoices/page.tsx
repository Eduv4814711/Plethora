"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { hasCapability } from "@/lib/permissions";
import {
  createInvoice,
  duplicateInvoice,
  deleteInvoice,
  downloadInvoicePdf,
  previewInvoicePdf,
  exportInvoicesToCsv,
  listBillableClients,
  listInvoices,
  previewDocumentNumber,
  type BillableClient,
  type Invoice,
  type InvoiceStatus,
} from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency } from "@/lib/currency";
import { StatusBadge } from "../_components/status-badge";
import { computeTotalsPreview, DocumentTotals } from "../_components/document-totals";
import { emptyLine, LineItemsEditor, type EditableLine } from "../_components/line-items-editor";
import { BillingAccessRestricted } from "../_components/billing-access-restricted";
import { clsx } from "clsx";

const STATUSES: Array<InvoiceStatus | "all"> = [
  "all", "draft", "issued", "partially_paid", "paid", "overdue", "cancelled",
];

const STATUS_LABEL: Record<string, string> = {
  all: "All", draft: "Draft", issued: "Issued", partially_paid: "Partially Paid",
  paid: "Paid", overdue: "Overdue", cancelled: "Cancelled",
};

function today(): string { return new Date().toISOString().slice(0, 10); }

function PaymentProgressBar({ amountPaid, total }: { amountPaid: string | number | null | undefined; total: string | number }) {
  const paid = Number(amountPaid ?? 0);
  const tot = Number(total);
  const pct = tot > 0 ? Math.min(100, (paid / tot) * 100) : 0;
  if (pct === 0) return null;
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-security-navy-100">
      <div
        className={clsx("h-full rounded-full transition-all duration-500", pct >= 100 ? "bg-security-emerald-400" : "bg-security-amber-400")}
        style={{ width: `${pct.toFixed(1)}%` }}
      />
    </div>
  );
}

function isOverdueFn(inv: Invoice): boolean {
  return inv.status === "overdue" || (
    (inv.status === "issued" || inv.status === "partially_paid") &&
    new Date(inv.dueDate) < new Date()
  );
}

export default function InvoicesPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const currency = currencyFromSettings(settings);
  const canView = user ? hasCapability(user, "/payroll/billing", "view") : false;
  const canCreate = user ? hasCapability(user, "/payroll/billing", "create") : false;
  const canEdit = user ? hasCapability(user, "/payroll/billing", "edit") : false;
  const canDelete = user ? hasCapability(user, "/payroll/billing", "delete") : false;
  const canExport = user ? hasCapability(user, "/payroll/billing", "export") : false;

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<BillableClient[]>([]);
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clientId, setClientId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [numberingMode, setNumberingMode] = useState<"auto" | "manual">("auto");
  const [manualInvoiceNumber, setManualInvoiceNumber] = useState("");
  const [nextInvoiceNumberPreview, setNextInvoiceNumberPreview] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
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
      const [invoiceRes, clientRes] = await Promise.all([
        listInvoices(token, {
          ...(status === "all" ? {} : { status }),
          ...(clientFilter ? { clientId: clientFilter } : {}),
          ...(siteFilter ? { siteId: siteFilter } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(fromDate ? { from: fromDate } : {}),
          ...(toDate ? { to: toDate } : {}),
        }),
        listBillableClients(token),
      ]);
      setInvoices(invoiceRes.invoices);
      setClients(clientRes.clients);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [token, canView, status, clientFilter, siteFilter, search, fromDate, toDate]);

  useEffect(() => { void load(); }, [load]);

  // Preview invoice number dynamically based on selected client & site
  useEffect(() => {
    if (!showForm || !token || !clientId) {
      setNextInvoiceNumberPreview("");
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    previewDocumentNumber(token, "invoice", {
      clientId,
      siteId: siteId || null,
    })
      .then((res) => {
        if (!cancelled) setNextInvoiceNumberPreview(res.nextNumber);
      })
      .catch(() => {
        if (!cancelled) setNextInvoiceNumberPreview("");
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, showForm, clientId, siteId]);

  if (user && !canView) {
    return <BillingAccessRestricted />;
  }

  const totals = useMemo(() => computeTotalsPreview(lines, discount, vatRate), [lines, discount, vatRate]);

  // Summary counts & amounts
  const overdueInvoices = invoices.filter(isOverdueFn);
  const overdueCount = overdueInvoices.length;
  const overdueAmount = overdueInvoices.reduce((acc, inv) => acc + Number(inv.amountDue ?? inv.totalAmount), 0);
  const draftInvoices = invoices.filter((inv) => inv.status === "draft");
  const draftCount = draftInvoices.length;
  const draftAmount = draftInvoices.reduce((acc, inv) => acc + Number(inv.totalAmount), 0);
  const totalInvoiced = invoices.reduce((acc, inv) => acc + Number(inv.totalAmount), 0);
  const totalDue = invoices.reduce((acc, inv) => acc + Number(inv.amountDue ?? inv.totalAmount), 0);
  const totalPaid = invoices.reduce((acc, inv) => acc + Number(inv.amountPaid ?? 0), 0);

  const resetForm = () => {
    setClientId("");
    setSiteId("");
    setNumberingMode("auto");
    setManualInvoiceNumber("");
    setNextInvoiceNumberPreview("");
    setInvoiceDate(today());
    setDueDate("");
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
    if (!clientId) { setError("Select a client for this invoice."); return; }
    if (numberingMode === "manual" && !manualInvoiceNumber.trim()) {
      setError("Please enter a manual invoice number.");
      return;
    }
    if (usable.length === 0) { setError("Add at least one line item."); return; }
    setSaving(true);
    setError(null);
    try {
      await createInvoice(token, {
        clientId,
        siteId: siteId || null,
        invoiceNumber: numberingMode === "manual" && manualInvoiceNumber.trim() ? manualInvoiceNumber.trim() : undefined,
        invoiceDate,
        ...(dueDate ? { dueDate } : {}),
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
      setError(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (fn: () => Promise<void>, id: string) => {
    setActionLoadingId(id);
    setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : "Action failed"); }
    finally { setActionLoadingId(null); }
  };

  const handleDeleteInvoice = async (id: string, invoiceNumber: string) => {
    if (!token) return;
    if (!window.confirm(`Are you sure you want to permanently delete draft invoice ${invoiceNumber}?`)) return;
    setActionLoadingId(id);
    try {
      await deleteInvoice(token, id);
      setActionSuccess(`Invoice ${invoiceNumber} deleted`);
      await load();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete invoice");
    } finally {
      setActionLoadingId(null);
    }
  };

  const hasActiveFilters = Boolean(status !== "all" || search.trim() || clientFilter || siteFilter || fromDate || toDate);
  const resetFilters = () => { setStatus("all"); setSearch(""); setClientFilter(""); setSiteFilter(""); setFromDate(""); setToDate(""); };

  return (
    <main className="animate-fade-in space-y-5 pb-16">
      {/* Header */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/payroll/billing" className="section-title hover:underline">
              ← Client Billing
            </Link>
            <h1 className="page-title mt-0.5">Invoices</h1>
            <p className="mt-1 text-sm text-security-navy-500">
              Create, issue, and track all client invoices.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canExport && invoices.length > 0 && (
              <button type="button" onClick={() => exportInvoicesToCsv(invoices)} className="btn-secondary min-h-10">
                Export CSV
              </button>
            )}
            {canCreate && (
              <button type="button" onClick={() => setShowForm((o) => !o)} className="btn-primary min-h-10">
                {showForm ? "Close" : "New Invoice"}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Summary bar */}
      {!loading && invoices.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Invoice summary">
          <div className="rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card">
            <p className="section-title">Total Invoiced</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-security-navy-900">
              {formatCurrency(totalInvoiced, { currency })}
            </p>
            <p className="text-xs text-security-navy-500">{invoices.length} invoice{invoices.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card">
            <p className="section-title">Collected</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-security-emerald-700">
              {formatCurrency(totalPaid, { currency })}
            </p>
            <p className="text-xs text-security-navy-500">
              {totalInvoiced > 0 ? `${((totalPaid / totalInvoiced) * 100).toFixed(1)}% recovery` : "0% recovery"}
            </p>
          </div>
          <div className="rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card">
            <p className="section-title">Outstanding</p>
            <p className={`mt-1 font-mono text-2xl font-bold tabular-nums ${totalDue > 0 ? (overdueCount > 0 ? "text-red-700" : "text-security-amber-700") : "text-security-navy-400"}`}>
              {formatCurrency(totalDue, { currency })}
            </p>
            {overdueCount > 0 ? (
              <p className="text-xs font-semibold text-red-600">⚠ {formatCurrency(overdueAmount, { currency })} ({overdueCount} overdue)</p>
            ) : (
              <p className="text-xs text-security-emerald-600">All balances current</p>
            )}
          </div>
          <div className="rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card">
            <p className="section-title">Draft Invoices</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-security-navy-700">
              {formatCurrency(draftAmount, { currency })}
            </p>
            <p className="text-xs text-security-navy-500">{draftCount} in preparation</p>
          </div>
        </section>
      )}

      {actionSuccess && (
        <div className="rounded-security-lg border border-security-emerald-200 bg-security-emerald-50 px-3 py-2 text-sm text-security-emerald-800" role="status">
          {actionSuccess}
        </div>
      )}
      {error && (
        <div className="rounded-security-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {/* New Invoice Form */}
      {showForm && canCreate && (
        <form onSubmit={submit} className="space-y-4 rounded-security-lg border border-security-navy-200 bg-white p-5 shadow-security-card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-security-navy-900">New Invoice</h2>
          </div>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className="label-text mb-1.5 block">Client <span className="text-red-500">*</span></span>
                <select
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value);
                    setSiteId("");
                  }}
                  className="input-modern w-full"
                  required
                  id="new-invoice-client"
                >
                  <option value="">Select client…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>

              {(() => {
                const selClient = clients.find((c) => c.id === clientId);
                if (!selClient?.sites || selClient.sites.length === 0) return null;
                return (
                  <label className="block">
                    <span className="label-text mb-1.5 block">Site (optional)</span>
                    <select
                      value={siteId}
                      onChange={(e) => setSiteId(e.target.value)}
                      className="input-modern w-full"
                      id="new-invoice-site"
                    >
                      <option value="">All Sites / Client-wide</option>
                      {selClient.sites.map((s) => (
                        <option key={s.siteId} value={s.siteId}>
                          {s.siteName}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })()}

              <label className="block">
                <span className="label-text mb-1.5 block">Invoice date</span>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input-modern w-full" required id="new-invoice-date" />
              </label>

              <label className="block">
                <span className="label-text mb-1.5 block">Due date</span>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-modern w-full" id="new-invoice-due-date" />
              </label>

              <label className="block">
                <span className="label-text mb-1.5 block">Reference</span>
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" className="input-modern w-full" id="new-invoice-ref" />
              </label>
            </div>
          </div>

          {/* Invoice Numbering Section */}
          <div className="rounded-security-md border border-security-navy-200 bg-security-navy-50/70 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-security-navy-700">Invoice Numbering</span>
              <div className="inline-flex rounded-security bg-security-navy-200/60 p-0.5" role="radiogroup" aria-label="Invoice numbering mode">
                <button
                  type="button"
                  onClick={() => setNumberingMode("auto")}
                  className={clsx(
                    "px-3 py-1 text-xs font-semibold rounded-security transition-all",
                    numberingMode === "auto"
                      ? "bg-white text-security-navy-900 shadow-sm"
                      : "text-security-navy-600 hover:text-security-navy-900"
                  )}
                  id="invoice-number-mode-auto"
                >
                  ● Automatic
                </button>
                <button
                  type="button"
                  onClick={() => setNumberingMode("manual")}
                  className={clsx(
                    "px-3 py-1 text-xs font-semibold rounded-security transition-all",
                    numberingMode === "manual"
                      ? "bg-white text-security-navy-900 shadow-sm"
                      : "text-security-navy-600 hover:text-security-navy-900"
                  )}
                  id="invoice-number-mode-manual"
                >
                  ○ Manual
                </button>
              </div>
            </div>

            {numberingMode === "auto" ? (
              <div className="flex items-center justify-between rounded-security border border-security-navy-200 bg-white px-3 py-2 text-xs">
                <span className="text-security-navy-600">Next number to be generated:</span>
                <span className="font-mono font-bold text-security-amber-700">
                  {loadingPreview ? "Checking…" : nextInvoiceNumberPreview || (clientId ? "Generated on save (e.g. INV-0001)" : "Select a client first")}
                </span>
              </div>
            ) : (
              <label className="block">
                <span className="label-text mb-1 block">Manual Invoice Number <span className="text-red-500">*</span></span>
                <input
                  type="text"
                  value={manualInvoiceNumber}
                  onChange={(e) => setManualInvoiceNumber(e.target.value)}
                  placeholder="e.g. INV-WOL-0027"
                  className="input-modern w-full font-mono text-sm"
                  required={numberingMode === "manual"}
                  id="manual-invoice-number"
                />
                <span className="mt-1 block text-[11px] text-security-navy-500">
                  Specify a custom or historical invoice number. It will be verified to prevent duplicates.
                </span>
              </label>
            )}
          </div>

          <LineItemsEditor token={token ?? ""} clientId={clientId} siteId={siteId || undefined} lines={lines} onChange={setLines} currency={currency} disabled={saving} />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="label-text mb-1.5 block">Discount</span>
                  <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className="input-modern w-full text-right" id="new-invoice-discount" />
                </label>
                <label className="block">
                  <span className="label-text mb-1.5 block">VAT %</span>
                  <input value={vatRate} onChange={(e) => setVatRate(e.target.value)} inputMode="decimal" className="input-modern w-full text-right" id="new-invoice-vat" />
                </label>
              </div>
              <label className="block">
                <span className="label-text mb-1.5 block">Notes</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input-modern w-full" placeholder="Banking details, payment terms, notes to print on invoice" id="new-invoice-notes" />
              </label>
            </div>
            <DocumentTotals totals={totals} currency={currency} vatRate={vatRate} />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : "Create Invoice"}</button>
          </div>
        </form>
      )}

      {/* Filter toolbar */}
      <div className="space-y-3 rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="label-text mb-1 block">Search</span>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice #, client, reference…" className="input-modern w-full" id="invoice-search" />
          </label>
          <label className="block">
            <span className="label-text mb-1 block">Client</span>
            <select
              value={clientFilter}
              onChange={(e) => {
                setClientFilter(e.target.value);
                setSiteFilter("");
              }}
              className="input-modern w-full"
              id="invoice-client-filter"
            >
              <option value="">All clients</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {(() => {
            const selClient = clients.find((c) => c.id === clientFilter);
            if (!selClient?.sites || selClient.sites.length === 0) return null;
            return (
              <label className="block">
                <span className="label-text mb-1 block">Site</span>
                <select
                  value={siteFilter}
                  onChange={(e) => setSiteFilter(e.target.value)}
                  className="input-modern w-full"
                  id="invoice-site-filter"
                >
                  <option value="">All sites</option>
                  {selClient.sites.map((s) => (
                    <option key={s.siteId} value={s.siteId}>
                      {s.siteName}
                    </option>
                  ))}
                </select>
              </label>
            );
          })()}
          <label className="block">
            <span className="label-text mb-1 block">From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="input-modern w-full" id="invoice-from-date" />
          </label>
          <label className="block">
            <span className="label-text mb-1 block">To</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="input-modern w-full" id="invoice-to-date" />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
                className={clsx(
                  "rounded-security border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                  status === s
                    ? "border-security-navy-900 bg-security-navy-900 text-white"
                    : "border-security-navy-200 bg-white text-security-navy-600 hover:border-security-navy-300 hover:bg-security-navy-50"
                )}
              >
                {STATUS_LABEL[s] ?? s}
              </button>
            ))}
          </div>
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="text-xs font-semibold text-security-navy-500 hover:underline">
              Reset filters
            </button>
          )}
        </div>
      </div>

      {/* Invoice table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-security-lg bg-security-navy-100" />)}
        </div>
      ) : invoices.length === 0 ? (
        <div className="rounded-security-lg border border-security-navy-100 bg-white px-4 py-12 text-center shadow-security-card">
          <p className="text-sm text-security-navy-500">No invoices match your filters.</p>
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="mt-2 text-sm font-semibold text-security-amber-700 hover:underline">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-security-lg border border-security-navy-100 bg-white shadow-security-card">
          <table className="min-w-full divide-y divide-security-navy-50 text-sm">
            <thead className="bg-security-navy-50">
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3 hidden sm:table-cell">Date</th>
                <th className="px-4 py-3 hidden sm:table-cell">Due</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right hidden md:table-cell">Paid</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 hidden md:table-cell">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-security-navy-50">
              {invoices.map((invoice) => {
                const isOverdue = isOverdueFn(invoice);
                const due = Number(invoice.amountDue ?? invoice.totalAmount);
                const paid = Number(invoice.amountPaid ?? 0);
                const total = Number(invoice.totalAmount);
                const paidPct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
                const isLoading = actionLoadingId === invoice.id;
                return (
                  <tr
                    key={invoice.id}
                    className={clsx(
                      "group hover:bg-security-navy-50/50 transition-colors",
                      isOverdue && "bg-red-50/40"
                    )}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/payroll/billing/invoices/${invoice.id}`}
                        className="font-mono font-semibold text-security-navy-900 hover:text-security-amber-700 hover:underline"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                      {invoice.reference && (
                        <p className="text-[11px] text-security-navy-500">{invoice.reference}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-0.5">
                        <span className="font-medium text-security-navy-800">
                          {invoice.client?.name ?? "—"}
                        </span>
                        {invoice.site?.name && (
                          <span className="inline-flex items-center rounded-full bg-security-navy-100 px-2 py-0.5 text-[10px] font-medium text-security-navy-700">
                            📍 {invoice.site.name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 tabular-nums text-security-navy-600 sm:table-cell">
                      {invoice.invoiceDate?.slice(0, 10)}
                    </td>
                    <td className={`hidden px-4 py-3 tabular-nums sm:table-cell ${isOverdue ? "font-semibold text-red-700" : "text-security-navy-600"}`}>
                      {invoice.dueDate?.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono tabular-nums font-semibold text-security-navy-900">
                        {formatCurrency(total, { currency })}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-right md:table-cell">
                      <div>
                        <span className="font-mono tabular-nums text-security-emerald-700">
                          {formatCurrency(paid, { currency })}
                        </span>
                        {paidPct > 0 && paidPct < 100 && (
                          <PaymentProgressBar amountPaid={paid} total={total} />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-mono tabular-nums font-semibold ${due > 0 ? (isOverdue ? "text-red-700" : "text-security-navy-900") : "text-security-emerald-600"}`}>
                        {formatCurrency(due, { currency })}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/payroll/billing/invoices/${invoice.id}`}
                          className="btn-ghost min-h-8 px-2 py-1 text-xs"
                        >
                          {invoice.status === "draft" && canEdit ? "Edit" : "View"}
                        </Link>
                        {canExport && (
                          <button
                            type="button"
                            onClick={() => handleAction(() => previewInvoicePdf(token!, invoice.id), invoice.id)}
                            disabled={isLoading}
                            className="btn-ghost min-h-8 px-2 py-1 text-xs"
                            title="Preview PDF"
                          >
                            PDF
                          </button>
                        )}
                        {canCreate && (
                          <button
                            type="button"
                            onClick={() => handleAction(async () => {
                              const dup = await duplicateInvoice(token!, invoice.id);
                              setActionSuccess(`Duplicated as ${dup.invoiceNumber}`);
                              await load();
                              setTimeout(() => setActionSuccess(null), 5000);
                            }, invoice.id)}
                            disabled={isLoading}
                            className="btn-ghost min-h-8 px-2 py-1 text-xs"
                            title="Duplicate"
                          >
                            Copy
                          </button>
                        )}
                        {invoice.status === "draft" && canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDeleteInvoice(invoice.id, invoice.invoiceNumber)}
                            disabled={isLoading}
                            className="btn-ghost min-h-8 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                            title="Delete draft invoice"
                          >
                            Delete
                          </button>
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
