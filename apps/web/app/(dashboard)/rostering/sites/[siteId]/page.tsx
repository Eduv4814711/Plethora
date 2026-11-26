"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import { fetchCurrentPayPeriod, type PayPeriodOption } from "@/lib/api";
import { PayPeriodSelect } from "@/components/pay-period-select";
import { generateShiftRosterSheetPDF } from "@/lib/roster-pdf";
import type { ShiftSheetCellCode, ShiftSheetRow } from "@/lib/shift-sheet-matrix";
import {
  confirmRosterReplacement,
  fetchLiveRoster,
  fetchReplacementSuggestions,
  fetchRosterContinuityStatus,
  fetchSecurityGuardOptions,
  fetchSiteRosterConfig,
  getSmartReplacements,
  quickEditRosterCell,
  type GuardPickerOption,
  type RankedReplacementCandidate,
  type RosterContinuityIssue,
  type RosterContinuityStatus,
  type RosterPeriodGrid,
  type RosterReplacementSuggestion,
  type RosterSiteConfig,
} from "@/lib/roster-api";
import { InteractiveRosterBoard } from "../../_components/InteractiveRosterBoard";
import { SaComplianceBanner } from "../../_components/SaComplianceBanner";
import { AlertBanner, Button, PageHeader, PageShell, SkeletonBlock, Tabs } from "@/components/ui";
import { SiteQuickSetupDrawer } from "../../_components/SiteQuickSetupDrawer";
import { SmartRosterWizard } from "../../_components/SmartRosterWizard";

type WorkspaceTab = "schedule" | "builder" | "issues";

function parseTab(raw: string | null): WorkspaceTab {
  if (raw === "builder") return "builder";
  if (raw === "issues") return "issues";
  return "schedule";
}

function SiteWorkspaceInner() {
  const params = useParams<{ siteId: string }>();
  const siteId = decodeURIComponent(params.siteId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, user } = useAuth();

  const canEdit = Boolean(user && hasCapability(user, "/rostering", "edit"));
  const activeTab = parseTab(searchParams.get("tab"));

  const [period, setPeriod] = useState<PayPeriodOption | null>(null);
  const [config, setConfig] = useState<RosterSiteConfig | null>(null);
  const [grid, setGrid] = useState<RosterPeriodGrid | null>(null);
  const [continuity, setContinuity] = useState<RosterContinuityStatus | null>(null);
  const [allGuards, setAllGuards] = useState<GuardPickerOption[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  // Issue resolver state
  const [selectedIssue, setSelectedIssue] = useState<RosterContinuityIssue | null>(null);
  const [legacySuggestions, setLegacySuggestions] = useState<RosterReplacementSuggestion[]>([]);
  const [rankedSuggestions, setRankedSuggestions] = useState<RankedReplacementCandidate[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const startDate = searchParams.get("start") ?? period?.periodStart ?? "";
  const endDate = searchParams.get("end") ?? period?.periodEnd ?? "";

  const setTab = (tab: WorkspaceTab) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", tab);
    router.replace(`/rostering/sites/${encodeURIComponent(siteId)}?${next}`, { scroll: false });
  };

  const loadWorkspace = useCallback(async () => {
    if (!token || !siteId) return;
    setLoading(true);
    setError(null);
    try {
      const curPeriod =
        startDate && endDate
          ? null
          : await fetchCurrentPayPeriod(token);

      const effStart = startDate || curPeriod?.periodStart || "";
      const effEnd = endDate || curPeriod?.periodEnd || "";
      if (curPeriod && !period) setPeriod(curPeriod);

      const [cfgRes, liveRes, contRes, guardsRes] = await Promise.all([
        fetchSiteRosterConfig(token, siteId),
        effStart && effEnd ? fetchLiveRoster(token, siteId, effStart, effEnd) : Promise.resolve(null),
        fetchRosterContinuityStatus(token, siteId).catch(() => null),
        fetchSecurityGuardOptions(token),
      ]);

      setConfig(cfgRes);
      if (liveRes) setGrid(liveRes);
      setContinuity(contRes);
      setAllGuards(guardsRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load site roster");
    } finally {
      setLoading(false);
    }
  }, [token, siteId, startDate, endDate, period]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const siteGuards = useMemo(() => {
    if (!config) return [];
    const setIds = new Set(config.assignedGuardIds);
    return allGuards.filter((g) => setIds.has(g.id));
  }, [allGuards, config]);

  const scheduleStats = useMemo(() => {
    if (!grid || !config) {
      return {
        coveragePercent: 0,
        filledSlots: 0,
        requiredSlots: 0,
        warningsCount: 0,
      };
    }
    const dayCount = grid.calendarDays.length;
    const reqPerDay =
      (config.rosterDayShiftGuardsRequired ?? 0) + (config.rosterNightShiftGuardsRequired ?? 0);
    const requiredSlots = dayCount * reqPerDay;
    let filledSlots = 0;
    for (const row of grid.rows) {
      for (const cell of row.cells) {
        if (cell.shiftCode === "D" || cell.shiftCode === "N" || cell.shiftCode === "R") {
          filledSlots += 1;
        }
      }
    }
    const coveragePercent =
      requiredSlots > 0 ? Math.min(100, Math.round((filledSlots / requiredSlots) * 100)) : 100;
    return {
      coveragePercent,
      filledSlots,
      requiredSlots,
      warningsCount: grid.warnings.length + (continuity?.issues.length ?? 0),
    };
  }, [grid, config, continuity]);

  const handlePrintPdf = () => {
    if (!grid || !config) return;
    const pdfRows: ShiftSheetRow[] = grid.rows.map((r) => {
      const parts = r.guardName.trim().split(/\s+/);
      return {
        employeeId: r.guardId,
        firstName: parts[0] || r.guardName,
        lastName: parts.slice(1).join(" ") || "",
        gender: null,
        phone: null,
        cells: r.cells.map((c) => (c.shiftCode === "blank" ? "" : c.shiftCode)) as ShiftSheetCellCode[],
      };
    });
    const blob = generateShiftRosterSheetPDF({
      siteName: config.name,
      periodLabel: `${grid.periodStart} to ${grid.periodEnd}`,
      days: grid.calendarDays.map((dk) => new Date(`${dk}T00:00:00Z`)),
      rows: pdfRows,
      generatedBy: user?.name,
      rosterSiteRules: config.rosterSiteRules,
      rosterSheetNotes: config.rosterSheetNotes,
      rosterDayShiftGender: config.rosterDayShiftGender,
      rosterNightShiftGender: config.rosterNightShiftGender,
      rosterDayShiftGuardsRequired: config.rosterDayShiftGuardsRequired,
      rosterNightShiftGuardsRequired: config.rosterNightShiftGuardsRequired,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `roster-${config.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${grid.periodStart}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFindRelieversForIssue = async (issue: RosterContinuityIssue) => {
    if (!token) return;
    setSelectedIssue(issue);
    setLoadingSuggestions(true);
    try {
      const workDate =
        typeof issue.metadata?.dateKey === "string"
          ? issue.metadata.dateKey
          : startDate || new Date().toISOString().slice(0, 10);
      const shiftType = issue.metadata?.shiftType === "night" ? "night" : "day";

      const [legRes, smartRes] = await Promise.all([
        fetchReplacementSuggestions(token, issue.id).catch(() => ({ suggestions: [] })),
        getSmartReplacements(token, siteId, { workDate, shiftType }).catch(() => ({ candidates: [] })),
      ]);
      setLegacySuggestions(legRes.suggestions);
      setRankedSuggestions(smartRes.candidates);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleAssignIssueReliever = async (employeeId: string) => {
    if (!token || !selectedIssue) return;
    setResolvingId(employeeId);
    try {
      if (legacySuggestions.some((s) => s.employeeId === employeeId)) {
        await confirmRosterReplacement(token, selectedIssue.id, employeeId);
      } else {
        const workDate =
          typeof selectedIssue.metadata?.dateKey === "string"
            ? selectedIssue.metadata.dateKey
            : startDate;
        const shiftCode = selectedIssue.metadata?.shiftType === "night" ? "N" : "D";
        await quickEditRosterCell(token, siteId, {
          rosterDate: workDate,
          guardId: employeeId,
          shiftCode,
          reason: `Resolved issue: ${selectedIssue.title}`,
          syncPublishedShift: true,
        });
      }
      setSelectedIssue(null);
      await loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign replacement guard");
    } finally {
      setResolvingId(null);
    }
  };

  const issuesList = continuity?.issues ?? [];

  return (
    <PageShell width="wide" className="animate-fade-in">
      <div className="space-y-3">
        <Link
          href="/rostering"
          className="inline-flex items-center text-xs font-medium text-security-navy-600 hover:text-security-navy-900"
        >
          ← All sites
        </Link>
        <PageHeader
          title={config?.name ?? "Site Roster"}
          description={
            `${startDate && endDate ? `Cycle: ${startDate} to ${endDate}` : "Loading pay cycle…"}` +
            `${config ? ` · ${config.rosterDayShiftGuardsRequired} Day / ${config.rosterNightShiftGuardsRequired} Night per day` : ""}` +
            `${config?.operatingFramework ? ` · ${config.operatingFramework.replace(/_/g, " ")}` : ""}`
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {token && (
                <div className="w-56">
                  <PayPeriodSelect
                    token={token}
                    variant="roster"
                    value={period?.periodKey ?? ""}
                    onChange={(nextPeriod) => {
                      setPeriod(nextPeriod);
                      const next = new URLSearchParams(searchParams.toString());
                      next.set("start", nextPeriod.periodStart);
                      next.set("end", nextPeriod.periodEnd);
                      router.replace(`/rostering/sites/${encodeURIComponent(siteId)}?${next}`, {
                        scroll: false,
                      });
                    }}
                  />
                </div>
              )}

              {canEdit && config && (
                <Button variant="secondary" size="sm" onClick={() => setSetupOpen(true)}>
                  Site setup
                </Button>
              )}

              {grid && grid.rows.length > 0 && (
                <Button variant="secondary" size="sm" onClick={handlePrintPdf}>
                  Download PDF
                </Button>
              )}

              <Link
                href={`/rostering/sites/${encodeURIComponent(siteId)}/advanced`}
                className="btn-ghost px-3 py-2 text-xs no-underline"
              >
                Pattern Editor →
              </Link>
            </div>
          }
        />
      </div>

      <Tabs
        ariaLabel="Site roster workspace views"
        value={activeTab}
        onChange={setTab}
        items={[
          { value: "schedule", label: "Schedule" },
          { value: "builder", label: "Smart Builder" },
          { value: "issues", label: "Issues & Relievers", count: issuesList.length || undefined },
        ]}
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {loading ? (
        <SkeletonBlock className="h-64 w-full" />
      ) : (
        <>
          {activeTab === "schedule" && grid && (
            <div className="space-y-4">
              <SaComplianceBanner
                coveragePercent={scheduleStats.coveragePercent}
                filledSlots={scheduleStats.filledSlots}
                requiredSlots={scheduleStats.requiredSlots}
                totalOvertimeHours={0}
                restViolationsCount={grid.warnings.filter((w) => w.severity === "hard").length}
                credentialWarningsCount={grid.warnings.filter((w) => w.code.includes("PSIRA") || w.code.includes("EXPIRED")).length}
                warnings={grid.warnings}
              />

              <InteractiveRosterBoard
                grid={grid}
                token={token!}
                siteId={siteId}
                canEdit={canEdit}
                onUpdated={loadWorkspace}
              />
            </div>
          )}

          {activeTab === "builder" && token && startDate && endDate && (
            <SmartRosterWizard
              token={token}
              siteId={siteId}
              siteName={config?.name ?? "Site"}
              startDate={startDate}
              endDate={endDate}
              initialFramework={config?.operatingFramework}
              dayGuardsRequired={config?.rosterDayShiftGuardsRequired ?? 1}
              nightGuardsRequired={config?.rosterNightShiftGuardsRequired ?? 1}
              siteGuards={siteGuards.map((g) => ({
                id: g.id,
                firstName: g.firstName,
                lastName: g.lastName,
                employeeNumber: g.employeeNumber || "",
                status: g.status || "active",
                psiraGrade: g.psiraGrade,
              }))}
              allCompanyGuards={allGuards.map((g) => ({
                id: g.id,
                firstName: g.firstName,
                lastName: g.lastName,
                employeeNumber: g.employeeNumber || "",
                status: g.status || "active",
                psiraGrade: g.psiraGrade,
              }))}
              onPublished={() => {
                setTab("schedule");
                void loadWorkspace();
              }}
            />
          )}

          {activeTab === "issues" && (
            <div className="space-y-4">
              {issuesList.length === 0 ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-8 text-center">
                  <h3 className="text-base font-semibold text-emerald-900">
                    No Open Roster Gaps or Alerts
                  </h3>
                  <p className="text-xs text-emerald-800 mt-1">
                    Every shift slot on {config?.name ?? "this site"} has an assigned guard. You can still click any cell in Schedule to make swaps.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    {issuesList.map((issue) => (
                      <div
                        key={issue.id}
                        className="rounded-xl border border-amber-200 bg-white p-4 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-semibold text-security-navy-900">
                              {issue.title}
                            </h3>
                            <p className="text-xs text-security-navy-600 mt-0.5">
                              {issue.message}
                            </p>
                          </div>
                          <span className="rounded bg-amber-100 text-amber-900 px-2 py-0.5 text-[10px] font-bold">
                            {issue.priority}
                          </span>
                        </div>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => handleFindRelieversForIssue(issue)}
                            className="btn-primary text-xs min-h-[38px]"
                          >
                            Find Ranked Reliever
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {selectedIssue && (
                    <div className="rounded-xl border border-security-navy-200 bg-white p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">
                          Recommended Relievers for {selectedIssue.title}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setSelectedIssue(null)}
                          className="text-xs text-security-navy-500 hover:underline"
                        >
                          Close
                        </button>
                      </div>

                      {loadingSuggestions ? (
                        <p className="text-xs text-security-navy-500">Checking OT limits &amp; PSIRA…</p>
                      ) : rankedSuggestions.length === 0 ? (
                        <p className="text-xs text-security-navy-500">No eligible replacements found.</p>
                      ) : (
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                          {rankedSuggestions.slice(0, 15).map((c) => (
                            <div
                              key={c.employeeId}
                              className="flex items-center justify-between gap-3 rounded-lg border border-security-navy-200 p-2.5 text-xs"
                            >
                              <div>
                                <div className="font-semibold">
                                  {c.fullName}{" "}
                                  <span className="font-normal text-security-navy-500">
                                    ({c.employeeNumber})
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {c.eligible ? (
                                    c.badges.map((b) => (
                                      <span
                                        key={b}
                                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                          b === "Zero OT"
                                            ? "bg-emerald-100 text-emerald-900"
                                            : "bg-security-navy-100"
                                        }`}
                                      >
                                        {b}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-red-600">{c.ineligibleReason}</span>
                                  )}
                                </div>
                              </div>
                              {c.eligible && (
                                <button
                                  type="button"
                                  disabled={resolvingId === c.employeeId}
                                  onClick={() => handleAssignIssueReliever(c.employeeId)}
                                  className="btn-primary text-xs min-h-[36px] shrink-0"
                                >
                                  {resolvingId === c.employeeId ? "Assigning…" : "Assign"}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {token && config && (
        <SiteQuickSetupDrawer
          open={setupOpen}
          onClose={() => setSetupOpen(false)}
          token={token}
          siteId={siteId}
          siteName={config.name}
          initialFramework={config.operatingFramework}
          initialObBookMode={config.obBookMode}
          initialPsiraMode={config.psiraEnforcementMode}
          initialMealPaid={config.mealIntervalPaid}
          initialDayGuards={config.rosterDayShiftGuardsRequired}
          initialNightGuards={config.rosterNightShiftGuardsRequired}
          initialDayStart={config.rosterDayShiftStartTime}
          initialDayEnd={config.rosterDayShiftEndTime}
          initialNightStart={config.rosterNightShiftStartTime}
          initialNightEnd={config.rosterNightShiftEndTime}
          initialAssignedGuardIds={config.assignedGuardIds}
          allGuards={allGuards.map((g) => ({
            id: g.id,
            firstName: g.firstName,
            lastName: g.lastName,
            employeeNumber: g.employeeNumber || "",
            status: g.status || "active",
            psiraGrade: g.psiraGrade,
          }))}
          onSaved={loadWorkspace}
        />
      )}
    </PageShell>
  );
}

export default function SiteRosterWorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-security-navy-500">
          Loading site roster workspace…
        </div>
      }
    >
      <SiteWorkspaceInner />
    </Suspense>
  );
}
