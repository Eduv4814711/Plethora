"use client";

import type { RosterWarning } from "@/lib/roster-api";

export function RosterIssuesPanel({ warnings }: { warnings: RosterWarning[] }) {
  if (!warnings.length) {
    return (
      <div className="rounded-security-lg border border-security-emerald-200 bg-security-emerald-50/60 px-4 py-3 text-sm text-security-emerald-700">
        No validation warnings — roster looks good.
      </div>
    );
  }

  const hard = warnings.filter((w) => w.severity === "hard");
  const advisory = warnings.filter((w) => w.severity === "advisory");

  return (
    <div className="space-y-3">
      {hard.length > 0 && (
        <div className="rounded-security-lg border border-red-300 bg-red-50/80 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-800 mb-2">
            Must fix ({hard.length})
          </p>
          <ul className="space-y-1 text-sm text-red-900">
            {hard.map((w, i) => (
              <li key={`h-${i}`}>• {w.message}</li>
            ))}
          </ul>
        </div>
      )}
      {advisory.length > 0 && (
        <div className="rounded-security-lg border border-security-amber-300 bg-security-amber-50/80 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-security-amber-900 mb-2">
            Advisory ({advisory.length})
          </p>
          <ul className="space-y-1 text-sm text-security-amber-950 max-h-48 overflow-y-auto">
            {advisory.map((w, i) => (
              <li key={`a-${i}`}>• {w.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
