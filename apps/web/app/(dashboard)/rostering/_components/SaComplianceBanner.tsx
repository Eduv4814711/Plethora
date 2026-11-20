"use client";

import { useState } from "react";

export interface SaComplianceBannerProps {
  coveragePercent: number;
  filledSlots: number;
  requiredSlots: number;
  totalOvertimeHours: number;
  restViolationsCount: number;
  credentialWarningsCount: number;
  solverUsed?: "highs_milp" | "heuristic_lns" | "external_http" | null;
  solveDurationMs?: number | null;
  warnings?: Array<{ code?: string; message: string; severity?: string; dateKey?: string }>;
}

export function SaComplianceBanner({
  coveragePercent,
  filledSlots,
  requiredSlots,
  totalOvertimeHours,
  restViolationsCount,
  credentialWarningsCount,
  warnings = [],
}: SaComplianceBannerProps) {
  const [expanded, setExpanded] = useState(false);

  const hasIssues = restViolationsCount > 0 || credentialWarningsCount > 0 || coveragePercent < 100;
  const hasOvertime = totalOvertimeHours > 0;

  const toneClass = hasIssues
    ? "border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
    : "border-emerald-200 bg-emerald-50/80 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100";

  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 text-sm">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              coveragePercent >= 100
                ? "bg-emerald-600 text-white"
                : "bg-amber-600 text-white"
            }`}
          >
            {coveragePercent >= 100 ? "100% Covered" : `${Math.round(coveragePercent)}% Covered (${filledSlots}/${requiredSlots})`}
          </span>

          <span className="inline-flex items-center rounded-full bg-white/80 dark:bg-security-navy-900/70 border border-current/15 px-2.5 py-0.5 text-xs font-medium">
            {hasOvertime ? `${totalOvertimeHours}h Planned Overtime (1.5x)` : "0h Overtime (<=48h/wk)"}
          </span>

          <span className="inline-flex items-center rounded-full bg-white/80 dark:bg-security-navy-900/70 border border-current/15 px-2.5 py-0.5 text-xs font-medium">
            {restViolationsCount === 0
              ? "Rest & Fatigue OK (12h/36h)"
              : `${restViolationsCount} Rest Alert${restViolationsCount === 1 ? "" : "s"}`}
          </span>

          <span className="inline-flex items-center rounded-full bg-white/80 dark:bg-security-navy-900/70 border border-current/15 px-2.5 py-0.5 text-xs font-medium">
            {credentialWarningsCount === 0
              ? "PSIRA Credentials OK"
              : `${credentialWarningsCount} PSIRA Alert${credentialWarningsCount === 1 ? "" : "s"}`}
          </span>
        </div>

        {warnings.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-semibold underline underline-offset-2 opacity-85 hover:opacity-100 min-h-[36px] px-2"
          >
            {expanded ? "Hide details" : `View ${warnings.length} alert${warnings.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>

      {expanded && warnings.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-current/15 pt-2.5 text-xs">
          {warnings.slice(0, 12).map((w, idx) => (
            <li key={`${w.code ?? "w"}-${idx}`} className="flex items-start gap-2">
              <span className="font-semibold shrink-0">{w.dateKey ? `${w.dateKey}:` : "•"}</span>
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
