"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { SearchDropdown } from "@/components/search-dropdown";
import { CompanySetupModal } from "@/components/company-setup-modal";
import {
  NAV_ITEMS,
  MAIN_NAV_HREFS,
  MORE_NAV_HREFS,
  canAccessRoute,
  getDefaultRouteForRole,
} from "@/lib/permissions";
import { clsx } from "clsx";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, loading } = useAuth();
  const { settings, loading: settingsLoading, needsSetup, update, refresh } = useSettings();
  const companyName = settings?.name ?? "Plethora";

  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user || !pathname) return;
    if (!canAccessRoute(pathname, user.role)) {
      router.replace(getDefaultRouteForRole(user.role));
    }
  }, [pathname, user, router]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (loading || settingsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-security-navy-50">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="w-12 h-12 rounded-security-lg bg-security-navy-100 border-2 border-security-navy-200 flex items-center justify-center">
            <svg className="w-6 h-6 text-security-navy-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-security-navy-500">Loading</span>
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

  const userRole = user.role as "admin" | "operations_manager" | "hr_payroll" | "supervisor" | "controller";
  const allNavItems = NAV_ITEMS.filter((item) => {
    if (item.roles.length === 0) return true;
    return item.roles.includes(userRole);
  });

  const mainNavItems = allNavItems.filter((item) => MAIN_NAV_HREFS.includes(item.href));
  const moreNavItems = allNavItems.filter((item) => MORE_NAV_HREFS.includes(item.href));
  const canAccessSettings = canAccessRoute("/settings", user.role);

  const hasAccess = canAccessRoute(pathname, user.role);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="min-h-screen flex flex-col bg-security-navy-50">
      {/* Professional navy header - security company aesthetic */}
      <header className="h-14 bg-security-navy border-b border-security-navy-800 flex items-center justify-between px-6 shrink-0 shadow-security-elevated">
        <Link href="/" className="flex items-center shrink-0">
          <img src="/plethora-logo.svg" alt="Plethora" className="h-10 w-auto object-contain brightness-0 invert opacity-95" />
        </Link>

        <nav className="flex flex-1 items-center justify-center gap-8">
          <span className="text-sm font-semibold text-security-navy-300 tracking-wide">
            {companyName}
          </span>
          {mainNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "text-sm font-medium tracking-wide transition-colors py-2 px-3 rounded-security",
                isActive(item.href)
                  ? "text-white bg-security-navy-800"
                  : "text-security-navy-300 hover:text-white hover:bg-security-navy-800/80"
              )}
            >
              {item.label}
            </Link>
          ))}
          {moreNavItems.length > 0 && (
            <div ref={moreRef} className="relative">
              <button
                onClick={() => setMoreOpen((o) => !o)}
                className={clsx(
                  "text-sm font-medium tracking-wide transition-colors py-2 px-3 rounded-security",
                  moreNavItems.some((i) => isActive(i.href))
                    ? "text-white bg-security-navy-800"
                    : "text-security-navy-300 hover:text-white hover:bg-security-navy-800/80"
                )}
              >
                More
              </button>
              {moreOpen && (
                <div className="absolute top-full right-0 mt-1 py-1.5 bg-white border border-security-navy-200 rounded-security-lg shadow-security-elevated z-50 min-w-[200px]">
                  {moreNavItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={clsx(
                        "block px-4 py-2.5 text-sm transition-colors",
                        isActive(item.href)
                          ? "bg-security-navy-50 text-security-navy font-semibold"
                          : "text-security-navy-600 hover:bg-security-navy-50"
                      )}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <div ref={searchRef} className="relative flex items-center">
            {searchOpen ? (
              <div className="flex items-center gap-2">
                <SearchDropdown onClose={() => setSearchOpen(false)} />
                <button
                  onClick={() => setSearchOpen(false)}
                  className="p-2 text-security-navy-300 hover:text-white hover:bg-security-navy-800 rounded-security transition-colors"
                  aria-label="Close search"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
                className="p-2 text-security-navy-300 hover:text-white hover:bg-security-navy-800 rounded-security transition-colors"
                title="Search"
                aria-label="Search"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            )}
          </div>

          {canAccessSettings && (
            <Link
              href="/settings"
              className="p-2 text-security-navy-300 hover:text-white hover:bg-security-navy-800 rounded-security transition-colors"
              title="Settings"
              aria-label="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
          )}

          <div ref={profileRef} className="relative">
            <button
              onClick={() => setProfileOpen((o) => !o)}
              className="flex items-center gap-2 p-2 pr-3 text-security-navy-300 hover:text-white hover:bg-security-navy-800 rounded-security transition-colors"
              title="Profile"
              aria-label="Profile"
            >
              <div className="w-8 h-8 rounded-full bg-security-amber-500 flex items-center justify-center text-white font-semibold text-sm">
                {user.name?.charAt(0)?.toUpperCase() ?? "U"}
              </div>
              <span className="text-sm font-medium max-w-[100px] truncate hidden sm:inline">{user.name}</span>
              <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-full mt-1 py-2 bg-white border border-security-navy-200 rounded-security-lg shadow-security-elevated z-50 min-w-[220px]">
                <div className="px-4 py-3 border-b border-security-navy-100">
                  <p className="text-sm font-semibold text-security-navy">{user.name}</p>
                  <p className="text-xs text-security-navy-500 capitalize mt-0.5">
                    {user.role.replace(/_/g, " ")}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    logout();
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-security-navy-600 hover:bg-security-navy-50 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-8 overflow-auto bg-security-navy-50">{hasAccess ? children : null}</main>
    </div>
  );
}
