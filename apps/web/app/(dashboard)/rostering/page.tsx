"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import { fetchCurrentPayPeriod, type PayPeriodOption } from "@/lib/api";
import { PayPeriodSelect } from "@/components/pay-period-select";
import {
  autoBuildUnrosteredSites,
  fetchRosterContinuityOverview,
  fetchSecurityGuardOptions,
  fetchSiteRosterConfig,
  type GuardPickerOption,
  type RosterContinuityOverviewSite,
  type RosterSiteConfig,
} from "@/lib/roster-api";
import {
  filterRosterOperationsSites,
  rosterSiteActionLabel,
  type RosterStatusFilter,
} from "@/lib/roster-operations-utils";
import { SiteQuickSetupDrawer } from "./_components/SiteQuickSetupDrawer";

export default function RosteringHubPage() {
  const { token, user } = useAuth();
  const canEdit = Boolean(user && hasCapability(user, "/rostering", "edit"));

  const [sites, setSites] = useState<RosterContinuityOverviewSite[]>([]);
  const [guards, setGuards] = useState<GuardPickerOption[]>([]);
  const [period, setPeriod] = useState<PayPeriodOption | null>(null);
  const [statusFilter, setStatusFilter] = useState<RosterStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [autoBuilding, setAutoBuilding] = useState(false);
  const [autoBuildBanner, setAutoBuildBanner] = useState<string | null>(null);

  const [setupSiteId, setSetupSiteId] = useState<string | null>(null);
  const [setupSiteConfig, setSetupSiteConfig] = useState<RosterSiteConfig | null>(null);

  const loadHub = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, guardsRes, curPeriod] = await Promise.all([
        fetchRosterContinuityOverview(token),
        fetchSecurityGuardOptions(token),
        period ? Promise.resolve(period) : fetchCurrentPayPeriod(token),
      ]);
      setSites(overviewRes.sites);
      setGuards(guardsRes);
      if (!period && curPeriod) setPeriod(curPeriod);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rostering hub");
    } finally {
      setLoading(false);
    }
  }, [token, period]);

  useEffect(() => {
    loadHub();
  }, [loadHub]);

  const openQuickSetup = async (siteId: string) => {
    if (!token) return;
    setSetupSiteId(siteId);
    try {
      const cfg = await fetchSiteRosterConfig(token, siteId);
      setSetupSiteConfig(cfg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load site setup");
      setSetupSiteId(null);
    }
  };

  const handleAutoBuildUnrostered = async () => {
    if (!token || !period) return;
    setAutoBuilding(true);
    setAutoBuildBanner(null);
    setError(null);
    try {
      const res = await autoBuildUnrosteredSites(token, {
        startDate: period.periodStart,
        endDate: period.periodEnd,
        dryRun: false,
      });
      setAutoBuildBanner(
        res.builtCount > 0
          ? `Built & published SA-compliant rosters for ${res.builtCount} site${res.builtCount === 1 ? "" : "s"} (${period.rosterLabel || period.label}).`
          : "All active sites with guard headcount already have shifts in this cycle."
      );
      await loadHub();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto-build failed");
    } finally {
      setAutoBuilding(false);
    }
  };

  const filteredSites = useMemo(
    () => filterRosterOperationsSites(sites, statusFilter, search),
    [sites, statusFilter, search]
  );

  const stats = useMemo(() => {
    const ready = sites.filter((s) => s.state === "running").length;
    const needsAttention = sites.filter((s) => s.state === "needs_attention").length;
    const notSetup = sites.filter((s) => s.state === "not_setup" || s.state === "paused").length;
    const openIssues = sites.reduce((n, s) => n + s.issueCount, 0);
    return { ready, needsAttention, notSetup, openIssues };
  }, [sites]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-security-navy-900 dark:text-white">
            Rostering Command Hub
          </h1>
          <p className="text-sm text-security-navy-500 dark:text-security-navy-400 mt-1">
            Build, adjust, and publish guard schedules for every site using South African Sector 6 rules.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {token && (
            <div className="w-64">
              <PayPeriodSelect
                token={token}
                variant="roster"
                value={period?.periodKey ?? ""}
                onChange={(nextPeriod) => setPeriod(nextPeriod)}
              />
            </div>
          )}
          {canEdit && period && (
            <button
              type="button"
              onClick={handleAutoBuildUnrostered}
              disabled={autoBuilding}
              className="btn-primary min-h-[44px]"
            >
              {autoBuilding ? "Building Rosters…" : "Auto-Build Unrostered Sites"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {autoBuildBanner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
          {autoBuildBanner}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-security-navy-200 dark:border-security-navy-800 bg-white dark:bg-security-navy-900 p-4">
          <div className="text-xs text-security-navy-500 dark:text-security-navy-400">Active Sites</div>
          <div className="text-2xl font-bold tabular-nums text-security-navy-900 dark:text-white mt-1">
            {sites.length}
          </div>
        </div>
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-white dark:bg-security-navy-900 p-4">
          <div className="text-xs text-emerald-700 dark:text-emerald-300">Schedules Running</div>
          <div className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300 mt-1">
            {stats.ready}
          </div>
        </div>
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-white dark:bg-security-navy-900 p-4">
          <div className="text-xs text-amber-700 dark:text-amber-300">Needs Setup / Paused</div>
          <div className="text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-300 mt-1">
            {stats.notSetup}
          </div>
        </div>
        <div className="rounded-xl border border-security-navy-200 dark:border-security-navy-800 bg-white dark:bg-security-navy-900 p-4">
          <div className="text-xs text-security-navy-500 dark:text-security-navy-400">Open Shift Issues</div>
          <div className="text-2xl font-bold tabular-nums text-[var(--accent-signal-deep)] dark:text-amber-300 mt-1">
            {stats.openIssues}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-nowrap overflow-x-auto gap-1.5 pb-1">
          {(
            [
              { id: "all", label: `All Sites (${sites.length})` },
              { id: "needs_attention", label: `Needs Attention (${stats.needsAttention})` },
              { id: "not_setup", label: `Not Set Up (${stats.notSetup})` },
              { id: "running", label: `Ready (${stats.ready})` },
            ] as const
          ).map((f) => {
            const active = statusFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors min-h-[38px] ${
                  active
                    ? "bg-security-navy-900 text-white dark:bg-white dark:text-security-navy-950"
                    : "bg-security-navy-100 dark:bg-security-navy-800 text-security-navy-700 dark:text-security-navy-300 hover:bg-security-navy-200"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a site…"
          className="input-modern sm:w-64 text-sm"
        />
      </div>

      {/* Site Cards */}
      {loading ? (
        <div className="rounded-xl border border-security-navy-200 dark:border-security-navy-800 bg-white dark:bg-security-navy-900 p-8 text-center text-sm text-security-navy-500">
          Loading sites…
        </div>
      ) : filteredSites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-security-navy-300 dark:border-security-navy-700 p-8 text-center text-sm text-security-navy-500">
          No sites match your filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredSites.map((site) => {
            const statusBadge =
              site.state === "running"
                ? { text: "Ready", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" }
                : site.state === "needs_attention"
                  ? {
                      text: `${site.issueCount} Issue${site.issueCount === 1 ? "" : "s"}`,
                      cls: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
                    }
                  : site.state === "paused"
                    ? { text: "Paused", cls: "bg-security-navy-200 text-security-navy-800" }
                    : { text: "Needs Setup", cls: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" };

            const defaultTab = site.state === "not_setup" ? "builder" : site.issueCount > 0 ? "issues" : "schedule";
            const query = period
              ? `?start=${period.periodStart}&end=${period.periodEnd}&tab=${defaultTab}`
              : `?tab=${defaultTab}`;

            return (
              <div
                key={site.siteId}
                className="rounded-xl border border-security-navy-200 dark:border-security-navy-800 bg-white dark:bg-security-navy-900 p-4 flex flex-col justify-between gap-4 shadow-xs"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-base font-semibold text-security-navy-900 dark:text-white leading-snug">
                      {site.siteName}
                    </h2>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusBadge.cls}`}>
                      {statusBadge.text}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-security-navy-500 dark:text-security-navy-400">
                    <span>{site.guardCount} guard{site.guardCount === 1 ? "" : "s"} assigned</span>
                    <span>·</span>
                    <span>{site.calendar.name} ({site.calendar.startDay}th–{site.calendar.endDay}th)</span>
                  </div>

                  {site.nextIssue && (
                    <p className="rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                      Next alert: {site.nextIssue.title}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-security-navy-100 dark:border-security-navy-800">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => openQuickSetup(site.siteId)}
                      className="rounded-lg border border-security-navy-300 dark:border-security-navy-700 px-3 py-2 text-xs font-medium text-security-navy-700 dark:text-security-navy-200 hover:bg-security-navy-50 dark:hover:bg-security-navy-800 min-h-[40px]"
                    >
                      Quick Setup
                    </button>
                  ) : (
                    <span />
                  )}
                  <Link
                    href={`/rostering/sites/${site.siteId}${query}`}
                    className="btn-primary text-xs min-h-[40px] inline-flex items-center"
                  >
                    {rosterSiteActionLabel(site)}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {token && setupSiteId && setupSiteConfig && (
        <SiteQuickSetupDrawer
          open={Boolean(setupSiteId)}
          onClose={() => {
            setSetupSiteId(null);
            setSetupSiteConfig(null);
          }}
          token={token}
          siteId={setupSiteId}
          siteName={setupSiteConfig.name}
          initialFramework={setupSiteConfig.operatingFramework}
          initialObBookMode={setupSiteConfig.obBookMode}
          initialPsiraMode={setupSiteConfig.psiraEnforcementMode}
          initialMealPaid={setupSiteConfig.mealIntervalPaid}
          initialDayGuards={setupSiteConfig.rosterDayShiftGuardsRequired}
          initialNightGuards={setupSiteConfig.rosterNightShiftGuardsRequired}
          initialDayStart={setupSiteConfig.rosterDayShiftStartTime}
          initialDayEnd={setupSiteConfig.rosterDayShiftEndTime}
          initialNightStart={setupSiteConfig.rosterNightShiftStartTime}
          initialNightEnd={setupSiteConfig.rosterNightShiftEndTime}
          initialAssignedGuardIds={setupSiteConfig.assignedGuardIds}
          allGuards={guards.map((g) => ({
            id: g.id,
            firstName: g.firstName,
            lastName: g.lastName,
            employeeNumber: g.employeeNumber || "",
            status: g.status || "active",
            psiraGrade: g.psiraGrade,
          }))}
          onSaved={loadHub}
        />
      )}
    </div>
  );
}
