"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  activateRosterContinuity,
  confirmRosterReplacement,
  fetchContinuitySetupSuggestion,
  fetchReplacementSuggestions,
  pauseRosterContinuity,
  reconcileRosterContinuity,
  type RosterContinuityIssue,
  type RosterContinuityStatus,
  type RosterReplacementSuggestion,
  type RosterSetupSuggestion,
  type RosterShiftCode,
} from "@/lib/roster-api";

const SHIFT_LABELS: Record<RosterShiftCode, string> = {
  D: "Day shift",
  N: "Night shift",
  O: "Off",
  L: "Approved leave",
  SL: "Sick leave",
  TR: "Training",
  SB: "Standby",
  AWOL: "Absent",
  R: "Replacement",
  blank: "Unassigned",
};

function displayDate(value: string | null | undefined): string {
  if (!value) return "Not yet prepared";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));
}

function SetupSteps({ current }: { current: number }) {
  const steps = ["Confirm team", "Review schedule", "Roster period", "Activate"];
  return (
    <ol className="grid gap-2 sm:grid-cols-4" aria-label={`Setup step ${current} of 4`}>
      {steps.map((label, index) => {
        const number = index + 1;
        const active = number === current;
        const complete = number < current;
        return (
          <li key={label} className={`rounded-xl border px-3 py-2 ${active ? "border-orange-400 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30" : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"}`}>
            <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${complete ? "bg-emerald-600 text-white" : active ? "bg-orange-500 text-white" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}>{complete ? "✓" : number}</span>
            <span className="ml-2 text-xs font-semibold text-neutral-800 dark:text-neutral-200">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function PatternPreview({ suggestion }: { suggestion: RosterSetupSuggestion }) {
  const rows = useMemo(() => {
    if (!suggestion.pattern) return [];
    return suggestion.assignedGuards.map((guard) => ({
      ...guard,
      cells: suggestion.pattern!.cells
        .filter((cell) => cell.guardId === guard.id)
        .sort((a, b) => a.patternDayIndex - b.patternDayIndex),
    }));
  }, [suggestion]);
  if (!suggestion.pattern) {
    return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Plethora could not confirm a safe repeating schedule from the available history.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800">Schedule found</span>
        <span className="text-sm text-neutral-600 dark:text-neutral-400">Matches {suggestion.confidencePercent}% of recent roster history</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400"><tr><th className="sticky left-0 bg-neutral-50 px-3 py-2 text-left dark:bg-neutral-900">Guard</th>{Array.from({ length: suggestion.pattern.cycleLengthDays }, (_, index) => <th key={index} className="min-w-24 px-2 py-2 text-center">Cycle day {index + 1}</th>)}</tr></thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {rows.map((row) => <tr key={row.id}><td className="sticky left-0 whitespace-nowrap bg-white px-3 py-2 font-medium dark:bg-neutral-950">{row.name}</td>{Array.from({ length: suggestion.pattern!.cycleLengthDays }, (_, patternDayIndex) => { const cell = row.cells.find((item) => item.patternDayIndex === patternDayIndex); const code = cell?.shiftCode ?? "blank"; return <td key={patternDayIndex} className="px-2 py-2 text-center"><span className={`inline-flex rounded-lg px-2 py-1 text-xs font-semibold ${code === "D" ? "bg-amber-100 text-amber-800" : code === "N" ? "bg-indigo-100 text-indigo-800" : "bg-neutral-100 text-neutral-600"}`}>{SHIFT_LABELS[code]}</span></td>; })}</tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RosterContinuityPanel({
  siteId,
  status,
  onChanged,
  onOneDayChange,
}: {
  siteId: string;
  status: RosterContinuityStatus;
  onChanged: () => Promise<void> | void;
  onOneDayChange: () => void;
}) {
  const { token } = useAuth();
  const [suggestion, setSuggestion] = useState<RosterSetupSuggestion | null>(null);
  const [setupStep, setSetupStep] = useState(1);
  const [calendarId, setCalendarId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [replacementIssue, setReplacementIssue] = useState<RosterContinuityIssue | null>(null);
  const [replacements, setReplacements] = useState<RosterReplacementSuggestion[]>([]);
  const closeReplacementRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!token || status.state !== "not_setup") return;
    setLoadingSuggestion(true);
    setError(null);
    fetchContinuitySetupSuggestion(token, siteId)
      .then((next) => {
        setSuggestion(next);
        setCalendarId(next.recommendedCalendarId);
        setEffectiveFrom(next.recommendedEffectiveFrom);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not analyse the existing roster."))
      .finally(() => setLoadingSuggestion(false));
  }, [siteId, status.state, token]);

  useEffect(() => {
    if (replacementIssue) closeReplacementRef.current?.focus();
  }, [replacementIssue]);

  const activate = async () => {
    if (!token || !status.permissions.canManageBaseline || !suggestion || !calendarId || !effectiveFrom) return;
    setWorking(true); setError(null); setMessage(null);
    try {
      await activateRosterContinuity(token, siteId, { calendarId, effectiveFrom });
      setMessage("Automatic rostering is now running.");
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start automatic rostering.");
    } finally { setWorking(false); }
  };

  const updateNow = async () => {
    if (!token || !status.permissions.canManageBaseline) return;
    setWorking(true); setError(null); setMessage(null);
    try {
      await reconcileRosterContinuity(token, siteId);
      setMessage("The roster has been checked and updated.");
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the roster."); }
    finally { setWorking(false); }
  };

  const pause = async () => {
    if (!token || !status.permissions.canManageBaseline || !pauseReason.trim()) return;
    setWorking(true); setError(null);
    try {
      await pauseRosterContinuity(token, siteId, true, pauseReason.trim());
      setPauseOpen(false); setPauseReason(""); setMessage("Automatic rostering has been paused.");
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not pause automatic rostering."); }
    finally { setWorking(false); }
  };

  const resume = async () => {
    if (!token || !status.permissions.canManageBaseline) return;
    setWorking(true); setError(null);
    try {
      await pauseRosterContinuity(token, siteId, false);
      setMessage("Automatic rostering has resumed.");
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not resume automatic rostering."); }
    finally { setWorking(false); }
  };

  const findReplacement = async (issue: RosterContinuityIssue) => {
    if (!token || !status.permissions.canManageExceptions) return;
    setWorking(true); setError(null);
    try {
      const result = await fetchReplacementSuggestions(token, issue.id);
      setReplacementIssue(issue); setReplacements(result.suggestions);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not find available replacements."); }
    finally { setWorking(false); }
  };

  const assignReplacement = async (employeeId: string) => {
    if (!token || !status.permissions.canManageExceptions || !replacementIssue) return;
    setWorking(true); setError(null);
    try {
      await confirmRosterReplacement(token, replacementIssue.id, employeeId);
      setReplacementIssue(null); setReplacements([]); setMessage("The replacement has been assigned and published.");
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That guard is no longer available."); }
    finally { setWorking(false); }
  };

  if (status.state === "not_setup") {
    return (
      <section className="space-y-5 rounded-2xl border border-orange-200 bg-white p-4 shadow-sm dark:border-orange-900/60 dark:bg-neutral-900 sm:p-6">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-orange-700 dark:text-orange-300">Set up automatic rostering</p><h2 className="mt-1 text-xl font-semibold text-neutral-900 dark:text-white">Review what Plethora found</h2><p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">Nothing will be activated until a user with roster edit access confirms all four steps.</p></div>
        <SetupSteps current={setupStep} />
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
        {loadingSuggestion && <div className="h-44 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />}
        {suggestion && setupStep === 1 && <div className="space-y-4"><div><h3 className="font-semibold text-neutral-900 dark:text-white">Team at this site</h3><p className="mt-1 text-sm text-neutral-500">{suggestion.assignedGuards.length} guard{suggestion.assignedGuards.length === 1 ? "" : "s"} included in the suggested roster.</p></div><div className="grid gap-2 sm:grid-cols-2">{suggestion.assignedGuards.map((guard) => <div key={guard.id} className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-medium dark:border-neutral-700 dark:bg-neutral-800">{guard.name}</div>)}</div>{suggestion.assignedGuards.length === 0 && <Link href={`/sites/${siteId}`} className="btn-primary inline-flex">Add guards to this site</Link>}</div>}
        {suggestion && setupStep === 2 && <div className="space-y-4"><PatternPreview suggestion={suggestion} />{!suggestion.pattern && <div className="flex flex-wrap gap-2"><Link href={`/sites/${siteId}`} className="btn-secondary">Check team assignments</Link>{status.permissions.canUseAdvancedEditor && <Link href={`/rostering/sites/${siteId}/advanced`} className="btn-primary">Build schedule manually</Link>}</div>}</div>}
        {suggestion && setupStep === 3 && <div className="grid gap-4 sm:grid-cols-2"><label className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700"><span className="text-sm font-semibold text-neutral-900 dark:text-white">Roster period</span><select value={calendarId} onChange={(event) => setCalendarId(event.target.value)} className="input-modern mt-2 w-full">{suggestion.calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name} ({calendar.startDay}–{calendar.endDay})</option>)}</select><span className="mt-2 block text-xs text-neutral-500">The schedule will continue using this site calendar.</span></label><label className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700"><span className="text-sm font-semibold text-neutral-900 dark:text-white">Start continuing from</span><input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="input-modern mt-2 w-full" /><span className="mt-2 block text-xs text-neutral-500">Existing published periods remain unchanged.</span></label></div>}
        {suggestion && setupStep === 4 && <div className="space-y-4"><div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50"><h3 className="font-semibold text-neutral-900 dark:text-white">Ready to activate</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-neutral-500">Team</dt><dd className="font-medium">{suggestion.assignedGuards.length} guards</dd></div><div><dt className="text-neutral-500">Roster period</dt><dd className="font-medium">{suggestion.calendars.find((item) => item.id === calendarId)?.name}</dd></div><div><dt className="text-neutral-500">Starts</dt><dd className="font-medium">{displayDate(effectiveFrom)}</dd></div></dl></div>{suggestion.issues.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><p className="font-semibold">Resolve these items first</p><ul className="mt-2 list-disc space-y-1 pl-5">{suggestion.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul><div className="mt-3 flex flex-wrap gap-2"><Link href={`/sites/${siteId}`} className="btn-secondary">Update team or staffing</Link>{status.permissions.canUseAdvancedEditor && <Link href={`/rostering/sites/${siteId}/advanced`} className="btn-secondary">Edit suggested schedule</Link>}</div></div>}{!status.permissions.canManageBaseline && <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">A user with roster edit access must complete activation.</p>}</div>}
        {suggestion && <div className="flex flex-col-reverse gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-700 sm:flex-row sm:items-center sm:justify-between"><button type="button" onClick={() => setSetupStep((step) => Math.max(1, step - 1))} disabled={setupStep === 1 || working} className="btn-secondary disabled:opacity-40">Back</button>{setupStep < 4 ? <button type="button" onClick={() => setSetupStep((step) => Math.min(4, step + 1))} disabled={(setupStep === 1 && suggestion.assignedGuards.length === 0) || (setupStep === 2 && !suggestion.pattern)} className="btn-primary disabled:opacity-50">Continue</button> : <button type="button" onClick={() => void activate()} disabled={!suggestion.canActivate || !status.permissions.canManageBaseline || working} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">{working ? "Starting…" : "Activate automatic rostering"}</button>}</div>}
        {suggestion && <details className="rounded-xl border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-700"><summary className="cursor-pointer font-medium text-neutral-600 dark:text-neutral-300">Advanced suggestion details</summary><p className="mt-2 text-neutral-500">{suggestion.pattern ? `${suggestion.pattern.cycleLengthDays}-day repeating cycle inferred from ${displayDate(suggestion.sourcePeriod?.startDate)} to ${displayDate(suggestion.sourcePeriod?.endDate)}.` : suggestion.message}</p></details>}
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {(error || message) && <div role={error ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200" : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"}`}>{error ?? message}</div>}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"><p className="text-xs text-neutral-500">Coverage prepared through</p><p className="mt-1 text-lg font-semibold text-neutral-900 dark:text-white">{status.maintainedThrough ? displayDate(status.maintainedThrough) : status.lastStatus === "failed" ? "Update failed" : "Preparing future shifts"}</p></div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"><p className="text-xs text-neutral-500">Normal schedule</p><p className="mt-1 text-lg font-semibold text-neutral-900 dark:text-white">{status.activePattern?.name ?? "No active pattern"}</p><p className="mt-1 text-xs text-neutral-500">{status.calendar.name} ({status.calendar.startDay}–{status.calendar.endDay})</p></div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"><p className="text-xs text-neutral-500">Items needing attention</p><p className="mt-1 text-lg font-semibold text-neutral-900 dark:text-white">{status.issues.length}</p><p className="mt-1 text-xs text-neutral-500">Last checked {status.lastReconciledAt ? new Date(status.lastReconciledAt).toLocaleString("en-ZA") : "not yet"}</p></div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 sm:p-5">
        <div><h2 className="text-base font-semibold text-neutral-900 dark:text-white">Common actions</h2><p className="mt-1 text-sm text-neutral-500">Use a focused action without rebuilding the full roster.</p></div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {status.state === "paused" ? status.permissions.canManageBaseline && <button type="button" onClick={() => void resume()} disabled={working} className="btn-primary">{working ? "Resuming…" : "Resume automatic rostering"}</button> : <>{status.permissions.canManageExceptions && <button type="button" onClick={onOneDayChange} className="btn-primary">Make a one-day change</button>}{status.permissions.canManageBaseline && <><Link href={`/rostering/sites/${siteId}/advanced?mode=ongoing`} className="btn-secondary hidden sm:inline-flex">Change the ongoing schedule</Link><button type="button" onClick={() => void updateNow()} disabled={working} className="btn-secondary">{working ? "Updating…" : "Update roster now"}</button><button type="button" onClick={() => setPauseOpen(true)} className="btn-secondary">Pause automatic rostering</button></>}</>}
        </div>
        {status.state === "paused" && status.pauseReason && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950/30 dark:text-blue-200"><span className="font-semibold">Reason:</span> {status.pauseReason}</p>}
      </section>

      <section className="space-y-3">
        <div><h2 className="text-lg font-semibold text-neutral-900 dark:text-white">What needs attention</h2><p className="text-sm text-neutral-500">Only the affected shift needs action; the rest of the roster continues normally.</p></div>
        {status.issues.length === 0 ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"><p className="font-semibold">No interruptions</p><p className="mt-1">The roster is continuing normally.</p></div> : status.issues.map((issue) => { const canReplace = status.permissions.canManageExceptions && Boolean(issue.metadata?.dateKey && issue.metadata?.shiftType); return <article id={`roster-issue-${issue.id}`} key={issue.id} tabIndex={-1} className="scroll-mt-24 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 outline-none focus:ring-2 focus:ring-orange-400 dark:border-amber-800 dark:bg-amber-950/20"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-amber-950 dark:text-amber-100">{issue.title}</h3>{issue.priority === "CRITICAL" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300">Urgent</span>}</div><p className="mt-1 text-sm text-amber-900 dark:text-amber-200">{issue.message}</p></div>{canReplace && <button type="button" onClick={() => void findReplacement(issue)} disabled={working} className="btn-primary shrink-0">Find a replacement</button>}</div></article>; })}
      </section>

      {pauseOpen && <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" role="presentation"><div role="dialog" aria-modal="true" aria-labelledby="pause-title" className="w-full rounded-t-2xl bg-white p-5 shadow-xl dark:bg-neutral-900 sm:max-w-md sm:rounded-2xl"><h2 id="pause-title" className="text-lg font-semibold text-neutral-900 dark:text-white">Pause automatic rostering</h2><p className="mt-1 text-sm text-neutral-500">Future automatic updates stop until a user with roster edit access resumes them. Existing shifts remain unchanged.</p><label className="mt-4 block"><span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Reason for pausing</span><textarea value={pauseReason} onChange={(event) => setPauseReason(event.target.value)} rows={3} className="input-modern mt-2 w-full" placeholder="For example: site contract under review" autoFocus /></label><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setPauseOpen(false)} className="btn-secondary">Cancel</button><button type="button" onClick={() => void pause()} disabled={!pauseReason.trim() || working} className="btn-primary disabled:opacity-50">{working ? "Pausing…" : "Pause rostering"}</button></div></div></div>}

      {replacementIssue && <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" role="presentation"><div role="dialog" aria-modal="true" aria-labelledby="replacement-title" className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-neutral-900 sm:max-w-2xl sm:rounded-2xl"><div className="flex items-start justify-between gap-3"><div><h2 id="replacement-title" className="text-lg font-semibold text-neutral-900 dark:text-white">Recommended replacements</h2><p className="mt-1 text-sm text-neutral-500">Available and eligible guards are ranked with an explanation. The normal roster will not change.</p></div><button ref={closeReplacementRef} type="button" onClick={() => { setReplacementIssue(null); setReplacements([]); }} className="btn-secondary px-3 py-1.5">Close</button></div><div className="mt-4 space-y-3">{replacements.length === 0 ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><p className="font-semibold">No eligible replacement is available</p><p className="mt-1">Review site assignments or contact a user with roster approval access.</p></div> : replacements.slice(0, 5).map((replacement, index) => <div key={replacement.employeeId} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><p className="font-semibold text-neutral-900 dark:text-white">{replacement.name}</p>{index === 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Best match</span>}</div><p className="mt-1 text-xs leading-relaxed text-neutral-500">{replacement.reasons.join(" · ")}</p></div><button type="button" onClick={() => void assignReplacement(replacement.employeeId)} disabled={working} className="btn-primary shrink-0">{working ? "Assigning…" : "Assign and publish"}</button></div></div>)}</div></div></div>}
    </div>
  );
}
