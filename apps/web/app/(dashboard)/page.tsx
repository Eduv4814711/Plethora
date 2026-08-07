"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { NAV_ITEMS, canAccessRoute } from "@/lib/permissions";
import { MODULE_DESCRIPTIONS, MODULE_ICONS, MODULE_ICON_FALLBACK } from "@/lib/module-presentation";

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

export default function ModuleLauncher() {
  const { user } = useAuth();
  const { settings } = useSettings();

  // DashboardLayout renders nothing until the user resolves, so this is only a
  // type guard rather than a state we actually paint.
  if (!user) return null;

  const firstName = user.name?.trim().split(/\s+/)[0] ?? "";

  const tiles: Tile[] = [
    // `/` is the launcher itself; its charts live at /overview, which resolves
    // back to the `/` module for access purposes (see lib/permissions.ts).
    ...(canAccessRoute("/", user) ? [{ href: "/overview", label: "Overview" }] : []),
    ...NAV_ITEMS.filter((item) => item.href !== "/" && canAccessRoute(item.href, user)),
  ].map((tile) => ({ ...tile, description: MODULE_DESCRIPTIONS[tile.href] }));

  return (
    <div className="mx-auto w-full max-w-5xl py-2 sm:py-6">
      <header className="mb-8 sm:mb-10">
        <h1 className="page-title text-xl sm:text-2xl">
          {greeting(new Date().getHours())}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {settings?.name ? `${settings.name} — choose a module to get started` : "Choose a module to get started"}
        </p>
      </header>

      {tiles.length === 0 ? (
        <div className="card-wireframe px-6 py-12 text-center">
          <p className="text-sm font-semibold text-black">No modules yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--text-muted)]">
            Nobody has granted you access to a module. Ask your company owner to assign one in
            Settings → User Access.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {tiles.map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="card-dashboard group flex flex-col items-center gap-3 px-3 py-6 text-center no-underline transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-security-navy-500 focus-visible:ring-offset-2 sm:px-4 sm:py-7"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-security-lg bg-security-navy-50 text-security-navy-600 transition-colors duration-200 group-hover:bg-security-navy-100 sm:h-16 sm:w-16">
                {MODULE_ICONS[tile.href] ?? MODULE_ICON_FALLBACK}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold leading-tight text-black sm:text-[0.95rem]">
                  {tile.label}
                </span>
                {tile.description && (
                  <span className="text-xs leading-snug text-[var(--text-muted)]">{tile.description}</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
