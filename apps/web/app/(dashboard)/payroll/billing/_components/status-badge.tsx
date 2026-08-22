"use client";

import { clsx } from "clsx";

const TONE: Record<string, string> = {
  draft: "border-security-navy-100 bg-security-navy-50 text-security-navy-700",
  issued: "border-blue-200 bg-blue-50 text-blue-800",
  accepted: "border-security-emerald-200 bg-security-emerald-50 text-security-emerald-700",
  paid: "border-security-emerald-200 bg-security-emerald-100 text-security-emerald-700",
  partially_paid: "border-security-amber-200 bg-security-amber-50 text-security-amber-900",
  overdue: "border-red-200 bg-red-50 text-red-800",
  declined: "border-red-200 bg-red-50 text-red-800",
  expired: "border-security-navy-100 bg-security-navy-50 text-security-navy-600",
  cancelled: "border-security-navy-100 bg-security-navy-50 text-security-navy-500",
};

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
        TONE[status] ?? TONE.draft
      )}
    >
      {statusLabel(status)}
    </span>
  );
}
