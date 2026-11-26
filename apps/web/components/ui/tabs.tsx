"use client";

import Link from "next/link";
import { useRef } from "react";
import { clsx } from "clsx";

export interface TabOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
}

export interface SubNavItem {
  href: string;
  label: string;
  exact?: boolean;
}

/**
 * Route-based sub-navigation bar (`<nav>` + `<Link>`), using a 2px bottom
 * indicator on the active route per WCAG 1.4.1. Never uses `role="tablist"`
 * since items navigate between Next.js routes.
 */
export function SubNav({
  items,
  pathname,
  ariaLabel,
  className,
}: {
  items: readonly SubNavItem[];
  pathname: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={clsx(
        "flex items-center gap-5 overflow-x-auto border-b border-security-navy-100",
        className
      )}
    >
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "relative inline-flex shrink-0 items-center whitespace-nowrap pb-2.5 text-sm no-underline transition-colors",
              active
                ? "font-semibold text-security-navy-950 after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-security-amber-500"
                : "font-medium text-security-navy-500 hover:text-security-navy-800"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Accessible horizontal tablist with keyboard arrow navigation and a non-color
 * shape indicator (2px bottom border) per WCAG 1.4.1.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  variant = "underline",
  className,
}: {
  items: readonly TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  variant?: "underline" | "segmented";
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = items.findIndex((item) => item.value === value);
    if (idx < 0) return;

    let nextIdx = idx;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = items.length - 1;
    else return;

    e.preventDefault();
    const nextItem = items[nextIdx];
    if (!nextItem) return;
    onChange(nextItem.value);
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[nextIdx]?.focus();
  };

  if (variant === "segmented") {
    return (
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        className={clsx(
          "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-security border border-security-navy-200 bg-security-navy-50/80 p-1",
          className
        )}
      >
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.value)}
              className={clsx(
                "inline-flex shrink-0 items-center gap-1.5 rounded-[0.375rem] px-3 py-1.5 text-xs font-semibold transition-colors",
                selected
                  ? "bg-white text-security-navy-950 shadow-security-card ring-1 ring-security-navy-200/80"
                  : "text-security-navy-600 hover:text-security-navy-900"
              )}
            >
              <span>{item.label}</span>
              {typeof item.count === "number" ? (
                <span className="tabular-nums text-[11px] text-security-navy-500">
                  {item.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={clsx(
        "flex items-center gap-5 overflow-x-auto border-b border-security-navy-100",
        className
      )}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={clsx(
              "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap pb-2.5 text-sm transition-colors",
              selected
                ? "font-semibold text-security-navy-950 after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-security-amber-500"
                : "font-medium text-security-navy-500 hover:text-security-navy-800"
            )}
          >
            <span>{item.label}</span>
            {typeof item.count === "number" ? (
              <span
                className={clsx(
                  "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums leading-none",
                  selected
                    ? "bg-security-navy-900 text-white"
                    : "bg-security-navy-100 text-security-navy-600"
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
