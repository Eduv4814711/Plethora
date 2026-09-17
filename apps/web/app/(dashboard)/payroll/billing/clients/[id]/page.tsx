"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { hasCapability } from "@/lib/permissions";
import {
  downloadInvoicePdf,
  downloadQuotePdf,
  downloadStatementPdf,
  previewInvoicePdf,
  previewQuotePdf,
  previewStatementPdf,
  getClientHistory,
  getClientStatement,
  getClientSitesBilling,
  getSiteBillingDetail,
  updateSiteBillingRate,
  type ClientStatement,
  type Invoice,
  type Quote,
  type ClientSitesBillingResponse,
  type SiteBillingDetailResponse,
} from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency } from "@/lib/currency";
import { StatusBadge } from "../../_components/status-badge";
import { ArRiskBadge, computeArRisk } from "../../_components/ar-risk-badge";
import { BillingAccessRestricted } from "../../_components/billing-access-restricted";
import { clsx } from "clsx";

function startOfYear(): string { return `${new Date().getUTCFullYear()}-01-01`; }
function today(): string { return new Date().toISOString().slice(0, 10); }

function getPresetRange(preset: "this_month" | "last_month" | "last_30" | "last_90" | "ytd" | "all") {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  switch (preset) {
    case "this_month": return { from: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`, to };
    case "last_month": {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const last = new Date(first.getTime() - 86400000);
      const firstPrev = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1));
      return { from: firstPrev.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
    }
    case "last_30": return { from: new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10), to };
    case "last_90": return { from: new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10), to };
    case "ytd": return { from: `${now.getUTCFullYear()}-01-01`, to };
    case "all": return { from: "2020-01-01", to };
  }
}

type TabId = "overview" | "statement" | "invoices" | "quotes" | "sites";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "statement", label: "Statement" },
  { id: "invoices", label: "Invoices" },
  { id: "quotes", label: "Quotes" },
  { id: "sites", label: "Sites & Rates" },
];

export default function ClientStatementPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  // Resolve initial tab from ?tab= query param
  const rawTab = searchParams.get("tab");
  const initialTab: TabId =
    rawTab === "statement" ? "statement" :
    rawTab === "history" ? "invoices" :
    rawTab === "sites" ? "sites" :
    rawTab === "quotes" ? "quotes" :
    "overview";

  const currency = currencyFromSettings(settings);
  const canView = user ? hasCapability(user, "/payroll/billing", "view") : false;
  const canExport = user ? hasCapability(user, "/payroll/billing", "export") : false;
  const canEdit = user ? hasCapability(user, "/payroll/billing", "edit") || hasCapability(user, "/payroll/billing", "create") : false;

  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [from, setFrom] = useState(startOfYear);
  const [to, setTo] = useState(today);
  const [statement, setStatement] = useState<ClientStatement | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clientSitesBilling, setClientSitesBilling] = useState<ClientSitesBillingResponse | null>(null);
  const [selectedSiteModal, setSelectedSiteModal] = useState<SiteBillingDetailResponse | null>(null);
  const [loadingSiteModal, setLoadingSiteModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rate modal state
  const [rateInput, setRateInput] = useState("");
  const [effectiveFromInput, setEffectiveFromInput] = useState(today);
  const [effectiveToInput, setEffectiveToInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [savingRate, setSavingRate] = useState(false);
  const [rateModalError, setRateModalError] = useState<string | null>(null);
  const [rateModalSuccess, setRateModalSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !canView) return;
    setLoading(true);
    setError(null);
    try {
      const [statementRes, historyRes, sitesRes] = await Promise.all([
        getClientStatement(token, params.id, from, to),
        getClientHistory(token, params.id),
        getClientSitesBilling(token, params.id),
      ]);
      setStatement(statementRes);
      setQuotes(historyRes.quotes);
      setInvoices(historyRes.invoices);
      setClientSitesBilling(sitesRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load client billing data");
    } finally {
      setLoading(false);
    }
  }, [token, canView, params.id, from, to]);

  useEffect(() => { void load(); }, [load]);

  const openSiteRateModal = async (siteId: string) => {
    if (!token) return;
    setLoadingSiteModal(true);
    setRateModalError(null);
    setRateModalSuccess(null);
    try {
      const detail = await getSiteBillingDetail(token, params.id, siteId);
      setSelectedSiteModal(detail);
      setRateInput(detail.billing.ratePerGuard ?? "");
      setEffectiveFromInput(detail.billing.effectiveFrom ? detail.billing.effectiveFrom.slice(0, 10) : today());
      setEffectiveToInput(detail.billing.effectiveTo ? detail.billing.effectiveTo.slice(0, 10) : "");
      setNotesInput(detail.billing.notes ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load site billing detail");
    } finally {
      setLoadingSiteModal(false);
    }
  };

  const handleSaveRate = async () => {
    if (!token || !selectedSiteModal) return;
    const numRate = Number(rateInput);
    if (!numRate || numRate <= 0) { setRateModalError("Rate must be a positive amount."); return; }
    if (!effectiveFromInput) { setRateModalError("Effective from date is required."); return; }
    setSavingRate(true);
    setRateModalError(null);
    try {
      await updateSiteBillingRate(token, params.id, selectedSiteModal.site.id, {
        ratePerGuard: numRate, billingMethod: "PER_GUARD",
        effectiveFrom: effectiveFromInput, effectiveTo: effectiveToInput || null,
        notes: notesInput.trim() || null,
      });
      setRateModalSuccess("Rate saved successfully.");
      const [updatedSites, updatedDetail] = await Promise.all([
        getClientSitesBilling(token, params.id),
        getSiteBillingDetail(token, params.id, selectedSiteModal.site.id),
      ]);
      setClientSitesBilling(updatedSites);
      setSelectedSiteModal(updatedDetail);
    } catch (err) {
      setRateModalError(err instanceof Error ? err.message : "Failed to save rate");
    } finally {
      setSavingRate(false);
    }
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : "Action failed"); }
    finally { setBusy(false); }
  };

  // Derived values
  const clientName = statement?.client.name ?? clientSitesBilling?.clientName ?? "Client Billing";
  const outstanding = Number(statement?.closingBalance ?? 0);
  const totalDebits = statement?.transactions.reduce((acc, tx) => acc + Number(tx.debit || 0), 0) ?? 0;
  const totalCredits = statement?.transactions.reduce((acc, tx) => acc + Number(tx.credit || 0), 0) ?? 0;
  const overdueInvoices = invoices.filter((inv) => inv.status === "overdue" || (
    (inv.status === "issued" || inv.status === "partially_paid") && new Date(inv.dueDate) < new Date()
  ));

  const modalGuardsCount = selectedSiteModal?.billing.billableGuardCount ?? 0;
  const modalParsedRate = Number(rateInput);
  const modalLiveTotal = !isNaN(modalParsedRate) && modalParsedRate > 0 ? modalParsedRate * modalGuardsCount : 0;

  if (user && !canView) {
    return <BillingAccessRestricted />;
  }

  return (
    <main className="animate-fade-in space-y-5 pb-16">
      {/* Header */}
      <header className="space-y-4">
        <Link href="/payroll/billing/clients" className="section-title hover:underline">← Clients & Statements</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="page-title">{clientName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-security-navy-500">
              {statement?.client.billingEmail && <span>{statement.client.billingEmail}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canExport && activeTab === "statement" && (
              <>
                <button type="button" onClick={() => run(() => previewStatementPdf(token!, params.id, from, to))} disabled={busy || loading || !statement} className="btn-secondary min-h-10">
                  Preview PDF
                </button>
                <button type="button" onClick={() => {
                  const safeClientName = clientName.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, "_");
                  return run(() => downloadStatementPdf(token!, params.id, from, to, `Statement_${safeClientName}_${from}_to_${to}.pdf`));
                }} disabled={busy || loading || !statement} className="btn-primary min-h-10">
                  {busy ? "Preparing…" : "Download PDF"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Account status strip */}
        {!loading && statement && (
          <div className="flex flex-wrap items-center gap-4 rounded-security-lg border border-security-navy-100 bg-white px-4 py-3 shadow-security-card">
            <div>
              <p className="section-title">Balance</p>
              <p className={clsx("font-mono text-lg font-bold tabular-nums", outstanding > 0 ? "text-red-700" : "text-security-emerald-700")}>
                {formatCurrency(outstanding, { currency })}
              </p>
            </div>
            <div>
              <p className="section-title">Billed ({from.slice(0, 7)} to {to.slice(0, 7)})</p>
              <p className="font-mono text-lg font-bold tabular-nums text-security-navy-900">{formatCurrency(totalDebits, { currency })}</p>
            </div>
            <div>
              <p className="section-title">Collected</p>
              <p className="font-mono text-lg font-bold tabular-nums text-security-emerald-700">{formatCurrency(totalCredits, { currency })}</p>
            </div>
            {overdueInvoices.length > 0 && (
              <div>
                <ArRiskBadge risk={computeArRisk({ current: outstanding, d1_30: "0", d31_60: "0", d61_90: "0", d90_plus: "0" })} />
                <p className="mt-1 text-xs font-semibold text-red-600">{overdueInvoices.length} overdue invoice{overdueInvoices.length !== 1 ? "s" : ""}</p>
              </div>
            )}
          </div>
        )}

        {/* Tab navigation */}
        <nav className="flex overflow-x-auto border-b border-security-navy-200" aria-label="Client billing tabs">
          {TABS.map((tab) => {
            const count = tab.id === "invoices" ? invoices.length : tab.id === "quotes" ? quotes.length : tab.id === "sites" ? (clientSitesBilling?.sites.length ?? 0) : undefined;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition-colors",
                  activeTab === tab.id
                    ? "border-security-navy-900 text-security-navy-900"
                    : "border-transparent text-security-navy-500 hover:text-security-navy-700"
                )}
              >
                {tab.label}
                {count !== undefined && (
                  <span className={clsx("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", activeTab === tab.id ? "bg-security-navy-900 text-white" : "bg-security-navy-100 text-security-navy-700")}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </header>

      {error && <div className="rounded-security-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}

      {/* ── OVERVIEW TAB ── */}
      {activeTab === "overview" && (
        <div className="space-y-5">
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-security-lg bg-security-navy-100" />)}</div>
          ) : (
            <>
              {/* KPI grid */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card">
                  <p className="section-title">Open Balance</p>
                  <p className={clsx("mt-1 font-mono text-2xl font-bold tabular-nums", outstanding > 0 ? "text-red-700" : "text-security-navy-400")}>{formatCurrency(outstanding, { currency })}</p>
                </div>
                <div className="rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card">
                  <p className="section-title">Total Invoices</p>
                  <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-security-navy-900">{invoices.length}</p>
                  {overdueInvoices.length > 0 && <p className="text-xs font-semibold text-red-600">{overdueInvoices.length} overdue</p>}
                </div>
                <div className="rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card">
                  <p className="section-title">Total Quotes</p>
                  <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-security-navy-900">{quotes.length}</p>
                  <p className="text-xs text-security-navy-500">{quotes.filter((q) => q.status === "accepted").length} accepted</p>
                </div>
                <div className="rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card">
                  <p className="section-title">Sites</p>
                  <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-security-navy-900">{clientSitesBilling?.sites.length ?? 0}</p>
                  <p className="text-xs text-security-navy-500">{clientSitesBilling?.totalBillableGuards ?? 0} billable guards</p>
                </div>
              </div>

              {/* Overdue invoices notice */}
              {overdueInvoices.length > 0 && (
                <div className="rounded-security-lg border border-red-200 bg-red-50 p-4">
                  <p className="mb-2 text-sm font-semibold text-red-700">⚠ Overdue Invoices ({overdueInvoices.length})</p>
                  <div className="space-y-1">
                    {overdueInvoices.slice(0, 3).map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between text-sm">
                        <Link href={`/payroll/billing/invoices/${inv.id}`} className="font-mono font-semibold text-red-700 hover:underline">{inv.invoiceNumber}</Link>
                        <span className="font-mono font-bold tabular-nums text-red-700">{formatCurrency(inv.amountDue ?? inv.totalAmount, { currency })}</span>
                      </div>
                    ))}
                    {overdueInvoices.length > 3 && <button type="button" onClick={() => setActiveTab("invoices")} className="text-xs font-semibold text-red-700 hover:underline">+{overdueInvoices.length - 3} more — view all invoices</button>}
                  </div>
                </div>
              )}

              {/* Recent invoices */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="section-title">Recent Invoices</p>
                  <button type="button" onClick={() => setActiveTab("invoices")} className="text-xs font-semibold text-security-amber-700 hover:underline">View all →</button>
                </div>
                {invoices.slice(0, 5).map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between border-b border-security-navy-50 py-2.5">
                    <div className="flex items-center gap-3">
                      <Link href={`/payroll/billing/invoices/${inv.id}`} className="font-mono text-sm font-semibold text-security-navy-900 hover:text-security-amber-700 hover:underline">{inv.invoiceNumber}</Link>
                      <StatusBadge status={inv.status} />
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="hidden text-security-navy-500 sm:inline">{inv.invoiceDate?.slice(0, 10)}</span>
                      <span className="font-mono font-bold tabular-nums text-security-navy-900">{formatCurrency(inv.totalAmount, { currency })}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── STATEMENT TAB ── */}
      {activeTab === "statement" && (
        <div className="space-y-4">
          {/* Date range controls */}
          <div className="flex flex-wrap items-end gap-3 rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card">
            <div className="flex flex-wrap gap-1.5">
              {(["this_month", "last_month", "last_30", "last_90", "ytd", "all"] as const).map((preset) => (
                <button key={preset} type="button"
                  onClick={() => { const r = getPresetRange(preset); setFrom(r.from); setTo(r.to); }}
                  className="rounded-security border border-security-navy-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-security-navy-600 hover:border-security-navy-300 hover:bg-security-navy-50">
                  {preset === "this_month" ? "This Month" : preset === "last_month" ? "Last Month" : preset === "last_30" ? "30 days" : preset === "last_90" ? "90 days" : preset === "ytd" ? "YTD" : "All time"}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <label className="block">
                <span className="label-text mb-1 block">From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-compact" id="statement-from" />
              </label>
              <label className="block">
                <span className="label-text mb-1 block">To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-compact" id="statement-to" />
              </label>
            </div>
          </div>

          {loading ? (
            <div className="h-64 animate-pulse rounded-security-lg bg-security-navy-100" />
          ) : statement ? (
            <div className="rounded-security-lg border border-security-navy-100 bg-white shadow-security-card">
              {/* Statement header */}
              <div className="grid grid-cols-3 gap-4 border-b border-security-navy-100 p-5">
                <div>
                  <p className="section-title">Opening Balance</p>
                  <p className="font-mono text-lg font-bold tabular-nums text-security-navy-900">{formatCurrency(statement.openingBalance, { currency })}</p>
                </div>
                <div>
                  <p className="section-title">Total Debits</p>
                  <p className="font-mono text-lg font-bold tabular-nums text-red-700">{formatCurrency(totalDebits, { currency })}</p>
                </div>
                <div>
                  <p className="section-title">Total Credits</p>
                  <p className="font-mono text-lg font-bold tabular-nums text-security-emerald-700">{formatCurrency(totalCredits, { currency })}</p>
                </div>
              </div>

              {/* Transaction register */}
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-security-navy-50">
                    <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Reference</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3 text-right">Debit</th>
                      <th className="px-4 py-3 text-right">Credit</th>
                      <th className="px-4 py-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-security-navy-50">
                    {statement.transactions.map((tx, i) => (
                      <tr key={i} className="hover:bg-security-navy-50/50">
                        <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-security-navy-600">{tx.date?.slice(0, 10)}</td>
                        <td className="px-4 py-2.5">
                          {tx.kind === "invoice" && tx.documentId ? (
                            <Link href={`/payroll/billing/invoices/${tx.documentId}`} className="font-mono text-xs font-semibold text-security-amber-700 hover:underline">{tx.reference}</Link>
                          ) : (
                            <span className="font-mono text-xs text-security-navy-600">{tx.reference ?? "—"}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-security-navy-700">{tx.description}</td>
                        <td className="px-4 py-2.5 text-right">
                          {tx.debit ? <span className="font-mono text-xs font-semibold tabular-nums text-security-navy-900">{formatCurrency(tx.debit, { currency })}</span> : <span className="text-security-navy-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {tx.credit ? <span className="font-mono text-xs font-semibold tabular-nums text-security-emerald-700">{formatCurrency(tx.credit, { currency })}</span> : <span className="text-security-navy-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={clsx("font-mono text-xs font-bold tabular-nums", Number(tx.balance) > 0 ? "text-red-700" : "text-security-emerald-700")}>
                            {formatCurrency(tx.balance, { currency })}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-security-navy-200 bg-security-navy-50">
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-sm font-bold text-security-navy-900">Closing Balance</td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-red-700">{formatCurrency(totalDebits, { currency })}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-security-emerald-700">{formatCurrency(totalCredits, { currency })}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-security-navy-900">{formatCurrency(outstanding, { currency })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {statement.transactions.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-security-navy-500">No transactions in this period.</p>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* ── INVOICES TAB ── */}
      {activeTab === "invoices" && (
        <div>
          {loading ? (
            <div className="h-48 animate-pulse rounded-security-lg bg-security-navy-100" />
          ) : invoices.length === 0 ? (
            <p className="rounded-security-lg border border-security-navy-100 bg-white px-4 py-10 text-center text-sm text-security-navy-500">No invoices for this client.</p>
          ) : (
            <div className="overflow-x-auto rounded-security-lg border border-security-navy-100 bg-white shadow-security-card">
              <table className="min-w-full divide-y divide-security-navy-50 text-sm">
                <thead className="bg-security-navy-50">
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Date</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Due</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-security-navy-50">
                  {invoices.map((inv) => {
                    const isOverdue = inv.status === "overdue" || ((inv.status === "issued" || inv.status === "partially_paid") && new Date(inv.dueDate) < new Date());
                    return (
                      <tr key={inv.id} className={clsx("hover:bg-security-navy-50/50", isOverdue && "bg-red-50/40")}>
                        <td className="px-4 py-3">
                          <Link href={`/payroll/billing/invoices/${inv.id}`} className="font-mono font-semibold text-security-navy-900 hover:text-security-amber-700 hover:underline">{inv.invoiceNumber}</Link>
                          {inv.reference && <p className="text-[11px] text-security-navy-500">{inv.reference}</p>}
                        </td>
                        <td className="hidden px-4 py-3 tabular-nums text-security-navy-600 sm:table-cell">{inv.invoiceDate?.slice(0, 10)}</td>
                        <td className={clsx("hidden px-4 py-3 tabular-nums sm:table-cell", isOverdue ? "font-semibold text-red-700" : "text-security-navy-600")}>{inv.dueDate?.slice(0, 10)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-security-navy-900">{formatCurrency(inv.totalAmount, { currency })}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={clsx("font-mono font-semibold tabular-nums", Number(inv.amountDue ?? inv.totalAmount) > 0 ? (isOverdue ? "text-red-700" : "text-security-navy-900") : "text-security-emerald-600")}>
                            {formatCurrency(inv.amountDue ?? inv.totalAmount, { currency })}
                          </span>
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={isOverdue ? "overdue" : inv.status} /></td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link href={`/payroll/billing/invoices/${inv.id}`} className="btn-ghost min-h-8 px-2 py-1 text-xs">View</Link>
                            {canExport && (
                              <button type="button" onClick={() => run(() => previewInvoicePdf(token!, inv.id))} disabled={busy} className="btn-ghost min-h-8 px-2 py-1 text-xs">PDF</button>
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
        </div>
      )}

      {/* ── QUOTES TAB ── */}
      {activeTab === "quotes" && (
        <div>
          {loading ? (
            <div className="h-48 animate-pulse rounded-security-lg bg-security-navy-100" />
          ) : quotes.length === 0 ? (
            <p className="rounded-security-lg border border-security-navy-100 bg-white px-4 py-10 text-center text-sm text-security-navy-500">No quotes for this client.</p>
          ) : (
            <div className="overflow-x-auto rounded-security-lg border border-security-navy-100 bg-white shadow-security-card">
              <table className="min-w-full divide-y divide-security-navy-50 text-sm">
                <thead className="bg-security-navy-50">
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
                    <th className="px-4 py-3">Quote</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Date</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Valid Until</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-security-navy-50">
                  {quotes.map((q) => {
                    const isExpired = new Date(q.validUntil) < new Date() && q.status === "issued";
                    return (
                      <tr key={q.id} className="hover:bg-security-navy-50/50">
                        <td className="px-4 py-3">
                          <Link href={`/payroll/billing/quotes/${q.id}`} className="font-mono font-semibold text-security-navy-900 hover:text-security-amber-700 hover:underline">{q.quoteNumber}</Link>
                        </td>
                        <td className="hidden px-4 py-3 tabular-nums text-security-navy-600 sm:table-cell">{q.quoteDate?.slice(0, 10)}</td>
                        <td className={clsx("hidden px-4 py-3 tabular-nums sm:table-cell", isExpired ? "text-red-600 font-semibold" : "text-security-navy-600")}>{q.validUntil?.slice(0, 10)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-security-navy-900">{formatCurrency(q.totalAmount, { currency })}</td>
                        <td className="px-4 py-3"><StatusBadge status={isExpired ? "expired" : q.status} /></td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link href={`/payroll/billing/quotes/${q.id}`} className="btn-ghost min-h-8 px-2 py-1 text-xs">View</Link>
                            {canExport && (
                              <button type="button" onClick={() => run(() => previewQuotePdf(token!, q.id))} disabled={busy} className="btn-ghost min-h-8 px-2 py-1 text-xs">PDF</button>
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
        </div>
      )}

      {/* ── SITES & RATES TAB ── */}
      {activeTab === "sites" && (
        <div>
          {loading ? (
            <div className="h-48 animate-pulse rounded-security-lg bg-security-navy-100" />
          ) : !clientSitesBilling || clientSitesBilling.sites.length === 0 ? (
            <p className="rounded-security-lg border border-security-navy-100 bg-white px-4 py-10 text-center text-sm text-security-navy-500">No sites assigned to this client.</p>
          ) : (
            <>
              {/* Summary */}
              <div className="mb-4 flex flex-wrap items-center gap-4 rounded-security-lg border border-security-navy-100 bg-white px-4 py-3 shadow-security-card">
                <div>
                  <p className="section-title">Monthly Total</p>
                  <p className="font-mono text-lg font-bold tabular-nums text-security-navy-900">{formatCurrency(clientSitesBilling.totalMonthlyAmount, { currency })}</p>
                </div>
                <div>
                  <p className="section-title">Billable Guards</p>
                  <p className="font-mono text-lg font-bold tabular-nums text-security-navy-900">{clientSitesBilling.totalBillableGuards}</p>
                </div>
                <div>
                  <p className="section-title">Sites</p>
                  <p className="font-mono text-lg font-bold tabular-nums text-security-navy-900">{clientSitesBilling.sites.length}</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {clientSitesBilling.sites.map((site) => (
                  <div key={site.siteId} className={clsx("rounded-security-lg border bg-white p-4 shadow-security-card", !site.billingConfigured ? "border-security-amber-200" : "border-security-navy-100")}>
                    <div className="flex items-start justify-between">
                      <p className="font-semibold text-security-navy-900">{site.siteName}</p>
                      {site.billingConfigured ? <span className="badge-success text-[10px]">Priced</span> : <span className="badge-warning text-[10px]">Needs rate</span>}
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-security-navy-600">
                      <div className="flex justify-between">
                        <span>Rate / guard</span>
                        <span className="font-mono font-semibold text-security-navy-900">{site.ratePerGuard ? formatCurrency(site.ratePerGuard, { currency }) : "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Guards</span>
                        <span className="font-mono">{site.billableGuardCount}</span>
                      </div>
                      <div className="flex justify-between border-t border-security-navy-100 pt-1 font-semibold">
                        <span>Monthly total</span>
                        <span className="font-mono text-security-navy-900">{formatCurrency(site.siteMonthlyTotal, { currency })}</span>
                      </div>
                    </div>
                    {canEdit && (
                      <button type="button" disabled={loadingSiteModal} onClick={() => openSiteRateModal(site.siteId)} className="btn-secondary mt-3 w-full min-h-8 text-xs">
                        {loadingSiteModal ? "Loading…" : site.billingConfigured ? "Update Rate" : "Set Rate"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Site Rate Modal ── */}
      {selectedSiteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-security-navy-900/50 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setSelectedSiteModal(null); setRateModalSuccess(null); } }}
          role="dialog" aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-security-lg border border-security-navy-100 bg-white shadow-security-elevated">
            <div className="border-b border-security-navy-100 px-5 py-4">
              <p className="section-title">{clientName}</p>
              <h2 className="mt-0.5 text-base font-semibold text-security-navy-900">{selectedSiteModal.site.name}</h2>
            </div>

            <div className="p-5 space-y-4">
              {rateModalError && <p className="rounded-security border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{rateModalError}</p>}
              {rateModalSuccess && <p className="rounded-security border border-security-emerald-200 bg-security-emerald-50 px-3 py-2 text-sm text-security-emerald-800">{rateModalSuccess}</p>}

              <div className="rounded-security bg-security-navy-50 px-3 py-2 text-sm text-security-navy-700">
                Active guards: <strong>{selectedSiteModal.billing.billableGuardCount}</strong>
              </div>

              <label className="block">
                <span className="label-text mb-1.5 block">Rate per guard (per month)</span>
                <input type="number" step="0.01" min="0" required value={rateInput} onChange={(e) => setRateInput(e.target.value)} className="input-modern w-full font-mono" placeholder="0.00" autoFocus id="site-rate-per-guard" />
                {modalParsedRate > 0 && (
                  <p className="mt-1 text-xs text-security-emerald-700 font-semibold">
                    {modalGuardsCount} guards × {formatCurrency(modalParsedRate, { currency })} = {formatCurrency(modalLiveTotal, { currency })} / month
                  </p>
                )}
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="label-text mb-1.5 block">Effective from</span>
                  <input type="date" required value={effectiveFromInput} onChange={(e) => setEffectiveFromInput(e.target.value)} className="input-modern w-full" id="site-rate-from" />
                </label>
                <label className="block">
                  <span className="label-text mb-1.5 block">Effective to (optional)</span>
                  <input type="date" value={effectiveToInput} onChange={(e) => setEffectiveToInput(e.target.value)} className="input-modern w-full" id="site-rate-to" />
                </label>
              </div>

              <label className="block">
                <span className="label-text mb-1.5 block">Notes (optional)</span>
                <input value={notesInput} onChange={(e) => setNotesInput(e.target.value)} placeholder="e.g. 2026 contract renewal" className="input-modern w-full" id="site-rate-notes" />
              </label>

              {/* Rate history */}
              {selectedSiteModal.history && selectedSiteModal.history.length > 0 && (
                <div>
                  <p className="label-text mb-2">Rate History</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {selectedSiteModal.history.map((r, i) => (
                      <div key={i} className="flex justify-between text-xs text-security-navy-600">
                        <span>{r.effectiveFrom?.slice(0, 10)}{r.effectiveTo ? ` – ${r.effectiveTo.slice(0, 10)}` : " – present"}</span>
                        <span className="font-mono font-semibold">{formatCurrency(r.ratePerGuard, { currency })} / guard</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button type="button" onClick={handleSaveRate} disabled={savingRate || !canEdit} className="btn-primary flex-1">{savingRate ? "Saving…" : "Save Rate"}</button>
                <button type="button" onClick={() => { setSelectedSiteModal(null); setRateModalSuccess(null); }} disabled={savingRate} className="btn-secondary">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
