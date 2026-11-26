"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
import { AlertBanner, Badge, Button, Card, Field, KpiStrip, Modal, SkeletonBlock, Textarea } from "@/components/ui";

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
          <li key={label} className={`rounded-security-lg border px-3 py-2 ${active ? "border-security-amber-400 bg-security-amber-50" : "border-security-navy-100 bg-white"}`}>
            <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${complete ? "bg-security-emerald-600 text-white" : active ? "bg-security-amber-500 text-white" : "bg-security-navy-50 text-security-navy-500"}`}>{complete ? "✓" : number}</span>
            <span className="ml-2 text-xs font-semibold text-security-navy-900">{label}</span>
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
    return <p className="rounded-security-lg border border-security-amber-200 bg-security-amber-50 p-4 text-sm text-security-amber-900">Plethora could not confirm a safe repeating schedule from the available history.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-security-emerald-50 px-2.5 py-1 text-xs font-semibold text-security-emerald-700 ring-1 ring-security-emerald-200">Schedule found</span>
        <span className="text-sm text-security-navy-600">Matches {suggestion.confidencePercent}% of recent roster history</span>
      </div>
      <div className="overflow-x-auto rounded-security-lg border border-security-navy-100">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-security-navy-50 text-xs text-security-navy-500"><tr><th className="sticky left-0 bg-security-navy-50 px-3 py-2 text-left">Guard</th>{Array.from({ length: suggestion.pattern.cycleLengthDays }, (_, index) => <th key={index} className="min-w-24 px-2 py-2 text-center">Cycle day {index + 1}</th>)}</tr></thead>
          <tbody className="divide-y divide-security-navy-100">
            {rows.map((row) => <tr key={row.id}><td className="sticky left-0 whitespace-nowrap bg-white px-3 py-2 font-medium">{row.name}</td>{Array.from({ length: suggestion.pattern!.cycleLengthDays }, (_, patternDayIndex) => { const cell = row.cells.find((item) => item.patternDayIndex === patternDayIndex); const code = cell?.shiftCode ?? "blank"; return <td key={patternDayIndex} className="px-2 py-2 text-center"><span className={`inline-flex rounded-lg px-2 py-1 text-xs font-semibold ${code === "D" ? "bg-security-amber-100 text-security-amber-800" : code === "N" ? "bg-indigo-100 text-indigo-800" : "bg-security-navy-50 text-security-navy-600"}`}>{SHIFT_LABELS[code]}</span></td>; })}</tr>)}
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
      <section className="space-y-5 rounded-2xl border border-security-amber-200 bg-white p-4 shadow-security-card sm:p-6">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-security-amber-700">Set up automatic rostering</p><h2 className="mt-1 text-xl font-semibold text-security-navy-900">Review what Plethora found</h2><p className="mt-1 text-sm text-security-navy-600">Nothing will be activated until a user with roster edit access confirms all four steps.</p></div>
        <SetupSteps current={setupStep} />
        {error && <div role="alert" className="rounded-security-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {loadingSuggestion && <div className="h-44 animate-pulse rounded-security-lg bg-security-navy-50" />}
        {suggestion && setupStep === 1 && <div className="space-y-4"><div><h3 className="font-semibold text-security-navy-900">Team at this site</h3><p className="mt-1 text-sm text-security-navy-500">{suggestion.assignedGuards.length} guard{suggestion.assignedGuards.length === 1 ? "" : "s"} included in the suggested roster.</p></div><div className="grid gap-2 sm:grid-cols-2">{suggestion.assignedGuards.map((guard) => <div key={guard.id} className="rounded-security-lg border border-security-navy-100 bg-security-navy-50 px-3 py-2 text-sm font-medium">{guard.name}</div>)}</div>{suggestion.assignedGuards.length === 0 && <Link href={`/sites/${siteId}`} className="btn-primary inline-flex">Add guards to this site</Link>}</div>}
        {suggestion && setupStep === 2 && <div className="space-y-4"><PatternPreview suggestion={suggestion} />{!suggestion.pattern && <div className="flex flex-wrap gap-2"><Link href={`/sites/${siteId}`} className="btn-secondary">Check team assignments</Link>{status.permissions.canUseAdvancedEditor && <Link href={`/rostering/sites/${siteId}/advanced`} className="btn-primary">Build schedule manually</Link>}</div>}</div>}
        {suggestion && setupStep === 3 && <div className="grid gap-4 sm:grid-cols-2"><label className="rounded-security-lg border border-security-navy-100 p-4"><span className="text-sm font-semibold text-security-navy-900">Roster period</span><select value={calendarId} onChange={(event) => setCalendarId(event.target.value)} className="input-modern mt-2 w-full">{suggestion.calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name} ({calendar.startDay}–{calendar.endDay})</option>)}</select><span className="mt-2 block text-xs text-security-navy-500">The schedule will continue using this site calendar.</span></label><label className="rounded-security-lg border border-security-navy-100 p-4"><span className="text-sm font-semibold text-security-navy-900">Start continuing from</span><input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="input-modern mt-2 w-full" /><span className="mt-2 block text-xs text-security-navy-500">Existing published periods remain unchanged.</span></label></div>}
        {suggestion && setupStep === 4 && <div className="space-y-4"><div className="rounded-security-lg border border-security-navy-100 bg-security-navy-50 p-4"><h3 className="font-semibold text-security-navy-900">Ready to activate</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-security-navy-500">Team</dt><dd className="font-medium">{suggestion.assignedGuards.length} guards</dd></div><div><dt className="text-security-navy-500">Roster period</dt><dd className="font-medium">{suggestion.calendars.find((item) => item.id === calendarId)?.name}</dd></div><div><dt className="text-security-navy-500">Starts</dt><dd className="font-medium">{displayDate(effectiveFrom)}</dd></div></dl></div>{suggestion.issues.length > 0 && <div className="rounded-security-lg border border-security-amber-200 bg-security-amber-50 p-4 text-sm text-security-amber-900"><p className="font-semibold">Resolve these items first</p><ul className="mt-2 list-disc space-y-1 pl-5">{suggestion.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul><div className="mt-3 flex flex-wrap gap-2"><Link href={`/sites/${siteId}`} className="btn-secondary">Update team or staffing</Link>{status.permissions.canUseAdvancedEditor && <Link href={`/rostering/sites/${siteId}/advanced`} className="btn-secondary">Edit suggested schedule</Link>}</div></div>}{!status.permissions.canManageBaseline && <p className="rounded-security-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">A user with roster edit access must complete activation.</p>}</div>}
        {suggestion && <div className="flex flex-col-reverse gap-2 border-t border-security-navy-100 pt-4 sm:flex-row sm:items-center sm:justify-between"><button type="button" onClick={() => setSetupStep((step) => Math.max(1, step - 1))} disabled={setupStep === 1 || working} className="btn-secondary disabled:opacity-40">Back</button>{setupStep < 4 ? <button type="button" onClick={() => setSetupStep((step) => Math.min(4, step + 1))} disabled={(setupStep === 1 && suggestion.assignedGuards.length === 0) || (setupStep === 2 && !suggestion.pattern)} className="btn-primary disabled:opacity-50">Continue</button> : <button type="button" onClick={() => void activate()} disabled={!suggestion.canActivate || !status.permissions.canManageBaseline || working} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">{working ? "Starting…" : "Activate automatic rostering"}</button>}</div>}
        {suggestion && <details className="rounded-security-lg border border-security-navy-100 px-3 py-2 text-xs"><summary className="cursor-pointer font-medium text-security-navy-600">Advanced suggestion details</summary><p className="mt-2 text-security-navy-500">{suggestion.pattern ? `${suggestion.pattern.cycleLengthDays}-day repeating cycle inferred from ${displayDate(suggestion.sourcePeriod?.startDate)} to ${displayDate(suggestion.sourcePeriod?.endDate)}.` : suggestion.message}</p></details>}
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {(error || message) && <div role={error ? "alert" : "status"} className={`rounded-security-lg border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-security-emerald-200 bg-security-emerald-50 text-security-emerald-700"}`}>{error ?? message}</div>}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-security-navy-100 bg-white p-4 shadow-security-card"><p className="text-xs text-security-navy-500">Coverage prepared through</p><p className="mt-1 text-lg font-semibold text-security-navy-900">{status.maintainedThrough ? displayDate(status.maintainedThrough) : status.lastStatus === "failed" ? "Update failed" : "Preparing future shifts"}</p></div>
        <div className="rounded-2xl border border-security-navy-100 bg-white p-4 shadow-security-card"><p className="text-xs text-security-navy-500">Normal schedule</p><p className="mt-1 text-lg font-semibold text-security-navy-900">{status.activePattern?.name ?? "No active pattern"}</p><p className="mt-1 text-xs text-security-navy-500">{status.calendar.name} ({status.calendar.startDay}–{status.calendar.endDay})</p></div>
        <div className="rounded-2xl border border-security-navy-100 bg-white p-4 shadow-security-card"><p className="text-xs text-security-navy-500">Items needing attention</p><p className="mt-1 text-lg font-semibold text-security-navy-900">{status.issues.length}</p><p className="mt-1 text-xs text-security-navy-500">Last checked {status.lastReconciledAt ? new Date(status.lastReconciledAt).toLocaleString("en-ZA") : "not yet"}</p></div>
      </section>

      <section className="rounded-2xl border border-security-navy-100 bg-white p-4 shadow-security-card sm:p-5">
        <div><h2 className="text-base font-semibold text-security-navy-900">Common actions</h2><p className="mt-1 text-sm text-security-navy-500">Use a focused action without rebuilding the full roster.</p></div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {status.state === "paused" ? status.permissions.canManageBaseline && <button type="button" onClick={() => void resume()} disabled={working} className="btn-primary">{working ? "Resuming…" : "Resume automatic rostering"}</button> : <>{status.permissions.canManageExceptions && <button type="button" onClick={onOneDayChange} className="btn-primary">Make a one-day change</button>}{status.permissions.canManageBaseline && <><Link href={`/rostering/sites/${siteId}/advanced?mode=ongoing`} className="btn-secondary hidden sm:inline-flex">Change the ongoing schedule</Link><button type="button" onClick={() => void updateNow()} disabled={working} className="btn-secondary">{working ? "Updating…" : "Update roster now"}</button><button type="button" onClick={() => setPauseOpen(true)} className="btn-secondary">Pause automatic rostering</button></>}</>}
        </div>
        {status.state === "paused" && status.pauseReason && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800"><span className="font-semibold">Reason:</span> {status.pauseReason}</p>}
      </section>

      <section className="space-y-3">
        <div><h2 className="text-lg font-semibold text-security-navy-900">What needs attention</h2><p className="text-sm text-security-navy-500">Only the affected shift needs action; the rest of the roster continues normally.</p></div>
        {status.issues.length === 0 ? <div className="rounded-2xl border border-security-emerald-200 bg-security-emerald-50 p-5 text-sm text-security-emerald-700"><p className="font-semibold">No interruptions</p><p className="mt-1">The roster is continuing normally.</p></div> : status.issues.map((issue) => { const canReplace = status.permissions.canManageExceptions && Boolean(issue.metadata?.dateKey && issue.metadata?.shiftType); return <article id={`roster-issue-${issue.id}`} key={issue.id} tabIndex={-1} className="scroll-mt-24 rounded-2xl border border-security-amber-200 bg-security-amber-50/60 p-4 outline-none focus:ring-2 focus:ring-security-amber-400"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-security-amber-950">{issue.title}</h3>{issue.priority === "CRITICAL" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">Urgent</span>}</div><p className="mt-1 text-sm text-security-amber-900">{issue.message}</p></div>{canReplace && <button type="button" onClick={() => void findReplacement(issue)} disabled={working} className="btn-primary shrink-0">Find a replacement</button>}</div></article>; })}
      </section>

      {pauseOpen && (
        <Modal
          open={pauseOpen}
          onClose={() => { if (!working) setPauseOpen(false); }}
          title="Pause automatic rostering"
          description="Future automatic updates stop until a user with roster edit access resumes them. Existing shifts remain unchanged."
          size="sm"
          closeOnBackdrop={!working}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPauseOpen(false)} disabled={working}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={working}
                disabled={!pauseReason.trim()}
                onClick={() => void pause()}
              >
                Pause rostering
              </Button>
            </>
          }
        >
          <Field label="Reason for pausing">
            <Textarea
              value={pauseReason}
              onChange={(event) => setPauseReason(event.target.value)}
              rows={3}
              placeholder="For example: site contract under review"
              autoFocus
            />
          </Field>
        </Modal>
      )}

      <Modal
        open={Boolean(replacementIssue)}
        onClose={() => {
          if (!working) {
            setReplacementIssue(null);
            setReplacements([]);
          }
        }}
        title="Recommended replacements"
        description="Available and eligible guards are ranked with an explanation. The normal roster will not change."
        size="lg"
        closeOnBackdrop={!working}
        footer={
          <Button
            variant="secondary"
            disabled={working}
            onClick={() => {
              setReplacementIssue(null);
              setReplacements([]);
            }}
          >
            Close
          </Button>
        }
      >
        <div className="space-y-3">
          {replacements.length === 0 ? (
            <AlertBanner variant="warning" title="No eligible replacement is available">
              Review site assignments or contact a user with roster approval access.
            </AlertBanner>
          ) : (
            replacements.slice(0, 5).map((replacement, index) => (
              <div
                key={replacement.employeeId}
                className="flex flex-col gap-3 rounded-security-lg border border-security-navy-100 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-security-navy-900">{replacement.name}</p>
                    {index === 0 && <Badge variant="success">Best match</Badge>}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-security-navy-500">
                    {replacement.reasons.join(" · ")}
                  </p>
                </div>
                <Button
                  variant="primary"
                  loading={working}
                  onClick={() => void assignReplacement(replacement.employeeId)}
                  className="shrink-0"
                >
                  Assign and publish
                </Button>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
