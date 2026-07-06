"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type GuardPickerOption = {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber?: string | null;
  psiraNumber?: string | null;
};

function guardName(guard: GuardPickerOption) {
  return `${guard.firstName} ${guard.lastName}`.trim();
}

function guardLabel(guard: GuardPickerOption) {
  const name = guardName(guard);
  if (guard.employeeNumber) return `${name} (${guard.employeeNumber})`;
  if (guard.psiraNumber) return `${name} (${guard.psiraNumber})`;
  return name;
}

function matchesSearch(guard: GuardPickerOption, query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  const haystack = [
    guard.firstName,
    guard.lastName,
    guard.employeeNumber,
    guard.psiraNumber,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

type GuardSearchPickerProps = {
  guards: GuardPickerOption[];
  value: string | null;
  onChange: (guardId: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Shown when value is empty — e.g. the scheduled guard on a timesheet row. */
  defaultGuardId?: string | null;
  allowClear?: boolean;
  clearLabel?: string;
  /** When false, the selected name can wrap instead of truncating (better for wide tables). */
  truncateLabel?: boolean;
  /** Tighter layout for dense tables — removes min-width on the container. */
  compact?: boolean;
};

export function GuardSearchPicker({
  guards,
  value,
  onChange,
  disabled = false,
  placeholder = "Search employee…",
  className = "input-compact",
  defaultGuardId = null,
  allowClear = true,
  clearLabel = "Nobody worked",
  truncateLabel = true,
  compact = false,
}: GuardSearchPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const effectiveId = value || defaultGuardId || "";
  const selected = guards.find((g) => g.id === effectiveId) ?? null;
  const isDefaultOnly = !value && !!defaultGuardId && effectiveId === defaultGuardId;

  const filtered = useMemo(
    () => guards.filter((g) => matchesSearch(g, search)),
    [guards, search]
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    setSearch("");
  }, [open]);

  const displayText = selected ? guardLabel(selected) : placeholder;

  return (
    <div ref={containerRef} className={compact ? "relative min-w-0" : "relative min-w-44"}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`w-full text-left ${className} flex items-center justify-between gap-2 disabled:opacity-50`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className={`min-w-0 ${truncateLabel ? "truncate" : "whitespace-normal break-words leading-snug"} ${!selected ? "text-neutral-500" : ""}`}
          title={truncateLabel ? displayText : undefined}
        >
          {displayText}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isDefaultOnly && selected && (
        <p className="mt-0.5 text-[10px] text-neutral-500">Scheduled guard — change if someone else worked</p>
      )}

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-full min-w-[280px] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-950"
          role="listbox"
        >
          <div className="border-b border-neutral-200 p-2 dark:border-neutral-700">
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or employee no."
              className="input-compact w-full"
              aria-label="Search employees"
            />
          </div>
          <div className="max-h-52 overflow-y-auto p-1">
            {allowClear && (
              <button
                type="button"
                role="option"
                aria-selected={!effectiveId}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className={`w-full rounded px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
                  !effectiveId ? "bg-neutral-100 font-medium dark:bg-neutral-900" : ""
                }`}
              >
                {clearLabel}
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-neutral-500">No employees match your search</p>
            ) : (
              filtered.map((guard) => (
                <button
                  key={guard.id}
                  type="button"
                  role="option"
                  aria-selected={effectiveId === guard.id}
                  onClick={() => {
                    onChange(guard.id);
                    setOpen(false);
                  }}
                  className={`w-full rounded px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
                    effectiveId === guard.id ? "bg-neutral-100 font-medium dark:bg-neutral-900" : ""
                  }`}
                >
                  <div className="truncate">{guardName(guard)}</div>
                  {(guard.employeeNumber || guard.psiraNumber) && (
                    <div className="truncate text-xs text-neutral-500">
                      {guard.employeeNumber ?? guard.psiraNumber}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
