"use client";

import Link from "next/link";
import { clsx } from "clsx";
import {
  useDashboardOperationalSummary,
} from "@/lib/use-dashboard-operational-summary";

interface TodayWorkListProps {
  summary?: ReturnType<typeof useDashboardOperationalSummary>;
}

export function TodayWorkList({ summary: externalSummary }: TodayWorkListProps) {
  const internalSummary = useDashboardOperationalSummary();
  const summary = externalSummary ?? internalSummary;
  const { loading, workItems, periodLabel, shiftInfo } = summary;

  if (loading) {
    return (
      <div className="mb-2 flex w-full max-w-6xl items-center justify-center py-1">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-security-navy-300 border-t-transparent" />
      </div>
    );
  }

  // Cap the list at 4 items for tight layout harmony
  const visibleItems = workItems.slice(0, 4);

  // Quiet day: when nothing needs action
  if (visibleItems.length === 0) {
    return (
      <div className="mb-2 sm:mb-2.5 w-full max-w-6xl shrink-0 animate-fade-in rounded-security-lg border border-security-emerald-200/80 bg-gradient-to-r from-security-emerald-50/70 to-white px-3 py-1.5 sm:px-4 sm:py-2 shadow-security-card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-security-emerald-100 text-security-emerald-700">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <div>
              <p className="text-xs font-semibold text-security-navy-900 leading-tight">
                All operational gates clear for today
              </p>
              <p className="text-[10px] text-security-navy-500 leading-tight">
                No shift capture delays, payroll blockers, or coverage gaps requiring attention.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 max-sm:pl-8">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-security-navy-600 border border-security-navy-100 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-security-emerald-500" />
              {shiftInfo.shiftLabel}
            </span>
            {periodLabel && (
              <span className="text-[10px] font-medium text-security-navy-500">
                {periodLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  const criticalCount = workItems.filter((i) => i.priority === "CRITICAL").length;
  const attentionCount = workItems.filter((i) => i.priority !== "CRITICAL").length;

  return (
    <div className="mb-2 sm:mb-2.5 w-full max-w-6xl shrink-0 animate-slide-up rounded-security-lg border border-security-navy-100/90 bg-white p-2.5 sm:p-3 shadow-security-card">
      {/* Command Center Header */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5 border-b border-security-navy-50 pb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className={clsx(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
              criticalCount > 0 ? "bg-red-400" : "bg-security-amber-400"
            )} />
            <span className={clsx(
              "relative inline-flex h-2 w-2 rounded-full",
              criticalCount > 0 ? "bg-red-500" : "bg-security-amber-500"
            )} />
          </span>

          <h2 className="font-mono text-[0.625rem] sm:text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-security-navy-900">
            Operations Command Center
          </h2>

          <div className="flex items-center gap-1 ml-1">
            <span className="rounded-full bg-security-navy-100 px-1.5 py-0.2 font-mono text-[9px] sm:text-[10px] font-bold text-security-navy-700 tabular-nums">
              {workItems.length} {workItems.length === 1 ? "action" : "actions"}
            </span>

            {criticalCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100/90 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider text-red-800">
                <span className="h-1 w-1 rounded-full bg-red-600" />
                {criticalCount} Critical
              </span>
            )}

            {attentionCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-security-amber-100/80 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider text-security-amber-900">
                <span className="h-1 w-1 rounded-full bg-security-amber-500" />
                {attentionCount} Attention
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-security-navy-500">
          <span className="hidden sm:inline-flex items-center gap-1 rounded bg-security-navy-50 px-2 py-0.5 font-medium text-security-navy-600">
            {shiftInfo.shiftLabel}
          </span>
          {periodLabel && (
            <span className="font-medium text-security-navy-600">
              {periodLabel}
            </span>
          )}
        </div>
      </div>

      {/* Grid of Actionable Items with focal numbers */}
      <div className="grid gap-2 sm:grid-cols-2">
        {visibleItems.map((item) => {
          const isCritical = item.priority === "CRITICAL";

          return (
            <div
              key={item.id}
              className={clsx(
                "group relative flex items-center justify-between gap-2.5 rounded-security border p-2 sm:p-2.5 transition-all duration-150 hover:shadow-sm",
                isCritical
                  ? "border-red-200/90 bg-red-50/35 hover:bg-red-50/60"
                  : "border-security-amber-200/80 bg-security-amber-50/25 hover:bg-security-amber-50/50"
              )}
            >
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <span
                  className={clsx(
                    "mt-0.5 flex h-6 w-6 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-security",
                    isCritical
                      ? "bg-red-100 text-red-700"
                      : "bg-security-amber-100 text-security-amber-800"
                  )}
                  aria-hidden
                >
                  {isCritical ? (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.002z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75h.007v.008H12v-.008z" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className={clsx(
                      "font-display text-sm sm:text-[15px] font-bold tracking-tight leading-none",
                      isCritical ? "text-red-950" : "text-security-navy-950"
                    )}>
                      {item.focalCount ?? item.title}
                    </span>
                    <span
                      className={clsx(
                        "rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider",
                        isCritical
                          ? "bg-red-100/90 text-red-800"
                          : "bg-security-amber-100/90 text-security-amber-900"
                      )}
                    >
                      {isCritical ? "Critical" : "Attention"}
                    </span>
                  </div>

                  <p className="mt-0.5 line-clamp-1 text-[11px] text-security-navy-600 font-medium leading-tight">
                    {item.description ?? item.title}
                  </p>
                </div>
              </div>

              <Link
                href={item.href}
                className={clsx(
                  "inline-flex shrink-0 items-center justify-center gap-1 rounded-security px-2.5 py-1 text-xs font-semibold shadow-sm transition hover:shadow active:scale-[0.98]",
                  isCritical
                    ? "bg-red-700 text-white hover:bg-red-800"
                    : "bg-security-amber-500 text-security-navy-950 hover:bg-security-amber-400"
                )}
              >
                <span>{item.verb}</span>
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
