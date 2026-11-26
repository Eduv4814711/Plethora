"use client";

import { useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useDashboardOperationalSummary } from "@/lib/use-dashboard-operational-summary";

interface TodayWorkListProps {
  summary?: ReturnType<typeof useDashboardOperationalSummary>;
}

export function TodayWorkList({ summary: externalSummary }: TodayWorkListProps) {
  const internalSummary = useDashboardOperationalSummary();
  const summary = externalSummary ?? internalSummary;
  const { loading, workItems } = summary;
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className="flex w-full items-center gap-2 rounded-security-lg border border-security-navy-100 bg-white px-4 py-3 text-xs text-security-navy-500">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-security-navy-300 border-t-transparent" />
        <span>Checking today&apos;s operational gates...</span>
      </div>
    );
  }

  const hasMore = workItems.length > 4;
  const visibleItems = expanded ? workItems : workItems.slice(0, 4);

  if (visibleItems.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-security-lg border border-security-navy-100 bg-white px-4 py-3 shadow-security-card">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-security-emerald-50 text-security-emerald-700">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </span>
        <div>
          <p className="text-sm font-semibold text-security-navy-900">
            All operational gates clear for today
          </p>
          <p className="text-xs text-security-navy-500">
            No shift capture delays, export blockers, or coverage gaps requiring attention.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Needs attention today" className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-security-navy-900">
          Needs attention ({workItems.length})
        </h2>
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-xs font-medium text-security-navy-600 transition-colors hover:text-security-navy-900"
          >
            {expanded ? "Show fewer" : `Show all (${workItems.length})`}
          </button>
        )}
      </div>

      <div className="divide-y divide-security-navy-100 overflow-hidden rounded-security-lg border border-security-navy-100 bg-white shadow-security-card">
        {visibleItems.map((item) => {
          const isCritical = item.priority === "CRITICAL";

          return (
            <Link
              key={item.id}
              href={item.href}
              className={clsx(
                "group flex items-center justify-between gap-4 border-l-[3px] px-4 py-3 no-underline transition-colors hover:bg-security-navy-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-security-amber-500",
                isCritical ? "border-l-red-600" : "border-l-security-amber-500"
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={clsx(
                      "text-sm font-semibold tabular-nums",
                      isCritical ? "text-red-900" : "text-security-navy-900"
                    )}
                  >
                    {item.focalCount ?? item.title}
                  </span>
                  <span className="text-xs font-medium text-security-navy-400">
                    {isCritical ? "Critical" : "Attention"}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-security-navy-600">
                  {item.description ?? item.title}
                </p>
              </div>

              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-security-navy-700 transition-colors group-hover:text-security-navy-950">
                <span>{item.verb}</span>
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
