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
import {
  AlertBanner,
  Button,
  Card,
  EmptyState,
  KpiStrip,
  PageHeader,
  PageShell,
  SearchInput,
  SkeletonBlock,
  StatusBadge,
  Tabs,
  Toolbar,
} from "@/components/ui";
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
          ? `Built and published SA-compliant rosters for ${res.builtCount} site${res.builtCount === 1 ? "" : "s"} (${period.rosterLabel || period.label}).`
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
    <PageShell width="wide" className="animate-fade-in">
      <PageHeader
        title="Rostering"
        description="Build, adjust, and publish guard schedules for every site using South African Sector 6 rules."
        actions={
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
              <Button
                variant="primary"
                loading={autoBuilding}
                onClick={handleAutoBuildUnrostered}
              >
                Auto-build unrostered sites
              </Button>
            )}
          </div>
        }
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}
      {autoBuildBanner && <AlertBanner variant="success">{autoBuildBanner}</AlertBanner>}

      <KpiStrip
        ariaLabel="Rostering overview metrics"
        items={[
          { label: "Active sites", value: sites.length },
          { label: "Schedules running", value: stats.ready, tone: "success" },
          {
            label: "Needs setup / paused",
            value: stats.notSetup,
            tone: stats.notSetup > 0 ? "warning" : "default",
          },
          {
            label: "Open shift issues",
            value: stats.openIssues,
            tone: stats.openIssues > 0 ? "danger" : "default",
          },
        ]}
      />

      <Toolbar className="justify-between">
        <Tabs
          ariaLabel="Filter sites by roster status"
          variant="segmented"
          value={statusFilter}
          onChange={(val) => setStatusFilter(val)}
          items={[
            { value: "all", label: "All sites", count: sites.length },
            { value: "needs_attention", label: "Needs attention", count: stats.needsAttention },
            { value: "not_setup", label: "Not set up", count: stats.notSetup },
            { value: "running", label: "Ready", count: stats.ready },
          ]}
        />

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Find a site..."
          className="w-full sm:w-64"
        />
      </Toolbar>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonBlock key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : filteredSites.length === 0 ? (
        <EmptyState
          title="No sites match your filter"
          description="Try clearing the search query or switching the status filter."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredSites.map((site) => {
            const statusProps =
              site.state === "running"
                ? { status: "ready", label: "Ready" }
                : site.state === "needs_attention"
                  ? {
                      status: "warning",
                      label: `${site.issueCount} Issue${site.issueCount === 1 ? "" : "s"}`,
                    }
                  : site.state === "paused"
                    ? { status: "inactive", label: "Paused" }
                    : { status: "draft", label: "Needs setup" };

            const defaultTab = site.state === "not_setup" ? "builder" : site.issueCount > 0 ? "issues" : "schedule";
            const query = period
              ? `?start=${period.periodStart}&end=${period.periodEnd}&tab=${defaultTab}`
              : `?tab=${defaultTab}`;

            return (
              <Card key={site.siteId} variant="dashboard" className="flex flex-col justify-between gap-4 p-4">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-display text-base font-semibold leading-snug text-security-navy-900">
                      {site.siteName}
                    </h2>
                    <StatusBadge status={statusProps.status} label={statusProps.label} />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-security-navy-500">
                    <span>
                      {site.guardCount} guard{site.guardCount === 1 ? "" : "s"} assigned
                    </span>
                    <span>·</span>
                    <span>
                      {site.calendar.name} ({site.calendar.startDay}th–{site.calendar.endDay}th)
                    </span>
                  </div>

                  {site.nextIssue && (
                    <AlertBanner variant="warning" className="py-2 text-xs">
                      Next alert: {site.nextIssue.title}
                    </AlertBanner>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-security-navy-100 pt-3">
                  {canEdit ? (
                    <Button variant="secondary" size="sm" onClick={() => openQuickSetup(site.siteId)}>
                      Quick setup
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Link
                    href={`/rostering/sites/${site.siteId}${query}`}
                    className="btn-primary inline-flex items-center px-3 py-2 text-xs no-underline"
                  >
                    {rosterSiteActionLabel(site)}
                  </Link>
                </div>
              </Card>
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
    </PageShell>
  );
}
