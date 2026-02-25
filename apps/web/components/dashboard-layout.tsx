"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { SearchDropdown } from "@/components/search-dropdown";
import { CompanySetupModal } from "@/components/company-setup-modal";
import { NAV_ITEMS, canAccessRoute } from "@/lib/permissions";
import { clsx } from "clsx";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, loading } = useAuth();
  const { settings, loading: settingsLoading, needsSetup, update, refresh } = useSettings();
  const companyName = settings?.name ?? "Plethora";

  if (loading || settingsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-100 dark:bg-neutral-950">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="w-10 h-10 rounded-lg bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Loading</span>
        </div>
      </div>
    );
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  if (needsSetup) {
    return (
      <CompanySetupModal
        settings={settings}
        onSave={async (data) => {
          await update({
            name: data.name,
            businessDetails: data.businessDetails,
            businessSettings: data.businessSettings,
          });
          await refresh();
        }}
        isAdmin={user.role === "admin"}
        onLogout={logout}
      />
    );
  }

  // Filter nav to only modules this role can access
  const navItems = NAV_ITEMS.filter((item) => {
    if (item.roles.length === 0) return true;
    return item.roles.includes(user.role as "admin" | "operations_manager" | "hr_payroll" | "supervisor");
  });

  // Redirect if user navigated to a route they don't have access to
  useEffect(() => {
    if (!user || !pathname) return;
    if (!canAccessRoute(pathname, user.role)) {
      router.replace("/");
    }
  }, [pathname, user, router]);

  // Don't render page content if user lacks access (prevents flash before redirect)
  const hasAccess = canAccessRoute(pathname, user.role);

  return (
    <div className="min-h-screen flex bg-neutral-100 dark:bg-neutral-950">
      <aside className="w-64 bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 flex flex-col shrink-0 shadow-sm">
        <div className="p-5 border-b border-neutral-200 dark:border-neutral-800">
          <Link href="/" className="flex items-center justify-center group">
            {settings?.logoUrl ? (
              <img src={settings.logoUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-neutral-200 dark:border-neutral-700" />
            ) : (
              <img src="/plethora-logo.png" alt="Plethora" className="h-10 w-auto object-contain" />
            )}
          </Link>
        </div>
        <nav className="flex-1 p-4 space-y-0.5 overflow-y-auto">
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 px-4 py-2 mb-1">
            Navigation
          </div>
          {navItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex items-center px-4 py-2.5 text-sm font-medium rounded-md transition-all duration-150",
                  isActive
                    ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                    : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 hover:text-neutral-900 dark:hover:text-neutral-100"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="relative h-16 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between px-6 shrink-0 shadow-sm">
          <div className="flex items-center gap-4 flex-1 max-w-xl">
            <SearchDropdown />
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 text-lg font-bold text-neutral-900 dark:text-neutral-100 tracking-tight uppercase">
            {companyName}
          </div>
          <div className="flex items-center gap-3 flex-1 justify-end">
            <button className="p-2.5 rounded-md text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 transition-colors" title="Notifications">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </button>
            <div className="flex items-center gap-3 pl-4 border-l border-neutral-200 dark:border-neutral-700">
              <div className="w-9 h-9 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 flex items-center justify-center font-semibold text-sm">
                {user.name.charAt(0)}
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{user.name}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{user.role.replace(/_/g, " ")}</p>
              </div>
              <button
                onClick={logout}
                className="btn-ghost text-xs uppercase tracking-wider"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">{hasAccess ? children : null}</main>
      </div>
    </div>
  );
}
