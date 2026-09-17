"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { hasCapability } from "@/lib/permissions";
import {
  downloadStatementPdf,
  previewStatementPdf,
  exportClientsBalancesToCsv,
  listBillableClients,
  updateSiteBillingRate,
  type BillableClient,
} from "@/lib/billing-api";
import { currencyFromSettings, formatCurrency } from "@/lib/currency";
import { ArRiskBadge, computeArRisk } from "../_components/ar-risk-badge";
import { clsx } from "clsx";

function getLast30DaysRange() {
  const to = new Date().toISOString().slice(0, 10);
  const d = new Date(); d.setUTCDate(d.getUTCDate() - 30);
  return { from: d.toISOString().slice(0, 10), to };
}

export default function BillingClientsPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const currency = currencyFromSettings(settings);
  const canExport = user ? hasCapability(user, "/payroll/billing", "export") : false;
  const canEdit = user
    ? hasCapability(user, "/payroll/billing", "edit") || hasCapability(user, "/payroll/billing", "create")
    : false;

  const [clients, setClients] = useState<BillableClient[]>([]);
  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<"all" | "overdue" | "current">("all");
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Rate edit modal
  const [editingSite, setEditingSite] = useState<{
    clientId: string;
    clientName: string;
    siteId: string;
    siteName: string;
    ratePerGuard: string | null;
    billableGuardCount: number;
  } | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [effectiveFromInput, setEffectiveFromInput] = useState(() => new Date().toISOString().slice(0, 10));
  const [effectiveToInput, setEffectiveToInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [savingRate, setSavingRate] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listBillableClients(token);
      setClients(res.clients);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const handlePreviewStatement = async (client: BillableClient) => {
    if (!token) return;
    setActionLoadingId(client.id);
    setError(null);
    try {
      const { from, to } = getLast30DaysRange();
      await previewStatementPdf(token, client.id, from, to);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview statement");
    } finally { setActionLoadingId(null); }
  };

  const handleDownloadStatement = async (client: BillableClient) => {
    if (!token) return;
    setActionLoadingId(client.id);
    setError(null);
    try {
      const { from, to } = getLast30DaysRange();
      const safeClientName = client.name.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, "_");
      await downloadStatementPdf(token, client.id, from, to, `Statement_${safeClientName}_${from}_to_${to}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download statement");
    } finally { setActionLoadingId(null); }
  };

  const openRateModal = (clientId: string, clientName: string, site: { siteId: string; siteName: string; ratePerGuard: string | null; billableGuardCount: number }) => {
    setEditingSite({ clientId, clientName, siteId: site.siteId, siteName: site.siteName, ratePerGuard: site.ratePerGuard, billableGuardCount: site.billableGuardCount });
    setRateInput(site.ratePerGuard ? String(site.ratePerGuard) : "");
    setEffectiveFromInput(new Date().toISOString().slice(0, 10));
    setEffectiveToInput(""); setNotesInput(""); setRateError(null);
  };

  const handleSaveRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editingSite) return;
    const parsed = Number(rateInput);
    if (isNaN(parsed) || parsed < 0) { setRateError("Enter a valid non-negative rate."); return; }
    setSavingRate(true);
    setRateError(null);
    try {
      await updateSiteBillingRate(token, editingSite.clientId, editingSite.siteId, {
        billingMethod: "PER_GUARD", ratePerGuard: parsed, effectiveFrom: effectiveFromInput,
        effectiveTo: effectiveToInput.trim() || undefined, notes: notesInput.trim() || undefined,
      });
      setEditingSite(null);
      await load();
    } catch (err) {
      setRateError(err instanceof Error ? err.message : "Failed to save rate");
    } finally { setSavingRate(false); }
  };

  // Aggregate KPIs
  const totalMonthly = clients.reduce((acc, c) => acc + Number(c.monthlyBillingTotal ?? 0), 0);
  const totalGuards = clients.reduce((acc, c) => acc + (c.billableGuardCount ?? 0), 0);
  const totalSites = clients.reduce((acc, c) => acc + (c.siteCount ?? 0), 0);
  const configuredSites = clients.reduce((acc, c) => acc + (c.sitesConfiguredCount ?? 0), 0);
  const totalOutstanding = clients.reduce((acc, c) => acc + Number(c.outstanding ?? 0), 0);
  const clientsWithBalance = clients.filter((c) => Number(c.outstanding) > 0).length;

  const filtered = useMemo(() => {
    return clients
      .filter((c) => {
        const q = query.toLowerCase().trim();
        const matchesQuery = !q || c.name.toLowerCase().includes(q) || c.sites?.some((s) => s.siteName.toLowerCase().includes(q));
        const hasBalance = Number(c.outstanding) > 0;
        const matchesRisk = riskFilter === "all" || (riskFilter === "overdue" && hasBalance) || (riskFilter === "current" && !hasBalance);
        return matchesQuery && matchesRisk;
      })
      .sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
  }, [clients, query, riskFilter]);

  const parsedLiveRate = Number(rateInput);
  const liveGuards = editingSite?.billableGuardCount ?? 0;
  const liveSiteTotal = !isNaN(parsedLiveRate) && parsedLiveRate > 0 ? parsedLiveRate * liveGuards : 0;

  return (
    <main className="animate-fade-in space-y-6 pb-16">
      {/* Header */}
      <header className="space-y-1">
        <Link href="/payroll/billing" className="section-title hover:underline">← Client Billing</Link>
        <h1 className="page-title mt-0.5">Clients & Statements</h1>
        <p className="text-sm text-security-navy-500">Account balances, AR aging, site billing rates, and statement generation.</p>
      </header>

      {error && (
        <div className="rounded-security-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>
      )}

      {/* KPI strip */}
      {!loading && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Client billing summary">
          {[
            { label: "Total Outstanding", value: formatCurrency(totalOutstanding, { currency }), sub: `${clientsWithBalance} clients with open balance`, variant: totalOutstanding > 0 ? "bg-red-50 border-red-200" : "bg-security-emerald-50 border-security-emerald-200", valueColor: totalOutstanding > 0 ? "text-red-700" : "text-security-emerald-700" },
            { label: "Monthly Contract Value", value: formatCurrency(totalMonthly, { currency }), sub: `${totalGuards} billable guards`, variant: "bg-white border-security-navy-100", valueColor: "text-security-navy-900" },
            { label: "Site Coverage", value: `${configuredSites}/${totalSites}`, sub: configuredSites < totalSites ? `${totalSites - configuredSites} site(s) unpriced` : "All sites priced", variant: configuredSites < totalSites ? "bg-security-amber-50 border-security-amber-200" : "bg-white border-security-navy-100", valueColor: configuredSites < totalSites ? "text-security-amber-900" : "text-security-navy-900" },
            { label: "Client Accounts", value: String(clients.length), sub: "With operational sites", variant: "bg-white border-security-navy-100", valueColor: "text-security-navy-900" },
          ].map((kpi) => (
            <div key={kpi.label} className={clsx("rounded-security-lg border p-4 shadow-security-card", kpi.variant)}>
              <p className="section-title">{kpi.label}</p>
              <p className={clsx("mt-1 font-mono text-2xl font-bold tabular-nums tracking-tight", kpi.valueColor)}>{kpi.value}</p>
              <p className="mt-0.5 text-xs text-security-navy-500">{kpi.sub}</p>
            </div>
          ))}
        </section>
      )}

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients or sites…"
          className="input-modern w-full max-w-sm"
          id="client-search"
          aria-label="Search clients or sites"
        />
        <div className="flex gap-1.5">
          {(["all", "overdue", "current"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setRiskFilter(f)} aria-pressed={riskFilter === f}
              className={clsx("rounded-security border px-3 py-1.5 text-[11px] font-semibold capitalize transition-colors",
                riskFilter === f ? "border-security-navy-900 bg-security-navy-900 text-white" : "border-security-navy-200 bg-white text-security-navy-600 hover:bg-security-navy-50"
              )}>
              {f === "all" ? "All" : f === "overdue" ? "With Balance" : "Paid Up"}
            </button>
          ))}
        </div>
        {canExport && clients.length > 0 && (
          <button type="button" onClick={() => exportClientsBalancesToCsv(clients)} className="btn-secondary min-h-9 text-xs ml-auto">
            Export CSV
          </button>
        )}
      </div>

      {/* Client table */}
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-security-lg bg-security-navy-100" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-security-lg border border-security-navy-100 bg-white px-4 py-12 text-center shadow-security-card">
          <p className="text-sm text-security-navy-500">
            {clients.length === 0 ? "No clients with billing data yet." : "No clients match that search."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((client) => {
            const outstanding = Number(client.outstanding ?? 0);
            const hasBalance = outstanding > 0;
            const isExpanded = expandedClientId === client.id;
            // Use d1_30 proxy from outstanding balance since BillableClient has no per-bucket aging
            const risk = computeArRisk({ current: "0", d1_30: hasBalance ? outstanding : 0, d31_60: "0", d61_90: "0", d90_plus: "0" });
            const unconfigured = (client.sitesUnconfiguredCount ?? 0);

            return (
              <div key={client.id} className={clsx("rounded-security-lg border bg-white shadow-security-card transition-all", hasBalance ? "border-security-navy-200" : "border-security-navy-100")}>
                {/* Client header row */}
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/payroll/billing/clients/${client.id}`} className="font-semibold text-security-navy-900 hover:text-security-amber-700 hover:underline">
                        {client.name}
                      </Link>
                      {hasBalance ? <ArRiskBadge risk={risk} /> : <span className="badge-success text-[10px]">Paid up</span>}
                      {unconfigured > 0 && <span className="badge-warning text-[10px]">{unconfigured} unpriced site{unconfigured !== 1 ? "s" : ""}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-security-navy-500">
                      <span>{client.siteCount} site{client.siteCount !== 1 ? "s" : ""}</span>
                      <span>{client.billableGuardCount ?? 0} guards</span>
                      <span>{client.invoiceCount} invoice{client.invoiceCount !== 1 ? "s" : ""}</span>
                      {client.paymentTermsDays && <span>{client.paymentTermsDays} day terms</span>}
                    </div>
                  </div>

                  {/* Right side: numbers */}
                  <div className="flex flex-wrap items-center gap-4 text-right">
                    <div>
                      <p className="section-title">Monthly</p>
                      <p className="font-mono text-sm font-bold tabular-nums text-security-navy-900">
                        {formatCurrency(client.monthlyBillingTotal ?? 0, { currency })}
                      </p>
                    </div>
                    <div>
                      <p className="section-title">Outstanding</p>
                      <p className={clsx("font-mono text-sm font-bold tabular-nums", hasBalance ? "text-red-700" : "text-security-navy-400")}>
                        {formatCurrency(outstanding, { currency })}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    <Link href={`/payroll/billing/clients/${client.id}`} className="btn-primary min-h-9 px-3 text-xs">
                      View Account
                    </Link>
                    <Link href={`/payroll/billing/clients/${client.id}?tab=statement`} className="btn-secondary min-h-9 px-3 text-xs">
                      Statement
                    </Link>
                    {canExport && (
                      <button type="button" onClick={() => handlePreviewStatement(client)} disabled={actionLoadingId === client.id} className="btn-secondary min-h-9 px-2 text-xs" title="Preview PDF">
                        {actionLoadingId === client.id ? "…" : "PDF"}
                      </button>
                    )}
                    {canEdit && client.sites && client.sites.length > 0 && (
                      <button type="button" onClick={() => setExpandedClientId(isExpanded ? null : client.id)} className="btn-ghost min-h-9 px-2 text-xs" title="Expand site rates">
                        {isExpanded ? "▲" : "▼"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Expandable site rates */}
                {isExpanded && client.sites && client.sites.length > 0 && (
                  <div className="border-t border-security-navy-100 bg-security-navy-50/50 p-4">
                    <p className="mb-3 section-title">Site Billing Rates — {client.name}</p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {client.sites.map((site) => (
                        <div key={site.siteId} className={clsx("rounded-security border bg-white p-3", !site.billingConfigured ? "border-security-amber-200" : "border-security-navy-100")}>
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-xs font-semibold text-security-navy-900">{site.siteName}</p>
                            {site.billingConfigured
                              ? <span className="badge-success text-[9px]">Priced</span>
                              : <span className="badge-warning text-[9px]">Needs rate</span>
                            }
                          </div>
                          <div className="mt-1.5 space-y-0.5 text-[11px] text-security-navy-600">
                            <div className="flex justify-between">
                              <span>Rate / guard</span>
                              <span className="font-mono font-semibold">{site.ratePerGuard ? formatCurrency(site.ratePerGuard, { currency }) : "—"}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Guards</span>
                              <span className="font-mono">{site.billableGuardCount}</span>
                            </div>
                            <div className="flex justify-between border-t border-security-navy-100 pt-0.5 font-semibold">
                              <span>Site total</span>
                              <span className="font-mono text-security-navy-900">{formatCurrency(site.siteMonthlyTotal, { currency })}</span>
                            </div>
                          </div>
                          {canEdit && (
                            <button type="button" onClick={() => openRateModal(client.id, client.name, site)} className="mt-2 w-full rounded-security border border-security-navy-200 bg-security-navy-50 py-1 text-[11px] font-semibold text-security-navy-700 hover:bg-security-navy-100">
                              {site.billingConfigured ? "Update Rate" : "Set Rate"}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Rate edit modal */}
      {editingSite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-security-navy-900/50 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEditingSite(null); }}
          role="dialog" aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-security-lg border border-security-navy-100 bg-white shadow-security-elevated">
            <div className="border-b border-security-navy-100 px-5 py-4">
              <p className="section-title">{editingSite.clientName}</p>
              <h2 className="mt-0.5 text-base font-semibold text-security-navy-900">Rate: {editingSite.siteName}</h2>
            </div>

            {rateError && <p className="mx-5 mt-3 rounded-security border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{rateError}</p>}

            <form onSubmit={handleSaveRate} className="space-y-4 p-5">
              <div className="rounded-security bg-security-navy-50 px-3 py-2 text-sm text-security-navy-700">
                Active guards: <strong>{editingSite.billableGuardCount}</strong>
              </div>

              <label className="block">
                <span className="label-text mb-1.5 block">Rate per guard (per month)</span>
                <input type="number" step="0.01" min="0" required value={rateInput} onChange={(e) => setRateInput(e.target.value)} className="input-modern w-full font-mono" placeholder="0.00" autoFocus id="client-rate-per-guard" />
                {parsedLiveRate > 0 && (
                  <p className="mt-1 text-xs text-security-emerald-700 font-semibold">
                    {liveGuards} guards × {formatCurrency(parsedLiveRate, { currency })} = {formatCurrency(liveSiteTotal, { currency })} / month
                  </p>
                )}
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="label-text mb-1.5 block">Effective from</span>
                  <input type="date" required value={effectiveFromInput} onChange={(e) => setEffectiveFromInput(e.target.value)} className="input-modern w-full" id="client-rate-from" />
                </label>
                <label className="block">
                  <span className="label-text mb-1.5 block">Effective to (optional)</span>
                  <input type="date" value={effectiveToInput} onChange={(e) => setEffectiveToInput(e.target.value)} className="input-modern w-full" id="client-rate-to" />
                </label>
              </div>

              <label className="block">
                <span className="label-text mb-1.5 block">Notes (optional)</span>
                <input value={notesInput} onChange={(e) => setNotesInput(e.target.value)} placeholder="e.g. 2026 contract renewal" className="input-modern w-full" id="client-rate-notes" />
              </label>

              <div className="flex gap-2">
                <button type="submit" disabled={savingRate || !canEdit} className="btn-primary flex-1">{savingRate ? "Saving…" : "Save Rate"}</button>
                <button type="button" onClick={() => setEditingSite(null)} disabled={savingRate} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
