"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { NAV_ITEMS, canAccessRoute } from "@/lib/permissions";
import {
  MODULE_DESCRIPTIONS,
  MODULE_ICONS,
  MODULE_ICON_FALLBACK,
  MODULE_CATEGORIES,
  MODULE_CATEGORY_ORDER,
  getModuleCategory,
  type ModuleCategoryKey,
} from "@/lib/module-presentation";
import { DASHBOARD_TILE_LIMIT, PINNED_LIMIT, useDashboardModules } from "@/lib/dashboard-modules";
import { TodayWorkList } from "@/components/today-work-list";
import { useDashboardOperationalSummary } from "@/lib/use-dashboard-operational-summary";

interface Tile {
  href: string;
  label: string;
  description?: string;
  category: ModuleCategoryKey;
}

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function ModuleIcon({ href }: { href: string }) {
  return <>{MODULE_ICONS[href] ?? MODULE_ICON_FALLBACK}</>;
}

export default function ModuleLauncher() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const [picking, setPicking] = useState(false);
  const [activeCategory, setActiveCategory] = useState<ModuleCategoryKey | "all">("all");
  const [today, setToday] = useState<Date | null>(null);

  // Read clock after mount for hydration safety
  useEffect(() => setToday(new Date()), []);

  // Shared operational metrics for Today's Actions and contextual module badges
  const operationalSummary = useDashboardOperationalSummary();
  const { moduleStatus, shiftInfo, periodLabel } = operationalSummary;

  useEffect(() => {
    if (!picking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicking(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [picking]);

  const available = useMemo<Tile[]>(() => {
    if (!user) return [];
    return [
      ...(canAccessRoute("/", user) ? [{ href: "/overview", label: "Overview" }] : []),
      ...NAV_ITEMS.filter((item) => item.href !== "/" && canAccessRoute(item.href, user)),
    ].map((tile) => ({
      ...tile,
      description: MODULE_DESCRIPTIONS[tile.href],
      category: getModuleCategory(tile.href),
    }));
  }, [user]);

  const byHref = useMemo(() => new Map(available.map((tile) => [tile.href, tile])), [available]);

  const { shown, hidden, pinned, atLimit, pinsAtLimit, add, remove, togglePin } = useDashboardModules(
    user?.id ?? "anonymous",
    useMemo(() => available.map((tile) => tile.href), [available])
  );

  const firstName = user?.name?.trim().split(/\s+/)[0] ?? "";
  const companyName = settings?.name ?? "Quick Bopha Security";

  const allShownTiles = useMemo(
    () => shown.map((href) => byHref.get(href)).filter((tile): tile is Tile => Boolean(tile)),
    [shown, byHref]
  );

  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);

  // Filtered tiles based on category selection
  const filteredTiles = useMemo(() => {
    if (activeCategory === "all") return allShownTiles;
    return allShownTiles.filter((tile) => tile.category === activeCategory);
  }, [allShownTiles, activeCategory]);

  // Counts per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allShownTiles.length };
    for (const key of MODULE_CATEGORY_ORDER) {
      counts[key] = allShownTiles.filter((t) => t.category === key).length;
    }
    return counts;
  }, [allShownTiles]);

  if (!user) return null;

  const formattedDate = today
    ? today.toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "Operations Duty Board";

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col justify-between max-sm:overflow-y-auto sm:overflow-hidden pb-1 pt-0">
      {/* ── Compact Operational Header ── */}
      <header className="mb-2 shrink-0 flex w-full flex-col justify-between gap-1.5 border-b border-security-navy-100/70 pb-2 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="flex h-2 w-2 rounded-full bg-security-amber-500 animate-pulse" />
            <p className="font-mono text-[0.625rem] sm:text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-security-amber-700">
              Operations Overview · {formattedDate}
            </p>
          </div>
          <h1 className="mt-0.5 flex flex-wrap items-baseline gap-2 font-display text-lg sm:text-xl lg:text-2xl font-bold tracking-tight text-security-navy-900 leading-tight">
            <span>
              {greeting(new Date().getHours())}
              {firstName ? `, ${firstName}` : ""}
            </span>
            <span className="font-sans text-xs sm:text-sm font-normal text-security-navy-500">
              · {companyName}
            </span>
          </h1>
        </div>

        {/* Live operational indicators */}
        <div className="flex flex-wrap items-center gap-1.5 max-sm:pt-1">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-security-navy-200/80 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-security-navy-800 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-security-emerald-500" />
            <span>{shiftInfo.shiftLabel}</span>
            <span className="text-[10px] font-normal text-security-navy-400">({shiftInfo.timeWindow})</span>
          </div>

          {periodLabel && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-security-navy-200/80 bg-white px-2.5 py-0.5 font-mono text-[10px] sm:text-[11px] font-medium text-security-navy-600 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-security-amber-500" />
              <span>{periodLabel}</span>
            </div>
          )}
        </div>
      </header>

      {/* ── Front Door Operations Command Center ── */}
      <TodayWorkList summary={operationalSummary} />

      {/* ── Module Navigation Header & Category Switcher ── */}
      <div className="mb-2 shrink-0 flex w-full flex-wrap items-center justify-between gap-1.5">
        <div>
          <h2 className="font-mono text-[0.625rem] sm:text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-security-navy-700">
            System Modules
          </h2>
        </div>

        {/* Category filter pills */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-security border border-security-navy-200/80 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors",
              activeCategory === "all"
                ? "bg-security-navy-900 text-white shadow-sm"
                : "text-security-navy-600 hover:bg-security-navy-50 hover:text-security-navy-900"
            )}
          >
            <span>All</span>
            <span
              className={clsx(
                "rounded-full px-1.5 py-0.2 text-[10px] tabular-nums",
                activeCategory === "all" ? "bg-white/20 text-white" : "bg-security-navy-100 text-security-navy-700"
              )}
            >
              {categoryCounts.all}
            </span>
          </button>

          {MODULE_CATEGORY_ORDER.map((catKey) => {
            const count = categoryCounts[catKey] ?? 0;
            if (count === 0) return null;
            const catInfo = MODULE_CATEGORIES[catKey];
            const isActive = activeCategory === catKey;

            return (
              <button
                key={catKey}
                type="button"
                onClick={() => setActiveCategory(catKey)}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors",
                  isActive
                    ? "bg-security-navy-900 text-white shadow-sm"
                    : "text-security-navy-600 hover:bg-security-navy-50 hover:text-security-navy-900"
                )}
              >
                <span>{catInfo.label}</span>
                <span
                  className={clsx(
                    "rounded-full px-1.5 py-0.2 text-[10px] tabular-nums",
                    isActive ? "bg-white/20 text-white" : "bg-security-navy-100 text-security-navy-700"
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Empty State ── */}
      {available.length === 0 ? (
        <div className="w-full rounded-security-lg border border-dashed border-security-navy-200 bg-white/60 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-security-navy-900">No modules yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-security-navy-500">
            Nobody has granted you access to a module. Ask your company owner to assign one in Settings → User
            Access.
          </p>
        </div>
      ) : (
        /* ── Enterprise Module Grid ── */
        <div className="grid min-h-0 w-full flex-1 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-4">
          {filteredTiles.map((tile, index) => {
            const isPinned = pinnedSet.has(tile.href);
            const statusBadge = moduleStatus[tile.href];

            return (
              <div
                key={tile.href}
                style={{ animationDelay: `${Math.min(index, 11) * 20}ms` }}
                className="group relative min-h-0 animate-slide-up [animation-fill-mode:backwards] motion-reduce:animate-none"
              >
                <Link
                  href={tile.href}
                  className={clsx(
                    "spine flex h-full min-h-0 flex-col justify-between rounded-security-lg border bg-white p-2.5 sm:p-3 text-security-navy-900 no-underline shadow-security-card transition-all duration-150 hover:-translate-y-0.5 hover:border-security-navy-300 hover:shadow-security-card-hover",
                    isPinned
                      ? "spine-live border-security-amber-200/70"
                      : "spine-idle border-security-navy-100 hover:before:bg-security-navy-300"
                  )}
                >
                  {/* Top row: Icon + Contextual Status Badge */}
                  <div className="flex items-start justify-between gap-1.5">
                    <span className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-security border border-security-navy-100 bg-security-navy-50 text-security-navy-700 transition-colors duration-150 group-hover:border-security-amber-200 group-hover:bg-security-amber-50 group-hover:text-security-amber-600 [&_svg]:h-4 [&_svg]:w-4 sm:[&_svg]:h-5 sm:[&_svg]:w-5">
                      <ModuleIcon href={tile.href} />
                    </span>

                    {/* Contextual Status Badge */}
                    <div className="flex flex-col items-end gap-1">
                      {statusBadge ? (
                        <span
                          className={clsx(
                            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.2 text-[9px] sm:text-[10px] font-bold leading-tight uppercase tracking-wider",
                            statusBadge.variant === "critical"
                              ? "bg-red-50 text-red-700 border border-red-200/70"
                              : statusBadge.variant === "warning"
                              ? "bg-security-amber-50 text-security-amber-800 border border-security-amber-200/70"
                              : statusBadge.variant === "success"
                              ? "bg-security-emerald-50 text-security-emerald-800 border border-security-emerald-200/70"
                              : "bg-security-navy-50 text-security-navy-700 border border-security-navy-100"
                          )}
                        >
                          {statusBadge.variant === "critical" && (
                            <span className="h-1 w-1 rounded-full bg-red-600" />
                          )}
                          {statusBadge.variant === "warning" && (
                            <span className="h-1 w-1 rounded-full bg-security-amber-500" />
                          )}
                          {statusBadge.variant === "success" && (
                            <span className="h-1 w-1 rounded-full bg-security-emerald-500" />
                          )}
                          {statusBadge.label}
                        </span>
                      ) : isPinned ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-security-amber-50 px-1.5 py-0.2 text-[9px] sm:text-[10px] font-semibold text-security-amber-700 border border-security-amber-200/50">
                          Pinned
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Bottom row: Title + Description */}
                  <div className="mt-1.5 min-w-0">
                    <h3 className="truncate font-display text-xs sm:text-[13px] font-semibold tracking-tight text-security-navy-900 group-hover:text-security-navy-950">
                      {tile.label}
                    </h3>
                    {tile.description && (
                      <p className="mt-0.5 line-clamp-1 text-[10px] sm:text-[11px] leading-tight text-security-navy-500 group-hover:text-security-navy-600">
                        {tile.description}
                      </p>
                    )}
                  </div>
                </Link>

                {/* Pin button */}
                <button
                  type="button"
                  onClick={() => togglePin(tile.href)}
                  disabled={!isPinned && pinsAtLimit}
                  aria-pressed={isPinned}
                  aria-label={
                    isPinned
                      ? `Unpin ${tile.label}`
                      : pinsAtLimit
                        ? `Pin ${tile.label} — unpin one first, ${PINNED_LIMIT} is maximum`
                        : `Pin ${tile.label}`
                  }
                  title={
                    isPinned
                      ? `Unpin ${tile.label}`
                      : pinsAtLimit
                        ? `${PINNED_LIMIT} modules are already pinned`
                        : `Pin ${tile.label}`
                  }
                  className={clsx(
                    "absolute right-7 top-2 flex h-5 w-5 items-center justify-center rounded-full border shadow-sm transition",
                    isPinned
                      ? "border-security-amber-200 bg-security-amber-50 text-security-amber-600 opacity-100"
                      : "border-security-navy-200 bg-white text-security-navy-400 hover:border-security-amber-300 hover:bg-security-amber-50 hover:text-security-amber-600 disabled:opacity-30 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  )}
                >
                  <svg
                    className="h-2.5 w-2.5"
                    fill={isPinned ? "currentColor" : "none"}
                    stroke="currentColor"
                    strokeWidth={1.8}
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 4l5 5-2.5 1.2-3.2 3.2-.4 4.1-4.4-4.4-4.5 4.5 4.5-4.5-4.4-4.4 4.1-.4 3.2-3.2L15 4z"
                    />
                  </svg>
                </button>

                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => remove(tile.href)}
                  aria-label={`Remove ${tile.label} from the dashboard`}
                  title={`Remove ${tile.label} from the dashboard`}
                  className="absolute right-1.5 top-2 flex h-5 w-5 items-center justify-center rounded-full border border-security-navy-200 bg-white text-security-navy-400 opacity-0 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <svg
                    className="h-2.5 w-2.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}

          {/* Add Module Card in grid when slots are available */}
          {hidden.length > 0 && !atLimit && activeCategory === "all" && (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="group flex h-full min-h-0 flex-col justify-between rounded-security-lg border-2 border-dashed border-security-navy-200/90 bg-white/40 p-2.5 sm:p-3 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-security-amber-400 hover:bg-security-amber-50/20 hover:shadow-security-card"
            >
              <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-security border border-dashed border-security-navy-300 bg-white text-security-navy-500 transition-colors group-hover:border-security-amber-400 group-hover:bg-security-amber-50 group-hover:text-security-amber-600">
                <svg
                  className="h-4 w-4 sm:h-5 sm:w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <div>
                <h3 className="font-display text-xs sm:text-[13px] font-semibold tracking-tight text-security-navy-900 group-hover:text-security-navy-950">
                  Add module
                </h3>
                <p className="mt-0.5 text-[10px] sm:text-[11px] text-security-navy-500">
                  Customize dashboard launcher
                </p>
              </div>
            </button>
          )}
        </div>
      )}

      {/* ── Polished Dashboard Customization & Status Bar ── */}
      {available.length > 0 && (
        <div className="mt-2 flex w-full max-w-6xl shrink-0 flex-col sm:flex-row items-center justify-between gap-2 rounded-security-lg border border-security-navy-100 bg-white px-3 py-1.5 shadow-security-card">
          <div className="flex items-center gap-1.5">
            <span className="flex h-1.5 w-1.5 rounded-full bg-security-emerald-500" />
            <p className="font-mono text-[10px] sm:text-[11px] text-security-navy-600 font-medium">
              <strong className="text-security-navy-900">{allShownTiles.length}</strong> of{" "}
              {DASHBOARD_TILE_LIMIT} modules active
              {hidden.length > 0 && (
                <>
                  {" · "}
                  <strong className="text-security-navy-900">{hidden.length}</strong> available in library
                </>
              )}
              {` · `}
              <strong className="text-security-navy-900">{pinned.length}</strong> of {PINNED_LIMIT} pinned
            </p>
          </div>

          <div className="flex items-center gap-2">
            {hidden.length > 0 && (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="inline-flex items-center gap-1 rounded-security border border-security-navy-200 bg-security-navy-50 px-2.5 py-1 text-xs font-semibold text-security-navy-800 shadow-sm transition hover:border-security-amber-300 hover:bg-security-amber-50 hover:text-security-amber-700"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
                <span>Add module from library</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Add Module Picker Modal ── */}
      {picking && (
        <div
          className="fixed inset-0 z-[90] flex animate-fade-in items-end justify-center bg-security-navy-950/60 backdrop-blur-[3px] sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add a module to the dashboard"
          onClick={() => setPicking(false)}
        >
          <div
            className="card-elevated max-h-[82vh] w-full max-w-lg animate-slide-up overflow-y-auto rounded-b-none p-5 motion-reduce:animate-none sm:rounded-security-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4 border-b border-security-navy-100 pb-3">
              <div>
                <h2 className="font-display text-base font-bold text-security-navy-900">Module Library</h2>
                <p className="mt-0.5 text-xs text-security-navy-500">
                  {atLimit
                    ? `The dashboard holds ${DASHBOARD_TILE_LIMIT} tiles. Remove one to free a slot.`
                    : `${DASHBOARD_TILE_LIMIT - allShownTiles.length} of ${DASHBOARD_TILE_LIMIT} slots remaining.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPicking(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-security-navy-400 transition-colors hover:bg-security-navy-100 hover:text-security-navy-900"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <ul className="flex flex-col gap-2">
              {hidden.map((href) => {
                const tile = byHref.get(href);
                if (!tile) return null;
                const catInfo = MODULE_CATEGORIES[tile.category];

                return (
                  <li key={href}>
                    <button
                      type="button"
                      disabled={atLimit}
                      onClick={() => {
                        add(href);
                        if (hidden.length <= 1 || allShownTiles.length + 1 >= DASHBOARD_TILE_LIMIT) {
                          setPicking(false);
                        }
                      }}
                      className="spine spine-idle flex w-full items-center gap-3 rounded-security border border-security-navy-100 bg-white p-2.5 text-left transition hover:border-security-amber-200 hover:bg-security-amber-50/50 hover:before:bg-security-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-security bg-security-navy-50 text-security-navy-600 [&_svg]:h-5 [&_svg]:w-5">
                        <ModuleIcon href={href} />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-security-navy-900">{tile.label}</span>
                          <span className="rounded bg-security-navy-100 px-1.5 py-0.2 text-[9px] font-semibold text-security-navy-600">
                            {catInfo?.label ?? "Module"}
                          </span>
                        </div>
                        {tile.description && (
                          <span className="truncate text-xs text-security-navy-500">{tile.description}</span>
                        )}
                      </div>
                      <span className="ml-auto inline-flex items-center rounded-security bg-security-amber-500 px-2.5 py-1 text-xs font-semibold text-security-navy-950 shadow-sm transition hover:bg-security-amber-400">
                        Add
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
