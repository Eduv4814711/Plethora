"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { NAV_ITEMS, canAccessRoute } from "@/lib/permissions";
import { MODULE_DESCRIPTIONS, MODULE_ICONS, MODULE_ICON_FALLBACK } from "@/lib/module-presentation";
import { DASHBOARD_TILE_LIMIT, PINNED_LIMIT, useDashboardModules } from "@/lib/dashboard-modules";

interface Tile {
  href: string;
  label: string;
  description?: string;
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
  // Read the clock after mount: the server renders in its own timezone, so
  // rendering a date during SSR would hydrate against a different day.
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);

  useEffect(() => {
    if (!picking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicking(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [picking]);

  // DashboardLayout renders nothing until the user resolves, so the null user is
  // only a type guard rather than a state we actually paint. useMemo still has to
  // run above it to keep the hook order stable.
  const available = useMemo<Tile[]>(() => {
    if (!user) return [];
    return [
      // `/` is the launcher itself; its charts live at /overview, which resolves
      // back to the `/` module for access purposes (see lib/permissions.ts).
      ...(canAccessRoute("/", user) ? [{ href: "/overview", label: "Overview" }] : []),
      ...NAV_ITEMS.filter((item) => item.href !== "/" && canAccessRoute(item.href, user)),
    ].map((tile) => ({ ...tile, description: MODULE_DESCRIPTIONS[tile.href] }));
  }, [user]);

  const byHref = useMemo(() => new Map(available.map((tile) => [tile.href, tile])), [available]);

  const { shown, hidden, pinned, atLimit, pinsAtLimit, add, remove, togglePin } = useDashboardModules(
    user?.id ?? "anonymous",
    useMemo(() => available.map((tile) => tile.href), [available])
  );

  if (!user) return null;

  const firstName = user.name?.trim().split(/\s+/)[0] ?? "";
  const tiles = shown.map((href) => byHref.get(href)).filter((tile): tile is Tile => Boolean(tile));
  const pinnedSet = new Set(pinned);

  return (
    // The launcher owns exactly the height DashboardLayout gives it and never
    // scrolls: the grid takes the leftover space and the tiles divide it, so the
    // whole module set stays on one screen at any window size.
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col items-center overflow-hidden">
      <header className="flex shrink-0 flex-col items-center text-center">
        {/* Eight rows of tiles need every pixel on a phone, so the date and the
            strapline are desktop-only trim. */}
        <p className="eyebrow max-sm:hidden [@media(max-height:700px)]:hidden">
          {today
            ? today.toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : " "}
        </p>
        <h1 className="page-title mt-2 text-xl sm:text-2xl lg:text-3xl [@media(max-height:700px)]:mt-0 [@media(max-height:700px)]:text-lg">
          {greeting(new Date().getHours())}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1.5 text-sm text-security-navy-500 max-sm:hidden [@media(max-height:620px)]:hidden">
          {settings?.name ? `${settings.name} — pick up where you left off` : "Pick a module to get started"}
        </p>
        <span className="mb-5 mt-4 h-0.5 w-10 rounded-full bg-security-amber-500 max-sm:my-2 [@media(max-height:700px)]:my-3" />
      </header>

      {available.length === 0 ? (
        <div className="w-full rounded-security-lg border border-dashed border-security-navy-200 bg-white/60 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-security-navy-900">No modules yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-security-navy-500">
            Nobody has granted you access to a module. Ask your company owner to assign one in Settings → User
            Access.
          </p>
        </div>
      ) : (
        // 16 tiles (or 15 plus the "Add" cell) always fill these tracks exactly:
        // 2x8 on phones, 3x6 on tablets, 4x4 on desktop.
        <div className="grid min-h-0 w-full flex-1 grid-cols-2 grid-rows-8 gap-2 sm:grid-cols-3 sm:grid-rows-6 sm:gap-3 lg:grid-cols-4 lg:grid-rows-4">
          {tiles.map((tile, index) => {
            const isPinned = pinnedSet.has(tile.href);
            return (
              <div
                key={tile.href}
                // Staggered entrance, capped so the last tile never feels late.
                style={{ animationDelay: `${Math.min(index, 11) * 30}ms` }}
                className="group relative min-h-0 animate-slide-up [animation-fill-mode:backwards] motion-reduce:animate-none"
              >
                <Link
                  href={tile.href}
                  className={clsx(
                    "spine flex h-full min-h-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-security-lg border border-security-navy-100 bg-white px-2 py-1 text-center text-security-navy-900 no-underline shadow-security-card transition-all duration-200 hover:-translate-y-0.5 hover:border-security-navy-200 hover:shadow-security-card-hover sm:gap-2.5 sm:px-3 sm:py-3",
                    // The spine does the pinning rather than an extra box, so
                    // the one-screen grid keeps its exact geometry either way —
                    // and a pinned tile is marked in the same vocabulary as a
                    // live shift or the active module in the rail.
                    isPinned ? "spine-live" : "spine-idle before:bg-transparent hover:before:bg-security-navy-200"
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-security-lg bg-security-navy-50 text-security-navy-500 transition-colors duration-200 group-hover:bg-security-amber-50 group-hover:text-security-amber-600 sm:h-12 sm:w-12 lg:h-14 lg:w-14 [&_svg]:h-4 [&_svg]:w-4 sm:[&_svg]:h-6 sm:[&_svg]:w-6">
                    <ModuleIcon href={tile.href} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[0.65rem] font-semibold leading-tight sm:text-sm lg:text-[0.95rem]">
                      {tile.label}
                    </span>
                    {tile.description && (
                      // First to go when height is tight — the label alone still
                      // identifies the module.
                      <span className="line-clamp-2 text-[0.7rem] leading-snug text-security-navy-500 max-sm:hidden sm:text-xs [@media(max-height:760px)]:hidden">
                        {tile.description}
                      </span>
                    )}
                  </span>
                </Link>
                {/* Siblings of the Link, not children: a button inside an anchor
                    is invalid markup and swallows the tile's own activation. */}
                <button
                  type="button"
                  onClick={() => togglePin(tile.href)}
                  disabled={!isPinned && pinsAtLimit}
                  aria-pressed={isPinned}
                  aria-label={
                    isPinned
                      ? `Unpin ${tile.label}`
                      : pinsAtLimit
                        ? `Pin ${tile.label} — unpin one first, ${PINNED_LIMIT} is the maximum`
                        : `Pin ${tile.label}`
                  }
                  title={
                    isPinned
                      ? `Unpin ${tile.label}`
                      : pinsAtLimit
                        ? `${PINNED_LIMIT} modules are already pinned — unpin one first`
                        : `Pin ${tile.label}`
                  }
                  className={clsx(
                    "absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full border shadow-security-card transition",
                    isPinned
                      ? "border-security-amber-200 bg-security-amber-50 text-security-amber-600 opacity-100"
                      : // Muted rather than faded: opacity stays owned by the
                        // hover-reveal below, so disabled pins do not linger on
                        // every unpinned tile.
                        "border-security-navy-200 bg-white text-security-navy-400 hover:border-security-amber-300 hover:bg-security-amber-50 hover:text-security-amber-600 disabled:cursor-not-allowed disabled:border-security-navy-100 disabled:bg-white disabled:text-security-navy-200 disabled:hover:border-security-navy-100 disabled:hover:bg-white disabled:hover:text-security-navy-200 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  )}
                >
                  <svg
                    className="h-3.5 w-3.5"
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
                <button
                  type="button"
                  onClick={() => remove(tile.href)}
                  aria-label={`Remove ${tile.label} from the dashboard`}
                  title={`Remove ${tile.label} from the dashboard`}
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-security-navy-200 bg-white text-security-navy-400 opacity-100 shadow-security-card transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                >
                  <svg
                    className="h-3.5 w-3.5"
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

          {hidden.length > 0 && !atLimit && (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="group flex h-full min-h-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-security-lg border border-dashed border-security-navy-200 bg-white/50 px-2 py-1 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-security-amber-300 hover:bg-security-amber-50/50 sm:gap-2.5 sm:px-3 sm:py-3"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-security-lg bg-security-navy-50 text-security-navy-500 transition-colors duration-200 group-hover:bg-security-amber-50 group-hover:text-security-amber-600 sm:h-12 sm:w-12 lg:h-14 lg:w-14">
                <svg
                  className="h-4 w-4 sm:h-6 sm:w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span className="text-[0.65rem] font-semibold leading-tight text-security-navy-900 sm:text-sm lg:text-[0.95rem]">
                Add module
              </span>
            </button>
          )}
        </div>
      )}

      {available.length > 0 && (
        <div className="mt-4 flex shrink-0 flex-col items-center gap-2 [@media(max-height:700px)]:mt-3">
          {/* The "+" tile only appears when a slot is free, so keep a permanent
              entry point here — otherwise a full dashboard hides the feature. */}
          {hidden.length > 0 && (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex items-center gap-2 rounded-full border border-security-navy-200 bg-white px-4 py-1.5 text-xs font-semibold text-security-navy-700 shadow-security-card transition hover:border-security-amber-300 hover:bg-security-amber-50 hover:text-security-amber-700 sm:text-sm"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
              </svg>
              Add module
            </button>
          )}
          <p className="text-center font-mono text-[0.625rem] uppercase tracking-[0.14em] text-security-navy-400 [@media(max-height:700px)]:hidden">
            {tiles.length} of {DASHBOARD_TILE_LIMIT} tiles in use
            {hidden.length > 0 && ` · ${hidden.length} hidden`}
            {` · ${pinned.length} of ${PINNED_LIMIT} pinned`}
          </p>
        </div>
      )}

      {picking && (
        <div
          className="fixed inset-0 z-[90] flex animate-fade-in items-end justify-center bg-security-navy-900/50 backdrop-blur-[3px] sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add a module to the dashboard"
          onClick={() => setPicking(false)}
        >
          <div
            className="card-elevated max-h-[80vh] w-full max-w-lg animate-slide-up overflow-y-auto rounded-b-none p-5 motion-reduce:animate-none sm:rounded-security-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-security-navy-900">Add a module</h2>
                <p className="mt-1 text-xs text-security-navy-500">
                  {atLimit
                    ? `The dashboard holds ${DASHBOARD_TILE_LIMIT} tiles. Remove one to free a slot.`
                    : `${DASHBOARD_TILE_LIMIT - tiles.length} slot${
                        DASHBOARD_TILE_LIMIT - tiles.length === 1 ? "" : "s"
                      } left on the dashboard.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPicking(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-security-navy-400 transition-colors hover:bg-security-navy-50 hover:text-security-navy-900"
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
                return (
                  <li key={href}>
                    <button
                      type="button"
                      disabled={atLimit}
                      onClick={() => {
                        add(href);
                        if (hidden.length <= 1 || tiles.length + 1 >= DASHBOARD_TILE_LIMIT) {
                          setPicking(false);
                        }
                      }}
                      className="spine spine-idle flex w-full items-center gap-3 rounded-security border border-security-navy-100 py-2.5 pl-4 pr-3 text-left transition hover:border-security-amber-200 hover:bg-security-amber-50/60 hover:before:bg-security-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-security bg-security-navy-50 text-security-navy-500 [&_svg]:h-5 [&_svg]:w-5">
                        <ModuleIcon href={href} />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm font-semibold text-security-navy-900">{tile.label}</span>
                        {tile.description && (
                          <span className="truncate text-xs text-security-navy-500">{tile.description}</span>
                        )}
                      </span>
                      <span className="ml-auto font-mono text-[0.625rem] uppercase tracking-[0.14em] text-security-amber-700">
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
