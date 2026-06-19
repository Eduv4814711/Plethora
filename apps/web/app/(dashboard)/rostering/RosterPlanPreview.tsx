"use client";

import { Fragment, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";

export type RosterPlanEntry = {
  employeeId: string;
  postId: string;
  startTime: string;
  endTime: string;
  shiftType: "day" | "night";
};

export type RosterPlanWarning = {
  code: string;
  message: string;
  employeeId?: string;
  postId?: string;
  date?: string;
};

export type RosterPlanConflict = {
  employeeId: string;
  date: string;
  reason: string;
};

export type RosterPlanFairnessSpread = {
  maxDayMinusMinDay: number;
  maxNightMinusMinNight: number;
  maxSundayMinusMinSunday: number;
  maxDayNightImbalance?: number;
};

export type RosterReadinessDiagnostic = {
  code: string;
  level: "ok" | "warning" | "error";
  message: string;
};

export type RotationRecommendationSummary = {
  recommendedPatternLabel: string;
  strategy: string;
  reason: string;
  canFullyCover: boolean;
  coreGuardCount: number;
  relieverGuardCount: number;
  warnings: string[];
};

export type RosterPlan = {
  siteId: string;
  startDate: string;
  endDate: string;
  entries: RosterPlanEntry[];
  summary: {
    guardsConsidered: number;
    shiftsPlanned: number;
    postsUsed: number;
    skippedGuardDays: number;
    uncoveredDays?: number;
    fairnessSpread?: RosterPlanFairnessSpread;
    demandSlotsTotal?: number;
    uncoveredSlots?: number;
    coveragePercent?: number;
    relieversUsed?: number;
    rotationPattern?: string;
    rotationRecommendation?: RotationRecommendationSummary;
  };
  readiness?: RosterReadinessDiagnostic[];
  guardStats?: {
    employeeId: string;
    dayCount: number;
    nightCount: number;
    offCount: number;
    sundayCount: number;
    weekendCount: number;
  }[];
  warnings: RosterPlanWarning[];
  conflicts: RosterPlanConflict[];
};

type GuardRef = { id: string; firstName: string; lastName: string };
type PostRef = { id: string; name: string; shiftType?: string | null };

function SummaryCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClasses = {
    neutral: "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/80",
    success: "border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/80 dark:bg-emerald-950/30",
    warning: "border-amber-200 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-950/30",
    danger: "border-red-200 dark:border-red-800/60 bg-red-50/80 dark:bg-red-950/30",
  };
  return (
    <div className={`rounded-xl border p-3 ${toneClasses[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-100 tabular-nums">{value}</p>
    </div>
  );
}

export function RosterPlanPreview({
  plan,
  siteName,
  periodLabel,
  guards,
  posts,
  onCancel,
  onApply,
  applying,
  applyError,
}: {
  plan: RosterPlan;
  siteName: string;
  periodLabel: string;
  guards: GuardRef[];
  posts: PostRef[];
  onCancel: () => void;
  onApply: () => void;
  applying: boolean;
  applyError: string | null;
}) {
  const [expandedGuardId, setExpandedGuardId] = useState<string | null>(null);

  const guardName = (id: string) => {
    const g = guards.find((x) => x.id === id);
    return g ? `${g.firstName} ${g.lastName}` : "Unknown guard";
  };

  const postName = (id: string) => {
    const p = posts.find((x) => x.id === id);
    return p ? p.name : "Post";
  };

  const guardRows = useMemo(() => {
    const byGuard = new Map<
      string,
      { entries: RosterPlanEntry[]; conflicts: RosterPlanConflict[] }
    >();

    for (const g of guards) {
      byGuard.set(g.id, { entries: [], conflicts: [] });
    }

    for (const entry of plan.entries) {
      const row = byGuard.get(entry.employeeId) ?? { entries: [], conflicts: [] };
      row.entries.push(entry);
      byGuard.set(entry.employeeId, row);
    }

    for (const c of plan.conflicts) {
      const row = byGuard.get(c.employeeId) ?? { entries: [], conflicts: [] };
      row.conflicts.push(c);
      byGuard.set(c.employeeId, row);
    }

    return [...byGuard.entries()]
      .filter(([, data]) => data.entries.length > 0 || data.conflicts.length > 0)
      .map(([employeeId, data]) => ({
        employeeId,
        name: guardName(employeeId),
        entries: data.entries.sort(
          (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        ),
        conflicts: data.conflicts.sort((a, b) => a.date.localeCompare(b.date)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [plan.entries, plan.conflicts, guards]);

  const hasSkippedConflicts = plan.conflicts.length > 0;
  const siteLevelConflicts = useMemo(
    () => plan.conflicts.filter((c) => !c.employeeId),
    [plan.conflicts]
  );
  const uncoveredDays = plan.summary.uncoveredDays ?? 0;
  const uncoveredSlots = plan.summary.uncoveredSlots ?? 0;
  const hasUncoveredDays = uncoveredDays > 0;
  const fairness = plan.summary.fairnessSpread;
  const coveragePercent = plan.summary.coveragePercent;
  const relieversUsed = plan.summary.relieversUsed ?? 0;
  const rotationPattern = plan.summary.rotationPattern;
  const rotationRec = plan.summary.rotationRecommendation;
  const canApply = plan.entries.length > 0 && !applying;

  const strategyLabel: Record<string, string> = {
    equal_rotation: "Equal rotation",
    core_with_relievers: "Core + relievers",
    day_only: "Day only",
    night_only: "Night only",
    understaffed: "Understaffed",
    custom: "Custom",
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-neutral-200 dark:border-neutral-700 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Roster plan preview</h3>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {siteName} · {periodLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={applying}
            className="shrink-0 p-2 rounded-[10px] text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 border-2 border-transparent hover:border-neutral-300 dark:hover:border-neutral-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [scrollbar-width:thin] [scrollbar-color:theme(colors.neutral.400)_transparent] dark:[scrollbar-color:theme(colors.neutral.600)_transparent]">
      <div className="px-6 py-4 border-b border-neutral-200/80 dark:border-neutral-700">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryCard
            label="Coverage"
            value={coveragePercent != null ? `${coveragePercent}%` : "—"}
            tone={
              coveragePercent != null && coveragePercent >= 100
                ? "success"
                : coveragePercent != null && coveragePercent < 100
                  ? "warning"
                  : "neutral"
            }
          />
          <SummaryCard label="Guards considered" value={plan.summary.guardsConsidered} />
          <SummaryCard label="Shifts planned" value={plan.summary.shiftsPlanned} tone="success" />
          <SummaryCard
            label="Uncovered slots"
            value={uncoveredSlots}
            tone={uncoveredSlots > 0 ? "danger" : "success"}
          />
          <SummaryCard
            label="Relievers used"
            value={relieversUsed}
            tone={relieversUsed > 0 ? "warning" : "neutral"}
          />
          <SummaryCard
            label="Uncovered days"
            value={uncoveredDays}
            tone={hasUncoveredDays ? "danger" : "success"}
          />
          {rotationPattern ? (
            <SummaryCard label="Rotation pattern" value={rotationPattern} tone="neutral" />
          ) : null}
          {fairness ? (
            <>
              <SummaryCard
                label="Day balance (max-min)"
                value={fairness.maxDayMinusMinDay}
                tone={fairness.maxDayMinusMinDay <= 1 ? "success" : "warning"}
              />
              <SummaryCard
                label="Night balance (max-min)"
                value={fairness.maxNightMinusMinNight}
                tone={fairness.maxNightMinusMinNight <= 2 ? "success" : fairness.maxNightMinusMinNight <= 4 ? "warning" : "danger"}
              />
              {fairness.maxDayNightImbalance != null && (
                <SummaryCard
                  label="Day/night mix (max imbalance)"
                  value={fairness.maxDayNightImbalance}
                  tone={fairness.maxDayNightImbalance <= 2 ? "success" : "warning"}
                />
              )}
              <SummaryCard
                label="Sunday balance (max-min)"
                value={fairness.maxSundayMinusMinSunday}
                tone={fairness.maxSundayMinusMinSunday <= 1 ? "success" : "warning"}
              />
            </>
          ) : (
            <>
              <SummaryCard
                label="Warnings"
                value={plan.warnings.length}
                tone={plan.warnings.length > 0 ? "warning" : "neutral"}
              />
              <SummaryCard
                label="Conflicts"
                value={plan.conflicts.length}
                tone={plan.conflicts.length > 0 ? "danger" : "neutral"}
              />
            </>
          )}
        </div>
        {rotationRec ? (
          <div className="mt-3 rounded-lg border border-blue-200 dark:border-blue-800/60 bg-blue-50/80 dark:bg-blue-950/30 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300 mb-1.5">
              Recommended rotation
            </p>
            <div className="grid gap-2 sm:grid-cols-2 text-xs text-blue-900 dark:text-blue-100">
              <p>
                <span className="font-medium">Pattern:</span>{" "}
                {rotationRec.recommendedPatternLabel || rotationPattern || "—"}
              </p>
              <p>
                <span className="font-medium">Strategy:</span>{" "}
                {strategyLabel[rotationRec.strategy] ?? rotationRec.strategy}
              </p>
              <p>
                <span className="font-medium">Full coverage:</span>{" "}
                {rotationRec.canFullyCover ? "Yes" : "No — add guards or relievers"}
              </p>
              <p>
                <span className="font-medium">Core / relievers:</span>{" "}
                {rotationRec.coreGuardCount} core
                {rotationRec.relieverGuardCount > 0
                  ? ` · ${rotationRec.relieverGuardCount} reliever${rotationRec.relieverGuardCount !== 1 ? "s" : ""}`
                  : " · no reliever pool"}
              </p>
            </div>
            <p className="mt-2 text-xs text-blue-800 dark:text-blue-200">{rotationRec.reason}</p>
            {rotationRec.warnings.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-amber-800 dark:text-amber-200">
                {rotationRec.warnings.map((w, i) => (
                  <li key={`rot-warn-${i}`}>• {w}</li>
                ))}
              </ul>
            )}
          </div>
        ) : rotationPattern ? (
          <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
            Rotation pattern: <span className="font-medium">{rotationPattern}</span>
          </p>
        ) : null}
        {coveragePercent != null && coveragePercent < 100 && (
          <p className="mt-3 text-xs text-amber-800 dark:text-amber-200 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
            Coverage is below 100%. See uncovered slots below for per-guard blocking reasons (rest, gender,
            overlap, or staffing rules).
          </p>
        )}
        {hasUncoveredDays && (
          <p className="mt-3 text-xs font-medium text-red-700 dark:text-red-300 rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-3 py-2">
            {uncoveredDays} day{uncoveredDays !== 1 ? "s are" : " is"} missing day or night coverage. You can still
            apply the {plan.entries.length} planned shift{plan.entries.length !== 1 ? "s" : ""}, but gaps will remain
            until you add guards or adjust site rules.
          </p>
        )}
        {siteLevelConflicts.length > 0 && (
          <div className="mt-3 rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50/80 dark:bg-red-950/30 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-700 dark:text-red-300 mb-1.5">
              Uncovered slots ({siteLevelConflicts.length})
            </p>
            <ul className="space-y-1 text-xs text-red-800 dark:text-red-200 max-h-28 overflow-y-auto [scrollbar-width:thin]">
              {siteLevelConflicts.slice(0, 12).map((c, i) => (
                <li key={`${c.date}-${i}`}>
                  {format(parseISO(`${c.date}T12:00:00`), "d MMM yyyy")}: {c.reason}
                </li>
              ))}
              {siteLevelConflicts.length > 12 && (
                <li className="text-red-600 dark:text-red-400">
                  …and {siteLevelConflicts.length - 12} more
                </li>
              )}
            </ul>
          </div>
        )}
        {(plan.readiness?.length ?? 0) > 0 && (
          <div className="mt-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50/80 dark:bg-neutral-900/50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400 mb-1.5">
              Site readiness
            </p>
            <ul className="space-y-1 text-xs">
              {plan.readiness!.map((d, i) => (
                <li
                  key={`${d.code}-${i}`}
                  className={
                    d.level === "error"
                      ? "text-red-800 dark:text-red-200"
                      : d.level === "warning"
                        ? "text-amber-800 dark:text-amber-200"
                        : "text-neutral-600 dark:text-neutral-400"
                  }
                >
                  • {d.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {plan.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-amber-800 dark:text-amber-200">
            {plan.warnings.map((w, i) => (
              <li
                key={`${w.code}-${w.date ?? ""}-${i}`}
                className={
                  w.code === "UNCOVERED_DAY"
                    ? "font-medium text-red-800 dark:text-red-200"
                    : ""
                }
              >
                • {w.message}
              </li>
            ))}
          </ul>
        )}
        {hasSkippedConflicts && !hasUncoveredDays && (
          <p className="mt-3 text-xs text-red-700 dark:text-red-300">
            {plan.conflicts.length} slot{plan.conflicts.length !== 1 ? "s were" : " was"} skipped due to conflicts.
            You can still apply the {plan.entries.length} planned shift{plan.entries.length !== 1 ? "s" : ""}.
          </p>
        )}
      </div>

      <div className="px-6 py-4">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-700">
              <th className="py-2 pr-3 font-semibold w-[40%]">Guard</th>
              <th className="py-2 pr-3 font-semibold">Shifts</th>
              <th className="py-2 font-semibold w-16" />
            </tr>
          </thead>
          <tbody>
            {guardRows.map((row) => {
              const expanded = expandedGuardId === row.employeeId;
              const hasConflict = row.conflicts.length > 0;
              return (
                <Fragment key={row.employeeId}>
                  <tr
                    className={`border-b border-neutral-100 dark:border-neutral-800 ${
                      hasConflict ? "bg-red-50/50 dark:bg-red-950/20" : ""
                    }`}
                  >
                    <td className="py-2.5 pr-3 font-medium text-neutral-900 dark:text-neutral-100">
                      {row.name}
                      {hasConflict && (
                        <span className="ml-2 text-[10px] font-semibold uppercase text-red-600 dark:text-red-400">
                          {row.conflicts.length} conflict{row.conflicts.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-neutral-600 dark:text-neutral-400 tabular-nums">
                      {row.entries.length} planned
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedGuardId(expanded ? null : row.employeeId)
                        }
                        className="text-xs font-medium text-orange-700 dark:text-orange-300 hover:underline"
                      >
                        {expanded ? "Hide" : "Details"}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr key={`${row.employeeId}-detail`} className="border-b border-neutral-100 dark:border-neutral-800">
                      <td colSpan={3} className="py-3 pl-2">
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {row.entries.map((e) => (
                            <span
                              key={`${e.postId}-${e.startTime}`}
                              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium border ${
                                e.shiftType === "night"
                                  ? "border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200"
                                  : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                              }`}
                            >
                              {format(parseISO(e.startTime), "d MMM")} · {postName(e.postId)} ({e.shiftType})
                            </span>
                          ))}
                        </div>
                        {row.conflicts.length > 0 && (
                          <ul className="space-y-1 text-xs text-red-700 dark:text-red-300">
                            {row.conflicts.map((c, i) => (
                              <li key={`${c.date}-${i}`}>
                                {format(parseISO(`${c.date}T12:00:00`), "d MMM yyyy")}: {c.reason}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {guardRows.length === 0 && (
              <tr>
                <td colSpan={3} className="py-8 text-center text-sm text-neutral-500">
                  No shifts in this plan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>

      <div className="shrink-0 border-t border-neutral-200 dark:border-neutral-700 px-6 py-4 space-y-3">
        {applyError && (
          <p className="text-xs text-red-700 dark:text-red-300 rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-3 py-2">
            {applyError}
          </p>
        )}
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Applying replaces existing created/assigned shifts on this site for the selected period, then creates the
          planned shifts.
        </p>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} disabled={applying} className="flex-1 btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!canApply}
            className={`flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed ${
              hasUncoveredDays ? "ring-2 ring-amber-400/60 dark:ring-amber-600/50" : ""
            }`}
          >
            {applying
              ? "Applying…"
              : hasUncoveredDays
                ? `Apply partial roster (${plan.entries.length})`
                : `Apply roster (${plan.entries.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
