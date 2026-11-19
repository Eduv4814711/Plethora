"use client";

import { clsx } from "clsx";

export interface BillingKpiCardProps {
  label: string;
  value: string;
  sub?: string;
  /** Color variant drives spine + accent colors */
  variant?: "default" | "success" | "warning" | "danger" | "info";
  /** Optional numeric badge (e.g. count) shown in top-right corner */
  badge?: number | string;
  /** Optional trend label (+X% vs last month, etc.) */
  trend?: string;
  trendUp?: boolean;
  icon?: React.ReactNode;
  /** Click handler to make the card interactive */
  onClick?: () => void;
}

const SPINE: Record<string, string> = {
  default: "before:bg-[var(--border-medium)]",
  success: "before:bg-[var(--accent-emerald)]",
  warning: "before:bg-[var(--accent-amber)]",
  danger: "before:bg-[var(--accent-red)]",
  info: "before:bg-blue-400",
};

const BADGE_COLOR: Record<string, string> = {
  default: "bg-security-navy-100 text-security-navy-700",
  success: "bg-security-emerald-50 text-security-emerald-700",
  warning: "bg-security-amber-50 text-security-amber-900",
  danger: "bg-red-50 text-red-800",
  info: "bg-blue-50 text-blue-700",
};

const VALUE_COLOR: Record<string, string> = {
  default: "text-security-navy-900",
  success: "text-security-emerald-700",
  warning: "text-security-amber-900",
  danger: "text-red-700",
  info: "text-blue-700",
};

export function BillingKpiCard({
  label,
  value,
  sub,
  variant = "default",
  badge,
  trend,
  trendUp,
  icon,
  onClick,
}: BillingKpiCardProps) {
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={clsx(
        "spine relative flex w-full flex-col gap-3 rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card transition-all duration-200",
        SPINE[variant],
        onClick && "cursor-pointer hover:border-security-navy-200 hover:shadow-security-card-hover active:scale-[0.99]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon && (
            <span className="text-security-navy-500">{icon}</span>
          )}
          <p className="section-title">{label}</p>
        </div>
        {badge !== undefined && (
          <span
            className={clsx(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
              BADGE_COLOR[variant]
            )}
          >
            {badge}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <p
          className={clsx(
            "font-mono text-2xl font-bold tabular-nums tracking-tight",
            VALUE_COLOR[variant]
          )}
        >
          {value}
        </p>
        {(sub || trend) && (
          <div className="flex flex-wrap items-center gap-2">
            {sub && (
              <p className="text-xs text-security-navy-500">{sub}</p>
            )}
            {trend && (
              <span
                className={clsx(
                  "inline-flex items-center gap-0.5 text-[10px] font-semibold",
                  trendUp === true && "text-security-emerald-600",
                  trendUp === false && "text-red-600",
                  trendUp === undefined && "text-security-navy-500"
                )}
              >
                {trendUp === true && "↑"}
                {trendUp === false && "↓"}
                {trend}
              </span>
            )}
          </div>
        )}
      </div>
    </Tag>
  );
}
