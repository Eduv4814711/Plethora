"use client";

import { clsx } from "clsx";

const TONE: Record<string, string> = {
  draft: "border-neutral-200 bg-neutral-100 text-neutral-700",
  issued: "border-blue-200 bg-blue-50 text-blue-800",
  accepted: "border-emerald-200 bg-emerald-50 text-emerald-800",
  paid: "border-emerald-200 bg-emerald-100 text-emerald-900",
  partially_paid: "border-amber-200 bg-amber-50 text-amber-900",
  overdue: "border-red-200 bg-red-50 text-red-800",
  declined: "border-red-200 bg-red-50 text-red-800",
  expired: "border-neutral-200 bg-neutral-100 text-neutral-600",
  cancelled: "border-neutral-200 bg-neutral-100 text-neutral-500",
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
