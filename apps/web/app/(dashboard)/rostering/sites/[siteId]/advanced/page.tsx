"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCurrentPayPeriod, fetchPayPeriods, type PayPeriodOption } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfirmDialog } from "@/components/ui";
import { fetchRosterContinuityStatus, type RosterContinuityStatus, type RosterShiftCode } from "@/lib/roster-api";
import { GuardPatternBuilder } from "../../../GuardPatternBuilder";
import {
  ManualRosteringWorkspace,
  type ManualRosteringWorkspaceHandle,
  type PatternBuilderContext,
  type RosterDraftState,
} from "../../../ManualRosteringWorkspace";

const EMPTY_DRAFT: RosterDraftState = {
  hasUnsavedChanges: false,
  pendingCount: 0,
  isSaving: false,
  isPublishing: false,
  hardIssueCount: 0,
  warningCount: 0,
  canPublish: false,
};

export default function AdvancedRosterEditorPage() {
  const params = useParams<{ siteId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
  const siteId = params.siteId;
  const [status, setStatus] = useState<RosterContinuityStatus | null>(null);
  const [periods, setPeriods] = useState<PayPeriodOption[]>([]);
  const [period, setPeriod] = useState<PayPeriodOption | null>(null);
  const [draft, setDraft] = useState<RosterDraftState>(EMPTY_DRAFT);
  const [patternContext, setPatternContext] = useState<PatternBuilderContext | null>(null);
  const [cycleLength, setCycleLength] = useState(6);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const workspaceRef = useRef<ManualRosteringWorkspaceHandle>(null);
  const requestedPeriodKey = searchParams.get("period");
  const ongoingMode = searchParams.get("mode") === "ongoing";

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true); setError(null);
    fetchRosterContinuityStatus(token, siteId)
      .then(async (nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
        const [current, options] = await Promise.all([
          fetchCurrentPayPeriod(token, { calendarId: nextStatus.calendar.id }),
          fetchPayPeriods(token, { before: 12, after: 6, calendarId: nextStatus.calendar.id }),
        ]);
        if (!active) return;
        setPeriods(options);
        const selected = options.find((item) => item.periodKey === requestedPeriodKey) ?? current;
        setPeriod(selected);
        if (selected.periodKey !== requestedPeriodKey) {
          router.replace(`/rostering/sites/${siteId}/advanced?period=${encodeURIComponent(selected.periodKey)}${ongoingMode ? "&mode=ongoing" : ""}`);
        }
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not open the advanced roster editor."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ongoingMode, requestedPeriodKey, router, siteId, token]);

  useEffect(() => {
    if (!draft.hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft.hasUnsavedChanges]);

  const handlePatternContextChange = useCallback((context: PatternBuilderContext | null) => {
    setPatternContext(context);
    if (context?.cycleLengthDays) setCycleLength(context.cycleLengthDays);
  }, []);

  const changePeriod = async (next: PayPeriodOption) => {
    if (draft.hasUnsavedChanges && !(await confirm({
      title: "Discard unsaved changes?",
      message: "Opening another roster period will discard the cell changes you have not saved.",
      confirmLabel: "Discard and continue",
      danger: true,
    }))) return;
    router.replace(`/rostering/sites/${siteId}/advanced?period=${encodeURIComponent(next.periodKey)}${ongoingMode ? "&mode=ongoing" : ""}`);
  };

  const applyOngoingSchedule = async () => {
    if (!period || draft.pendingCount === 0 || draft.hardIssueCount > 0) return;
    const accepted = await confirm({
      title: "Start this ongoing schedule?",
      message: `These ${draft.pendingCount} change${draft.pendingCount === 1 ? "" : "s"} will create a new repeating schedule effective from the first changed date in ${period.rosterLabel}. Historical periods will remain unchanged.`,
      confirmLabel: "Start ongoing schedule",
      danger: false,
    });
    if (accepted) await workspaceRef.current?.saveOngoingPattern();
  };

  if (loading || !status || !period) return <div className="space-y-4 animate-pulse"><div className="h-24 rounded-2xl bg-neutral-200 dark:bg-neutral-800" /><div className="h-96 rounded-2xl bg-neutral-200 dark:bg-neutral-800" /></div>;
  if (error || !status.permissions.canUseAdvancedEditor) return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"><h1 className="text-lg font-semibold">Advanced editor unavailable</h1><p className="mt-2 text-sm">{error ?? "Only administrators and operations managers can use this editor."}</p><Link href={`/rostering/sites/${siteId}`} className="btn-secondary mt-4 inline-flex">Back to site roster</Link></div>;

  const continuous = status.state !== "not_setup";

  return (
    <div className="space-y-4 animate-fade-in">
      <header className="sticky top-0 z-30 rounded-2xl border border-neutral-200 bg-white/95 p-4 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><Link href={`/rostering/sites/${siteId}`} className="text-sm font-medium text-orange-700 hover:underline dark:text-orange-300">← Back to simple roster view</Link><div className="mt-2 flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold text-neutral-900 dark:text-white">{ongoingMode ? "Change the ongoing schedule" : "Advanced roster editor"}</h1><span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">Managers only</span></div><p className="mt-1 text-sm text-neutral-500">{status.siteName} · {ongoingMode ? "Create a new effective-dated repeating schedule without changing roster history." : "Use for bulk edits, patterns, manual sites, and PDF exports."}</p></div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end"><label><span className="block text-xs font-medium text-neutral-500">{ongoingMode ? "Effective roster period" : "Roster period"}</span><select value={period.periodKey} onChange={(event) => { const next = periods.find((item) => item.periodKey === event.target.value); if (next) void changePeriod(next); }} className="input-modern mt-1 w-full sm:w-64">{periods.map((item) => <option key={item.periodKey} value={item.periodKey}>{item.rosterLabel}</option>)}</select></label>{draft.hasUnsavedChanges && <button type="button" onClick={() => void workspaceRef.current?.discardChanges()} disabled={draft.isSaving} className="btn-secondary">Discard</button>}{ongoingMode ? <button type="button" onClick={() => void applyOngoingSchedule()} disabled={!draft.hasUnsavedChanges || draft.hardIssueCount > 0 || draft.isSaving} className="btn-primary disabled:opacity-50">{draft.isSaving ? "Applying…" : "Review and start schedule"}</button> : <button type="button" onClick={() => void workspaceRef.current?.saveRoster()} disabled={!draft.hasUnsavedChanges || draft.isSaving} className="btn-primary disabled:opacity-50">{draft.isSaving ? "Saving…" : `Save ${draft.pendingCount || ""} change${draft.pendingCount === 1 ? "" : "s"}`}</button>}{!continuous && !ongoingMode && <button type="button" onClick={() => void workspaceRef.current?.publishRoster()} disabled={!draft.canPublish || draft.isPublishing} className="btn-secondary disabled:opacity-50">{draft.isPublishing ? "Publishing…" : "Publish shifts"}</button>}</div>
        </div>
        {continuous && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">This site is managed continuously. Saving one-day edits publishes them through the continuity engine; there is no separate Publish step.</p>}
      </header>

      {ongoingMode && <ol className="grid gap-2 sm:grid-cols-4" aria-label="Ongoing schedule workflow"><li className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm dark:border-orange-800 dark:bg-orange-950/30"><span className="font-bold">1.</span> Choose effective period</li><li className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm dark:border-orange-800 dark:bg-orange-950/30"><span className="font-bold">2.</span> Edit repeating shifts</li><li className={`rounded-xl border p-3 text-sm ${draft.hardIssueCount > 0 ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200" : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"}`}><span className="font-bold">3.</span> {draft.hardIssueCount > 0 ? `Fix ${draft.hardIssueCount} issue${draft.hardIssueCount === 1 ? "" : "s"}` : "Check coverage"}</li><li className="rounded-xl border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"><span className="font-bold">4.</span> Review and start</li></ol>}

      <details open={ongoingMode} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <summary className="cursor-pointer font-semibold text-neutral-900 dark:text-white">Pattern and team tools</summary>
        <p className="mt-1 text-sm text-neutral-500">Apply a repeating schedule to one guard or stagger it across the whole team.</p>
        <div className="mt-4">{patternContext ? <GuardPatternBuilder cycleLengthDays={cycleLength} onCycleLengthChange={setCycleLength} rows={patternContext.rows} availableGuards={patternContext.availableGuards} addingGuard={patternContext.addingGuard} onAddGuardToSite={(guardId) => void workspaceRef.current?.addGuardToSite(guardId)} onApply={(guardId, codes) => workspaceRef.current?.applyGuardPattern(guardId, codes as RosterShiftCode[])} onApplyAll={(codes) => workspaceRef.current?.applyPatternToAll(codes as RosterShiftCode[])} /> : <p className="text-sm text-neutral-500">Loading pattern tools…</p>}</div>
      </details>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <ManualRosteringWorkspace ref={workspaceRef} siteId={siteId} periodStart={period.periodStart} periodEnd={period.periodEnd} periodLabel={period.rosterLabel} ongoingMode={ongoingMode} onDraftStateChange={setDraft} onPatternContextChange={handlePatternContextChange} />
      </section>
      {confirmDialog}
    </div>
  );
}
