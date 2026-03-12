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

  // Redirect if user navigated to a route they don't have access to (must be before early returns)
  useEffect(() => {
    if (!user || !pathname) return;
    if (!canAccessRoute(pathname, user.role)) {
      router.replace(getDefaultRouteForRole(user.role));
    }
  }, [pathname, user, router]);

  // Close dropdowns on click outside
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
      <div className="min-h-screen flex items-center justify-center bg-[#FAF9F6]">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="w-10 h-10 rounded-[10px] border-2 border-black bg-white animate-pulse" />
          <span className="text-xs font-medium uppercase tracking-wider text-black">Loading</span>
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

  // Don't render page content if user lacks access (prevents flash before redirect)
  const hasAccess = canAccessRoute(pathname, user.role);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between pl-4 pr-8 shrink-0">
        {/* Top-left: Logo */}
        <Link href="/" className="flex items-center shrink-0">
          <img src="/plethora-logo.svg" alt="Plethora" className="h-20 w-auto object-contain" />
        </Link>

        {/* Center: Main nav links */}
        <nav className="flex flex-1 items-center justify-center gap-12">
          <span className="text-sm font-bold uppercase tracking-wider text-black">
            {companyName}
          </span>
          {mainNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "text-sm font-bold uppercase tracking-wider transition-colors",
                isActive(item.href)
                  ? "text-black"
                  : "text-black hover:opacity-70"
              )}
            >
              {item.label.toUpperCase()}
            </Link>
          ))}
          {moreNavItems.length > 0 && (
            <div ref={moreRef} className="relative">
              <button
                onClick={() => setMoreOpen((o) => !o)}
                className={clsx(
                  "text-sm font-bold uppercase tracking-wide transition-colors",
                  moreNavItems.some((i) => isActive(i.href))
                    ? "text-black underline underline-offset-4"
                    : "text-black hover:underline underline-offset-4"
                )}
              >
                MORE
              </button>
              {moreOpen && (
                <div className="absolute top-full right-0 mt-2 py-1 bg-white border border-black z-50 min-w-[180px]">
                  {moreNavItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={clsx(
                        "block px-4 py-2.5 text-sm transition-colors",
                        isActive(item.href)
                          ? "bg-wireframe-accent text-black font-medium"
                          : "text-black hover:bg-neutral-100"
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

        {/* Right: Search, Settings, Profile */}
        <div className="flex items-center gap-4 shrink-0">
          <div ref={searchRef} className="relative flex items-center">
            {searchOpen ? (
              <div className="flex items-center gap-2">
                <SearchDropdown onClose={() => setSearchOpen(false)} />
                <button
                  onClick={() => setSearchOpen(false)}
                  className="p-1.5 text-black hover:opacity-70 transition-colors"
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
                className="p-2 text-black hover:opacity-70 transition-colors"
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
              className="p-2 text-black hover:opacity-70 transition-colors"
              title="Settings"
              aria-label="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
          )}

          <div ref={profileRef} className="relative">
            <button
              onClick={() => setProfileOpen((o) => !o)}
              className="p-2 text-black hover:opacity-70 transition-colors"
              title="Profile"
              aria-label="Profile"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-full mt-2 py-2 bg-white border border-black z-50 min-w-[200px]">
                <div className="px-4 py-2 border-b border-black">
                  <p className="text-sm font-bold text-black">{user.name}</p>
                  <p className="text-xs text-black capitalize">
                    {user.role.replace(/_/g, " ")}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    logout();
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-black hover:bg-neutral-100"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 p-8 overflow-auto bg-[#FAF9F6]">{hasAccess ? children : null}</main>
    </div>
  );
}
