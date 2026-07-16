"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch, fetchCurrentPayPeriod, fetchPayPeriods, fetchRosterPeriodCalendars, type PayPeriodOption, type RosterPeriodCalendarConfig } from "@/lib/api";
import { PayPeriodSelect } from "@/components/pay-period-select";
import { format, startOfMonth, endOfMonth } from "date-fns";
import {
  ManualRosteringWorkspace,
  type ManualRosteringWorkspaceHandle,
  type PatternBuilderContext,
  type RosterDraftState,
} from "./ManualRosteringWorkspace";
import { GuardPatternBuilder } from "./GuardPatternBuilder";
import type { RosterShiftCode } from "@/lib/roster-api";

const DASHBOARD_MAIN_ID = "dashboard-main";

function getRosteringModalContainer(): Element {
  return document.getElementById(DASHBOARD_MAIN_ID) ?? document.body;
}

interface Site {
  id: string;
  name: string;
  assignedGuards?: { employee: { id: string } }[];
}

export default function RosteringPage() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSiteId, setSelectedSiteId] = useState(() => searchParams.get("siteId") ?? "");

  const now = new Date();
  const [periodStart, setPeriodStart] = useState(() => format(startOfMonth(now), "yyyy-MM-dd"));
  const [periodEnd, setPeriodEnd] = useState(() => format(endOfMonth(now), "yyyy-MM-dd"));
  const [periodKey, setPeriodKey] = useState("");
  const [rosterPeriodLabel, setRosterPeriodLabel] = useState("");
  const [payPeriodOptions, setPayPeriodOptions] = useState<PayPeriodOption[]>([]);
  const [rosterCalendars, setRosterCalendars] = useState<RosterPeriodCalendarConfig[]>([]);
  const [rosterCalendarId, setRosterCalendarId] = useState("");
  const [draftPeriodKey, setDraftPeriodKey] = useState("");
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [draftState, setDraftState] = useState<RosterDraftState>({
    hasUnsavedChanges: false,
    pendingCount: 0,
    isSaving: false,
    isPublishing: false,
    hardIssueCount: 0,
    warningCount: 0,
    canPublish: false,
  });
  const workspaceRef = useRef<ManualRosteringWorkspaceHandle>(null);
  const [patternContext, setPatternContext] = useState<PatternBuilderContext | null>(null);
  const [patternCycleLength, setPatternCycleLength] = useState(6);
  const [mobileSetupOpen, setMobileSetupOpen] = useState(false);

  const canLeaveDraft = () =>
    !draftState.hasUnsavedChanges ||
    window.confirm("You have unsaved roster changes. Discard them and continue?");

  const applyPayPeriod = (period: PayPeriodOption, opts?: { skipConfirm?: boolean }) => {
    if (!opts?.skipConfirm && !canLeaveDraft()) return false;
    setPeriodKey(period.periodKey);
    setPeriodStart(period.periodStart);
    setPeriodEnd(period.periodEnd);
    setRosterPeriodLabel(period.rosterLabel);
    return true;
  };

  const shiftPayPeriod = (direction: -1 | 1) => {
    if (!periodKey || payPeriodOptions.length === 0) return;
    const idx = payPeriodOptions.findIndex((p) => p.periodKey === periodKey);
    const next = payPeriodOptions[idx + direction];
    if (next) applyPayPeriod(next);
  };

  const handleSiteChange = (nextSiteId: string) => {
    if (!canLeaveDraft()) return;
    setSelectedSiteId(nextSiteId);
  };

  const loadRosterPeriods = async (calendarId: string, opts?: { skipConfirm?: boolean }) => {
    if (!token || !calendarId) return;
    const [current, periods] = await Promise.all([
      fetchCurrentPayPeriod(token, { calendarId }),
      fetchPayPeriods(token, { before: 12, after: 6, calendarId }),
    ]);
    setPayPeriodOptions(periods);
    if (!periodKey || opts?.skipConfirm) {
      applyPayPeriod(current, { skipConfirm: true });
      setDraftPeriodKey(current.periodKey);
    }
  };

  const handleRosterCalendarChange = (nextCalendarId: string) => {
    if (!canLeaveDraft()) return;
    setRosterCalendarId(nextCalendarId);
    void loadRosterPeriods(nextCalendarId, { skipConfirm: true });
  };

  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetchRosterPeriodCalendars(token),
      authFetch("/sites?limit=100", token).then((r) => r.json()),
    ])
      .then(([calendarsRes, sitesRes]) => {
        setRosterCalendars(calendarsRes.calendars);
        const defaultId = calendarsRes.defaultCalendarId || calendarsRes.calendars[0]?.id || "";
        setRosterCalendarId(defaultId);
        setSites(sitesRes.data ?? []);
        if (defaultId) {
          return loadRosterPeriods(defaultId, { skipConfirm: true });
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    setDraftState({
      hasUnsavedChanges: false,
      pendingCount: 0,
      isSaving: false,
      isPublishing: false,
      hardIssueCount: 0,
      warningCount: 0,
      canPublish: false,
    });
    setPatternContext(null);
    setPatternCycleLength(6);
  }, [selectedSiteId, periodStart, periodEnd, rosterCalendarId]);

  useEffect(() => {
    if (!draftState.hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [draftState.hasUnsavedChanges]);

  useEffect(() => {
    if (patternContext?.cycleLengthDays) {
      setPatternCycleLength(patternContext.cycleLengthDays);
    }
  }, [patternContext?.cycleLengthDays, selectedSiteId]);

  const selectedSite = sites.find((s) => s.id === selectedSiteId);
  const guardCount = selectedSite?.assignedGuards?.length ?? 0;

  const periodLabel =
    rosterPeriodLabel ||
    (periodStart && periodEnd ? `${periodStart} – ${periodEnd}` : "Select period");

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1600px] animate-pulse p-4">
        <div className="h-10 bg-neutral-200 dark:bg-neutral-700 rounded-lg w-64 mb-6" />
        <div className="h-[500px] bg-neutral-200 dark:bg-neutral-700 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-col gap-3 p-2 sm:p-3 lg:h-[calc(100dvh-7.5rem)] lg:min-h-[600px] lg:flex-row">
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setMobileSetupOpen((v) => !v)}
          className="btn-secondary w-full flex items-center justify-between gap-2 text-sm"
          aria-expanded={mobileSetupOpen}
        >
          <span>
            {mobileSetupOpen ? "Hide setup" : "Show setup"} — site, period &amp; patterns
          </span>
          <svg
            className={`h-4 w-4 shrink-0 transition-transform ${mobileSetupOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      <aside
        className={`shrink-0 min-w-0 min-h-0 lg:w-72 lg:h-full ${
          mobileSetupOpen ? "block" : "hidden lg:block"
        }`}
      >
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/80 p-4 space-y-4 shadow-sm min-w-0 w-full max-h-[min(70dvh,32rem)] overflow-y-auto overflow-x-hidden overscroll-y-contain lg:max-h-[calc(100dvh-7.5rem)] lg:h-full">
          <div>
            <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Roster builder</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
              Select a site and period, then assign shifts manually or with patterns.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              1. Site
            </label>
            <select
              value={selectedSiteId}
              onChange={(e) => handleSiteChange(e.target.value)}
              className="input-modern w-full py-2.5 text-sm"
            >
              <option value="">Select site…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {sites.length === 0 && (
              <p className="text-xs text-neutral-500">
                No sites yet. Add a site on the Sites page before building a roster.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              2. Roster type
            </label>
            <select
              value={rosterCalendarId}
              onChange={(e) => handleRosterCalendarChange(e.target.value)}
              className="input-modern w-full py-2.5 text-sm"
            >
              {rosterCalendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name} ({calendar.startDay}–{calendar.endDay})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              3. Roster period
            </label>
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 px-3 py-2.5">
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{periodLabel}</p>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                {periodStart} – {periodEnd}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => shiftPayPeriod(-1)}
                className="flex-1 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => {
                  const current = payPeriodOptions.find((p) => p.isCurrent);
                  if (current) applyPayPeriod(current);
                }}
                className="flex-1 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                Current
              </button>
              <button
                type="button"
                onClick={() => shiftPayPeriod(1)}
                className="flex-1 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                Next
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setDraftPeriodKey(periodKey);
                setShowPeriodModal(true);
              }}
              className="text-xs text-orange-700 dark:text-orange-300 hover:underline"
            >
              Choose different period…
            </button>
          </div>

          {selectedSiteId && (
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/40 px-3 py-2 text-xs text-neutral-600 dark:text-neutral-400">
              <span className="font-medium text-neutral-800 dark:text-neutral-200">{guardCount}</span> guards on
              this site
            </div>
          )}

          {selectedSiteId && (
            <div className="border-t border-neutral-200 dark:border-neutral-700 pt-4 min-w-0">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                4. Pattern builder
              </label>
              <div className="mt-2 min-w-0 w-full">
                {patternContext ? (
                  <GuardPatternBuilder
                    compact
                    cycleLengthDays={patternCycleLength}
                    onCycleLengthChange={setPatternCycleLength}
                    rows={patternContext.rows}
                    availableGuards={patternContext.availableGuards}
                    addingGuard={patternContext.addingGuard}
                    onAddGuardToSite={(guardId) => void workspaceRef.current?.addGuardToSite(guardId)}
                    onApply={(guardId, codes) =>
                      workspaceRef.current?.applyGuardPattern(guardId, codes as RosterShiftCode[])
                    }
                    onApplyAll={(codes) => workspaceRef.current?.applyPatternToAll(codes as RosterShiftCode[])}
                  />
                ) : (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 py-2">
                    Loading roster…
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900/80 lg:min-h-0">
        <div className="shrink-0 border-b border-neutral-200 bg-neutral-50/50 px-3 py-3 dark:border-neutral-700 dark:bg-neutral-900/50 sm:px-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200 truncate">
                {selectedSiteId ? selectedSite?.name : "Select a site to begin"}
              </p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                Fill the grid → fix issues → publish → share PDF
              </p>
            </div>
          {selectedSiteId && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              {draftState.hasUnsavedChanges && (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-300 px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60">
                  {draftState.pendingCount} unsaved
                </span>
              )}
              {draftState.hardIssueCount > 0 && (
                <span className="text-xs font-medium text-red-700 dark:text-red-300 px-2 py-1 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60">
                  {draftState.hardIssueCount} issue{draftState.hardIssueCount === 1 ? "" : "s"} to fix
                </span>
              )}
              {draftState.hasUnsavedChanges && (
                <button
                  type="button"
                  onClick={() => void workspaceRef.current?.discardChanges()}
                  disabled={draftState.isSaving || draftState.isPublishing}
                  className="btn-secondary w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Discard changes
                </button>
              )}
              <button
                type="button"
                onClick={() => void workspaceRef.current?.saveRoster()}
                disabled={!draftState.hasUnsavedChanges || draftState.isSaving}
                className="btn-primary w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {draftState.isSaving
                  ? "Saving…"
                  : draftState.hasUnsavedChanges
                    ? `Save draft (${draftState.pendingCount})`
                    : "Save draft"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Publish this roster? This replaces any previously published shifts for this site and period."
                    )
                  ) {
                    void workspaceRef.current?.publishRoster();
                  }
                }}
                disabled={!draftState.canPublish}
                title={
                  draftState.hasUnsavedChanges
                    ? "Save draft before publishing"
                    : draftState.hardIssueCount > 0
                      ? "Fix roster issues before publishing"
                      : undefined
                }
                className="btn-secondary w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {draftState.isPublishing ? "Publishing…" : "Publish shifts"}
              </button>
            </div>
          )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-4">
          {selectedSiteId ? (
            <div className="space-y-4">
              <div className="grid gap-2 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3 text-xs dark:border-neutral-700 dark:bg-neutral-900/40 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Build", "Fill the grid manually or with patterns"],
                  ["Review", "Fix red issues before publishing"],
                  ["Publish", "Create operational shifts"],
                  ["Share", "Preview or download the PDF"],
                ].map(([title, detail], index) => (
                  <div key={title} className="rounded-lg bg-white px-3 py-2 shadow-sm dark:bg-neutral-950">
                    <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                      {index + 1}. {title}
                    </p>
                    <p className="mt-0.5 text-neutral-500 dark:text-neutral-400">{detail}</p>
                  </div>
                ))}
              </div>
              <ManualRosteringWorkspace
                ref={workspaceRef}
                siteId={selectedSiteId}
                periodStart={periodStart}
                periodEnd={periodEnd}
                periodLabel={periodLabel}
                onDraftStateChange={setDraftState}
                onPatternContextChange={setPatternContext}
              />
            </div>
          ) : (
            <div className="h-full min-h-[320px] flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 text-center px-6">
              <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
                Select a site to build the roster
              </p>
              <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400 max-w-sm">
                Choose a site from the sidebar, pick the roster period, then assign day, night, off, leave, and
                other shifts directly in the grid.
              </p>
            </div>
          )}
        </div>
      </main>

      {showPeriodModal &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="card-wireframe w-full max-w-sm shadow-xl">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
                  Choose roster period
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
                  Select the roster period for the chosen calendar type.
                </p>
                <div className="mb-6">
                  {token && rosterCalendarId && (
                    <PayPeriodSelect
                      token={token}
                      variant="roster"
                      calendarId={rosterCalendarId}
                      value={draftPeriodKey}
                      onChange={(p) => setDraftPeriodKey(p.periodKey)}
                    />
                  )}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowPeriodModal(false)} className="flex-1 btn-secondary">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const picked = payPeriodOptions.find((p) => p.periodKey === draftPeriodKey);
                      if (picked) {
                        const applied = applyPayPeriod(picked);
                        if (applied) setShowPeriodModal(false);
                      }
                    }}
                    disabled={!draftPeriodKey}
                    className="flex-1 btn-primary disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>,
          getRosteringModalContainer()
        )}
    </div>
  );
}
