"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { hasCapability } from "@/lib/permissions";
import {
  getBillingSummary,
  listBillableClients,
  updateSiteBillingRate,
  type BillingSummary,
  type BillableClient,
} from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency } from "@/lib/currency";
import { BillingKpiCard } from "./_components/billing-kpi-card";
import { AgingBar } from "./_components/aging-bar";
import { ArRiskBadge, computeArRisk } from "./_components/ar-risk-badge";
import { StatusBadge } from "./_components/status-badge";
import { BillingAccessRestricted } from "./_components/billing-access-restricted";

// ─── Icons ────────────────────────────────────────────────────────────────────
const IconInvoice = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
  </svg>
);
const IconQuote = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
    <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
  </svg>
);
const IconClients = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
    <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
  </svg>
);
const IconReceipt = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M5 2a2 2 0 00-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V4a2 2 0 00-2-2H5zm4.707 3.707a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L8.414 9H10a3 3 0 013 3 1 1 0 102 0 5 5 0 00-5-5H8.414l1.293-1.293z" clipRule="evenodd" />
  </svg>
);
const IconAlert = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
  </svg>
);
const IconDollar = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
    <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
  </svg>
);

// ─── Sub-nav definition ───────────────────────────────────────────────────────
const NAV = [
  { href: "/payroll/billing", label: "Dashboard", exact: true },
  { href: "/payroll/billing/invoices", label: "Invoices" },
  { href: "/payroll/billing/quotes", label: "Quotes" },
  { href: "/payroll/billing/clients", label: "Clients & Statements" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function pct(numerator: number, denominator: number): string {
  if (!denominator) return "0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export default function BillingHubPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const currency = currencyFromSettings(settings);
  const canView = user ? hasCapability(user, "/payroll/billing", "view") : false;
  const canEdit = user
    ? hasCapability(user, "/payroll/billing", "edit") || hasCapability(user, "/payroll/billing", "create")
    : false;
  const canCreate = user ? hasCapability(user, "/payroll/billing", "create") : false;

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [clients, setClients] = useState<BillableClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Rate configuration modal state
  const [editingSite, setEditingSite] = useState<{
    clientId: string;
    clientName: string;
    siteId: string;
    siteName: string;
    currentRate: string | null;
    billableGuardCount: number;
  } | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [effectiveFromInput, setEffectiveFromInput] = useState(() => new Date().toISOString().slice(0, 10));
  const [effectiveToInput, setEffectiveToInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [savingRate, setSavingRate] = useState(false);
  const [rateModalError, setRateModalError] = useState<string | null>(null);

  // Expanded client for site rate panel
  const [expandedRateClientId, setExpandedRateClientId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !canView) return;
    setLoading(true);
    setError(null);
    setSummaryError(null);
    try {
      const [summaryResult, clientsRes] = await Promise.all([
        getBillingSummary(token).then(
          (res) => ({ ok: true as const, data: res }),
          (err) => ({ ok: false as const, message: err instanceof Error ? err.message : "Failed to load billing summary" })
        ),
        listBillableClients(token),
      ]);
      if (summaryResult.ok) {
        setSummary(summaryResult.data);
      } else {
        setSummary(null);
        setSummaryError(summaryResult.message);
      }
      setClients(clientsRes.clients);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load client billing data");
    } finally {
      setLoading(false);
    }
  }, [token, canView]);

  useEffect(() => { void load(); }, [load]);

  if (user && !canView) {
    return <BillingAccessRestricted />;
  }

  const openRateModal = (
    clientId: string,
    clientName: string,
    site: { siteId: string; siteName: string; ratePerGuard: string | null; billableGuardCount: number }
  ) => {
    setEditingSite({ clientId, clientName, siteId: site.siteId, siteName: site.siteName, currentRate: site.ratePerGuard, billableGuardCount: site.billableGuardCount });
    setRateInput(site.ratePerGuard ? String(site.ratePerGuard) : "");
    setEffectiveFromInput(new Date().toISOString().slice(0, 10));
    setEffectiveToInput("");
    setNotesInput("");
    setRateModalError(null);
  };

  const handleSaveRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editingSite) return;
    const parsed = Number(rateInput);
    if (isNaN(parsed) || parsed < 0) { setRateModalError("Please enter a valid, non-negative rate per guard."); return; }
    setSavingRate(true);
    setRateModalError(null);
    try {
      await updateSiteBillingRate(token, editingSite.clientId, editingSite.siteId, {
        billingMethod: "PER_GUARD",
        ratePerGuard: parsed,
        effectiveFrom: effectiveFromInput,
        effectiveTo: effectiveToInput.trim() ? effectiveToInput.trim() : undefined,
        notes: notesInput.trim() ? notesInput.trim() : undefined,
      });
      setEditingSite(null);
      await load();
    } catch (err) {
      setRateModalError(err instanceof Error ? err.message : "Failed to save billing rate");
    } finally {
      setSavingRate(false);
    }
  };

  // Derived KPIs
  const totalMonthlyBilling = clients.reduce((acc, c) => acc + (c.monthlyBillingTotal ? Number(c.monthlyBillingTotal) : 0), 0);
  const totalBillableGuards = clients.reduce((acc, c) => acc + (c.billableGuardCount ?? 0), 0);
  const totalSitesCount = clients.reduce((acc, c) => acc + (c.siteCount ?? 0), 0);
  const totalConfiguredSites = clients.reduce((acc, c) => acc + (c.sitesConfiguredCount ?? 0), 0);
  const unconfiguredSites = totalSitesCount - totalConfiguredSites;

  // When the summary request itself failed we must not display R 0,00 — that
  // would be indistinguishable from a legitimate zero balance. Use a sentinel
  // to render a clear "failed to load" indicator in the KPI cards instead.
  const summaryFailed = !loading && summaryError !== null;

  const collectionRate = summary
    ? Number(summary.totalBilled) > 0
      ? (Number(summary.totalCollected) / Number(summary.totalBilled)) * 100
      : 100
    : 0;

  const filteredClients = clients.filter((c) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.sites?.some((s) => s.siteName.toLowerCase().includes(q));
  });

  // Sort clients by outstanding balance descending
  const sortedClients = [...filteredClients].sort(
    (a, b) => Number(b.outstanding) - Number(a.outstanding)
  );

  const parsedLiveRate = Number(rateInput);
  const liveGuards = editingSite?.billableGuardCount ?? 0;
  const liveSiteTotal = !isNaN(parsedLiveRate) && parsedLiveRate > 0 ? parsedLiveRate * liveGuards : 0;

  return (
    <main className="animate-fade-in space-y-6 pb-16">
      {/* ── Page header ── */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-title">Finance</p>
            <h1 className="page-title mt-0.5">Client Billing</h1>
            <p className="mt-1 text-sm text-security-navy-500">
              Accounts receivable, invoicing, site billing rates and client statements.
            </p>
          </div>

          {canCreate && (
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/payroll/billing/invoices?new=1" className="btn-primary min-h-10 gap-1.5">
                <IconInvoice />
                New Invoice
              </Link>
              <Link href="/payroll/billing/quotes?new=1" className="btn-secondary min-h-10 gap-1.5">
                <IconQuote />
                New Quote
              </Link>
            </div>
          )}
        </div>

        {/* Sub-navigation */}
        <nav className="flex gap-1 overflow-x-auto" aria-label="Billing sections">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex items-center rounded-security border border-security-navy-200 bg-white px-3.5 py-2 text-xs font-semibold text-security-navy-700 shadow-security-card transition-all hover:border-security-navy-300 hover:bg-security-navy-50 aria-[current=page]:border-security-navy-900 aria-[current=page]:bg-security-navy-900 aria-[current=page]:text-white"
              aria-current="page"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {error && (
        <div
          className="flex items-center justify-between rounded-security-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="font-semibold underline">Retry</button>
        </div>
      )}

      {/* ── KPI Command Strip ── */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-security-lg bg-security-navy-100" />
          ))}
        </div>
      ) : (
        <>
          {summaryFailed && !error && (
            <div
              className="flex items-center justify-between rounded-security border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800"
              role="status"
              aria-live="polite"
            >
              <span>Billing summary could not be loaded. Financial totals are unavailable.</span>
              <button type="button" onClick={() => void load()} className="font-semibold underline text-amber-900">
                Retry
              </button>
            </div>
          )}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Key billing metrics">
            <BillingKpiCard
              label="Outstanding AR"
              value={summaryFailed ? "—" : formatCurrency(summary?.outstanding ?? 0, { currency })}
              sub={
                summaryFailed
                  ? "Failed to load"
                  : summary?.overdueInvoiceCount
                  ? `${summary.overdueInvoiceCount} overdue invoice${summary.overdueInvoiceCount !== 1 ? "s" : ""}`
                  : "No overdue invoices"
              }
              variant={summaryFailed ? "warning" : summary?.overdueInvoiceCount ? "danger" : "success"}
              badge={summaryFailed ? undefined : (summary?.overdueInvoiceCount ?? 0)}
              icon={<IconDollar />}
            />
            <BillingKpiCard
              label="Total Billed"
              value={summaryFailed ? "—" : formatCurrency(summary?.totalBilled ?? 0, { currency })}
              sub={
                summaryFailed
                  ? "Failed to load"
                  : `${summary?.activeInvoiceCount ?? 0} active invoice${(summary?.activeInvoiceCount ?? 0) !== 1 ? "s" : ""}`
              }
              variant={summaryFailed ? "warning" : "info"}
              badge={summaryFailed ? undefined : summary?.activeInvoiceCount}
              icon={<IconInvoice />}
            />
            <BillingKpiCard
              label="Collected"
              value={summaryFailed ? "—" : formatCurrency(summary?.totalCollected ?? 0, { currency })}
              sub={summaryFailed ? "Failed to load" : `${collectionRate.toFixed(1)}% collection rate`}
              variant={summaryFailed ? "warning" : "success"}
              icon={<IconReceipt />}
            />
            <BillingKpiCard
              label="Monthly Contract Value"
              value={formatCurrency(totalMonthlyBilling, { currency })}
              sub={`${totalBillableGuards} billable guards · ${totalSitesCount} sites`}
              variant={unconfiguredSites > 0 ? "warning" : "default"}
              badge={unconfiguredSites > 0 ? `${unconfiguredSites} unpriced` : undefined}
              icon={<IconClients />}
            />
          </section>
        </>
      )}

      {/* ── AR Aging Analysis ── */}
      {summary && !loading && (
        <section className="rounded-security-lg border border-security-navy-100 bg-white p-5 shadow-security-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="section-title">Accounts Receivable Aging</p>
              <p className="mt-0.5 text-xs text-security-navy-500">
                Total outstanding: <strong>{formatCurrency(summary.outstanding, { currency })}</strong>
              </p>
            </div>
            <Link href="/payroll/billing/clients" className="btn-ghost text-xs">
              View all clients →
            </Link>
          </div>
          <AgingBar aging={summary.aging} currency={currency} />
        </section>
      )}

      {/* ── Client AR Ledger ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-title">Client Accounts ({clients.length})</p>
            <p className="mt-0.5 text-xs text-security-navy-500">
              Click any client to view invoices, statements, and site rates.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search clients or sites…"
              className="input-compact w-64 text-xs"
              aria-label="Search clients or sites"
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-security-lg bg-security-navy-100" />
            ))}
          </div>
        ) : sortedClients.length === 0 ? (
          <div className="rounded-security-lg border border-security-navy-100 bg-white px-6 py-12 text-center">
            <p className="text-sm text-security-navy-500">
              {clients.length === 0
                ? "No clients with billing data. Configure site rates to get started."
                : "No clients match that search."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-security-lg border border-security-navy-100 bg-white shadow-security-card">
            <table className="min-w-full divide-y divide-security-navy-50 text-sm">
              <thead className="bg-security-navy-50">
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3 text-right hidden sm:table-cell">Monthly Rate</th>
                  <th className="px-4 py-3 hidden md:table-cell">AR Status</th>
                  <th className="px-4 py-3 text-right hidden lg:table-cell">Guards</th>
                  <th className="px-4 py-3 text-right hidden lg:table-cell">Sites</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-50">
                {sortedClients.map((client) => {
                  const outstanding = Number(client.outstanding);
                  const hasBalance = outstanding > 0;
                  const risk = computeArRisk({
                    current: hasBalance ? outstanding : 0,
                    d1_30: "0",
                    d31_60: "0",
                    d61_90: "0",
                    d90_plus: "0",
                  });
                  const isExpanded = expandedRateClientId === client.id;

                  return (
                    <Fragment key={client.id}>
                      <tr
                        key={client.id}
                        className="group hover:bg-security-navy-50/50 transition-colors"
                      >
                        <td className="px-4 py-3.5">
                          <Link
                            href={`/payroll/billing/clients/${client.id}`}
                            className="font-semibold text-security-navy-900 hover:text-security-amber-700 hover:underline"
                          >
                            {client.name}
                          </Link>
                          <p className="text-[11px] text-security-navy-500">
                            {client.invoiceCount} invoice{client.invoiceCount !== 1 ? "s" : ""} ·{" "}
                            {client.paymentTermsDays ?? 30} day terms
                          </p>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span
                            className={`font-mono font-bold tabular-nums ${
                              hasBalance ? "text-red-700" : "text-security-navy-400"
                            }`}
                          >
                            {formatCurrency(outstanding, { currency })}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3.5 text-right sm:table-cell">
                          <span className="font-mono text-sm tabular-nums text-security-navy-700">
                            {formatCurrency(client.monthlyBillingTotal ?? 0, { currency })}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3.5 md:table-cell">
                          {hasBalance ? (
                            <ArRiskBadge risk={risk} />
                          ) : (
                            <span className="badge-success text-[10px]">Paid up</span>
                          )}
                        </td>
                        <td className="hidden px-4 py-3.5 text-right font-mono tabular-nums text-security-navy-700 lg:table-cell">
                          {client.billableGuardCount ?? 0}
                        </td>
                        <td className="hidden px-4 py-3.5 lg:table-cell">
                          <div className="flex items-center justify-end gap-1">
                            <span className="font-mono tabular-nums text-security-navy-700">
                              {client.sitesConfiguredCount ?? 0}/{client.siteCount}
                            </span>
                            {(client.sitesUnconfiguredCount ?? 0) > 0 && (
                              <span className="badge-warning text-[10px]">
                                {client.sitesUnconfiguredCount} unpriced
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link
                              href={`/payroll/billing/clients/${client.id}`}
                              className="btn-ghost min-h-8 px-2 py-1 text-xs"
                            >
                              Statement
                            </Link>
                            <Link
                              href={`/payroll/billing/invoices?clientId=${client.id}`}
                              className="btn-ghost min-h-8 px-2 py-1 text-xs"
                            >
                              Invoices
                            </Link>
                            {canEdit && (client.sitesUnconfiguredCount ?? 0) > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedRateClientId(isExpanded ? null : client.id)
                                }
                                className="btn-ghost min-h-8 px-2 py-1 text-xs text-security-amber-700"
                              >
                                {isExpanded ? "Hide" : "Set Rates"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Inline site rates panel */}
                      {isExpanded && client.sites && client.sites.length > 0 && (
                        <tr key={`${client.id}-rates`} className="bg-security-navy-50/60">
                          <td colSpan={7} className="px-4 pb-4 pt-2">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-security-navy-500">
                              Site Billing Rates — {client.name}
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {client.sites.map((site) => (
                                <div
                                  key={site.siteId}
                                  className={`rounded-security border bg-white p-3 ${
                                    !site.billingConfigured
                                      ? "border-security-amber-200"
                                      : "border-security-navy-100"
                                  }`}
                                >
                                  <p className="text-xs font-semibold text-security-navy-800">
                                    {site.siteName}
                                  </p>
                                  <div className="mt-1 flex items-center justify-between">
                                    <div>
                                      {site.billingConfigured ? (
                                        <p className="font-mono text-sm font-bold tabular-nums text-security-navy-900">
                                          {formatCurrency(site.ratePerGuard ?? 0, { currency })} / guard
                                        </p>
                                      ) : (
                                        <p className="text-xs text-security-amber-700 font-semibold">
                                          ⚠ Rate not set
                                        </p>
                                      )}
                                      <p className="text-[11px] text-security-navy-500">
                                        {site.billableGuardCount} guard{site.billableGuardCount !== 1 ? "s" : ""}
                                        {site.billingConfigured && (
                                          <> · {formatCurrency(site.siteMonthlyTotal, { currency })} / mo</>
                                        )}
                                      </p>
                                    </div>
                                    {canEdit && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openRateModal(client.id, client.name, {
                                            siteId: site.siteId,
                                            siteName: site.siteName,
                                            ratePerGuard: site.ratePerGuard,
                                            billableGuardCount: site.billableGuardCount,
                                          })
                                        }
                                        className="btn-ghost min-h-8 px-2 py-1 text-xs"
                                      >
                                        {site.billingConfigured ? "Edit" : "Set"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Quick links to sub-modules ── */}
      {!loading && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/payroll/billing/invoices", icon: <IconInvoice />, label: "Invoices", sub: "Manage & track all invoices" },
            { href: "/payroll/billing/quotes", icon: <IconQuote />, label: "Quotes", sub: "Create & convert quotes" },
            { href: "/payroll/billing/clients", icon: <IconClients />, label: "Client Statements", sub: "Account ledgers & statements" },
            { href: "/payroll/billing/clients", icon: <IconReceipt />, label: "Receipts", sub: "View payment receipts" },
          ].map((item) => (
            <Link
              key={item.href + item.label}
              href={item.href}
              className="card-dashboard flex items-center gap-3 p-4 no-underline"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-security bg-security-navy-50 text-security-navy-500">
                {item.icon}
              </span>
              <div>
                <p className="font-semibold text-security-navy-900 text-sm">{item.label}</p>
                <p className="text-xs text-security-navy-500">{item.sub}</p>
              </div>
            </Link>
          ))}
        </section>
      )}

      {/* ── Rate Configuration Modal ── */}
      {editingSite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-security-navy-900/40 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEditingSite(null); }}
          role="dialog"
          aria-modal="true"
          aria-label={`Configure billing rate for ${editingSite.siteName}`}
        >
          <div className="w-full max-w-md rounded-security-lg border border-security-navy-100 bg-white shadow-security-elevated">
            <div className="border-b border-security-navy-100 px-5 py-4">
              <p className="section-title">Site Billing Rate</p>
              <h2 className="mt-0.5 text-base font-semibold text-security-navy-900">
                {editingSite.siteName}
              </h2>
              <p className="text-xs text-security-navy-500">{editingSite.clientName}</p>
            </div>

            <form onSubmit={handleSaveRate} className="space-y-4 p-5">
              {rateModalError && (
                <p className="rounded-security border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {rateModalError}
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label-text mb-1.5 block">
                    Rate per guard (per month)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input-modern w-full"
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                    placeholder="0.00"
                    required
                    autoFocus
                    id="rate-per-guard-input"
                  />
                  {parsedLiveRate > 0 && (
                    <p className="mt-1 text-xs text-security-navy-500">
                      {editingSite.billableGuardCount} guards × {formatCurrency(parsedLiveRate, { currency })} ={" "}
                      <strong>{formatCurrency(liveSiteTotal, { currency })}/mo</strong>
                    </p>
                  )}
                </div>

                <div>
                  <label className="label-text mb-1.5 block">Effective from</label>
                  <input
                    type="date"
                    className="input-modern w-full"
                    value={effectiveFromInput}
                    onChange={(e) => setEffectiveFromInput(e.target.value)}
                    required
                    id="rate-effective-from-input"
                  />
                </div>

                <div>
                  <label className="label-text mb-1.5 block">Effective to (optional)</label>
                  <input
                    type="date"
                    className="input-modern w-full"
                    value={effectiveToInput}
                    onChange={(e) => setEffectiveToInput(e.target.value)}
                    id="rate-effective-to-input"
                  />
                </div>

                <div>
                  <label className="label-text mb-1.5 block">Notes (optional)</label>
                  <input
                    type="text"
                    className="input-modern w-full"
                    value={notesInput}
                    onChange={(e) => setNotesInput(e.target.value)}
                    placeholder="e.g. Contract renewal rate"
                    id="rate-notes-input"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button type="submit" className="btn-primary flex-1" disabled={savingRate}>
                  {savingRate ? "Saving…" : "Save Rate"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingSite(null)}
                  disabled={savingRate}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
