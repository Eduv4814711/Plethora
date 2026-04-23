"use client";

import type { InstructorStatus } from "./types";

const LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
  contract_ended: "Contract Ended",
  archived: "Archived",
};

function tone(status: string): string {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "suspended" || status === "contract_ended") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (status === "inactive") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-slate-300 bg-slate-100 text-slate-700";
}

export function statusLabel(value: string | InstructorStatus | null | undefined): string {
  const key = (value ?? "").toString();
  return LABELS[key] ?? "Inactive";
}

export function InstructorStatusBadge({
  status,
  className = "",
}: {
  status: string | InstructorStatus | null | undefined;
  className?: string;
}) {
  const normalized = (status ?? "inactive").toString();
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tone(normalized)} ${className}`.trim()}
    >
      {statusLabel(normalized)}
    </span>
  );
}
