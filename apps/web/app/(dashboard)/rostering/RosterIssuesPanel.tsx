"use client";

import type { RosterWarning } from "@/lib/roster-api";

export function RosterIssuesPanel({ warnings }: { warnings: RosterWarning[] }) {
  if (!warnings.length) {
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
        No validation warnings — roster looks good.
      </div>
    );
  }

  const hard = warnings.filter((w) => w.severity === "hard");
  const advisory = warnings.filter((w) => w.severity === "advisory");

  return (
    <div className="space-y-3">
      {hard.length > 0 && (
        <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50/80 dark:bg-red-950/30 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-800 dark:text-red-200 mb-2">
            Must fix ({hard.length})
          </p>
          <ul className="space-y-1 text-sm text-red-900 dark:text-red-100">
            {hard.map((w, i) => (
              <li key={`h-${i}`}>• {w.message}</li>
            ))}
          </ul>
        </div>
      )}
      {advisory.length > 0 && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200 mb-2">
            Advisory ({advisory.length})
          </p>
          <ul className="space-y-1 text-sm text-amber-950 dark:text-amber-100 max-h-48 overflow-y-auto">
            {advisory.map((w, i) => (
              <li key={`a-${i}`}>• {w.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
