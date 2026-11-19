"use client";

import { clsx } from "clsx";
import { formatCurrency } from "@/lib/currency";
import type { AgingTotals } from "@/lib/billing-api";

interface AgingSegment {
  label: string;
  key: keyof AgingTotals;
  color: string;
  bgColor: string;
  textColor: string;
  barColor: string;
}

const SEGMENTS: AgingSegment[] = [
  {
    label: "Current",
    key: "current",
    color: "bg-security-emerald-500",
    bgColor: "bg-security-emerald-50",
    textColor: "text-security-emerald-700",
    barColor: "bg-security-emerald-400",
  },
  {
    label: "1–30 days",
    key: "d1_30",
    color: "bg-security-amber-400",
    bgColor: "bg-security-amber-50",
    textColor: "text-security-amber-800",
    barColor: "bg-security-amber-400",
  },
  {
    label: "31–60 days",
    key: "d31_60",
    color: "bg-orange-500",
    bgColor: "bg-orange-50",
    textColor: "text-orange-800",
    barColor: "bg-orange-400",
  },
  {
    label: "61–90 days",
    key: "d61_90",
    color: "bg-red-400",
    bgColor: "bg-red-50",
    textColor: "text-red-700",
    barColor: "bg-red-400",
  },
  {
    label: "90+ days",
    key: "d90_plus",
    color: "bg-red-700",
    bgColor: "bg-red-50",
    textColor: "text-red-800",
    barColor: "bg-red-600",
  },
];

export function AgingBar({
  aging,
  currency,
  className,
}: {
  aging: AgingTotals;
  currency?: string;
  className?: string;
}) {
  const values = SEGMENTS.map((s) => Math.max(0, Number(aging[s.key]) || 0));
  const total = values.reduce((a, b) => a + b, 0);
  const hasData = total > 0;

  return (
    <div className={clsx("space-y-3", className)}>
      {/* Stacked bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-security-navy-100">
        {hasData
          ? SEGMENTS.map((seg, i) => {
              const pct = (values[i] / total) * 100;
              if (pct < 0.5) return null;
              return (
                <div
                  key={seg.key}
                  title={`${seg.label}: ${formatCurrency(values[i], { currency })}`}
                  className={clsx("transition-all duration-500", seg.barColor)}
                  style={{ width: `${pct.toFixed(1)}%` }}
                />
              );
            })
          : null}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {SEGMENTS.map((seg, i) => {
          const val = values[i];
          const pct = total > 0 ? ((val / total) * 100).toFixed(0) : "0";
          return (
            <div
              key={seg.key}
              className={clsx(
                "rounded-security border px-2.5 py-2 transition-colors",
                val > 0
                  ? `${seg.bgColor} border-transparent`
                  : "border-security-navy-100 bg-white"
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={clsx("inline-block h-2 w-2 shrink-0 rounded-full", seg.color)}
                />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-security-navy-500">
                  {seg.label}
                </span>
              </div>
              <p
                className={clsx(
                  "mt-1 font-mono text-sm font-bold tabular-nums",
                  val > 0 ? seg.textColor : "text-security-navy-400"
                )}
              >
                {formatCurrency(val, { currency })}
              </p>
              <p className="text-[10px] text-security-navy-400">{pct}%</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
