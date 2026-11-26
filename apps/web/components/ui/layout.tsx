"use client";

import Link from "next/link";
import { clsx } from "clsx";

type PageWidth = "narrow" | "default" | "wide" | "full";

const pageWidths: Record<PageWidth, string> = {
  narrow: "max-w-4xl",
  default: "max-w-6xl",
  wide: "max-w-7xl",
  full: "max-w-none",
};

/**
 * Standard outer container for all dashboard module pages.
 * Keeps max-width and vertical rhythm coherent across every feature.
 */
export function PageShell({
  width = "default",
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx("mx-auto flex w-full flex-col gap-6", pageWidths[width], className)}>
      {children}
    </div>
  );
}

/**
 * Standard content section with a sentence-case heading and optional right-hand action.
 */
export function Section({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={clsx("space-y-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold text-security-navy-900">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-security-navy-500">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export interface KpiItem {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  href?: string;
  tone?: "default" | "success" | "warning" | "danger";
}

const kpiToneValue: Record<NonNullable<KpiItem["tone"]>, string> = {
  default: "text-security-navy-950",
  success: "text-security-emerald-700",
  warning: "text-security-amber-700",
  danger: "text-red-700",
};

/**
 * Unified 2-to-4 column horizontal KPI strip separated by 1px hairline dividers.
 */
export function KpiStrip({
  items,
  ariaLabel = "Key metrics",
  className,
}: {
  items: readonly KpiItem[];
  ariaLabel?: string;
  className?: string;
}) {
  const gridCols =
    items.length <= 2
      ? "sm:grid-cols-2"
      : items.length === 3
        ? "sm:grid-cols-3"
        : "sm:grid-cols-4";

  return (
    <section
      aria-label={ariaLabel}
      className={clsx(
        "grid grid-cols-2 divide-y divide-security-navy-100 overflow-hidden rounded-security-lg border border-security-navy-100 bg-white shadow-security-card sm:divide-x sm:divide-y-0",
        gridCols,
        className
      )}
    >
      {items.map((item) => {
        const valueEl = (
          <p
            className={clsx(
              "mt-1 font-display text-xl font-bold tabular-nums",
              kpiToneValue[item.tone ?? "default"]
            )}
          >
            {item.value}
          </p>
        );

        return (
          <div key={item.label} className="px-4 py-3.5">
            <p className="text-xs font-medium text-security-navy-500">{item.label}</p>
            {item.href ? (
              <Link
                href={item.href}
                className="inline-block no-underline transition-opacity hover:opacity-80"
              >
                {valueEl}
              </Link>
            ) : (
              valueEl
            )}
            {item.sublabel ? (
              <p className="mt-0.5 text-xs tabular-nums text-security-navy-500">{item.sublabel}</p>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

/**
 * Standardized search input with inline icon and optional clear button.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  ariaLabel,
  density = "compact",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  density?: "default" | "compact";
  className?: string;
}) {
  return (
    <div className={clsx("relative", className)}>
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-security-navy-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={clsx(
          density === "compact" ? "input-compact" : "input-modern",
          "pl-8 pr-8 [&::-webkit-search-cancel-button]:appearance-none"
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-security-navy-400 hover:bg-security-navy-100 hover:text-security-navy-700"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
