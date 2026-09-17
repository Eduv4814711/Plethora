"use client";

import { clsx } from "clsx";

/** AR risk based on the worst aging bucket with a balance. */
export type ArRisk = "current" | "low" | "medium" | "high" | "critical";

export function computeArRisk(aging: {
  current: string | number;
  d1_30: string | number;
  d31_60: string | number;
  d61_90: string | number;
  d90_plus: string | number;
}): ArRisk {
  const d90 = Number(aging.d90_plus) || 0;
  const d61 = Number(aging.d61_90) || 0;
  const d31 = Number(aging.d31_60) || 0;
  const d1 = Number(aging.d1_30) || 0;
  if (d90 > 0) return "critical";
  if (d61 > 0) return "high";
  if (d31 > 0) return "medium";
  if (d1 > 0) return "low";
  return "current";
}

const RISK_STYLE: Record<ArRisk, { badge: string; dot: string; label: string }> = {
  current: {
    badge: "bg-security-emerald-50 text-security-emerald-700 border-security-emerald-200",
    dot: "bg-security-emerald-500",
    label: "Current",
  },
  low: {
    badge: "bg-security-amber-50 text-security-amber-800 border-security-amber-200",
    dot: "bg-security-amber-400",
    label: "1–30 days",
  },
  medium: {
    badge: "bg-orange-50 text-orange-800 border-orange-200",
    dot: "bg-orange-500",
    label: "31–60 days",
  },
  high: {
    badge: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-500",
    label: "61–90 days",
  },
  critical: {
    badge: "bg-red-50 text-red-800 border-red-200",
    dot: "bg-red-700 animate-pulse",
    label: "90+ days",
  },
};

export function ArRiskBadge({ risk }: { risk: ArRisk }) {
  const style = RISK_STYLE[risk];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
        style.badge
      )}
    >
      <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", style.dot)} />
      {style.label}
    </span>
  );
}
