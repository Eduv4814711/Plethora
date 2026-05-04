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
  getDefaultRouteForUser,
  isFullAdmin,
  normalizeUserModuleAccess,
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
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user || !pathname) return;
    if (!canAccessRoute(pathname, user.role, user.moduleAccess)) {
      router.replace(getDefaultRouteForUser(user));
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

  useEffect(() => {
    setNavDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navDrawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navDrawerOpen]);

  useEffect(() => {
    if (!navDrawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setNavDrawerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navDrawerOpen]);

  if (loading || settingsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-canvas)]">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div
            className="w-16 h-16 rounded-security-lg bg-white border border-security-navy-200 flex items-center justify-center shadow-security-elevated p-2"
            aria-hidden
          >
            <img
              src="/icon.svg"
              alt=""
              width={48}
              height={48}
              className="w-12 h-12 object-contain animate-pulse"
              decoding="async"
              fetchPriority="high"
            />
          </div>
          <span className="label-text">Loading</span>
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
        isAdmin={isFullAdmin(user)}
        onLogout={logout}
      />
    );
  }

  const allNavItems = NAV_ITEMS.filter((item) => canAccessRoute(item.href, user.role, user.moduleAccess));

  const mainNavItems = allNavItems.filter((item) => MAIN_NAV_HREFS.includes(item.href));
  const moreNavItems = allNavItems.filter((item) => MORE_NAV_HREFS.includes(item.href));
  const canAccessSettings = canAccessRoute("/settings", user.role, user.moduleAccess);

  const hasAccess = canAccessRoute(pathname, user.role, user.moduleAccess);
  const isDashboardHome = pathname === "/";
  const isWhatsAppPage = pathname === "/whatsapp" || pathname.startsWith("/whatsapp/");
  const isAcademyPage = pathname === "/academy" || (pathname != null && pathname.startsWith("/academy/"));

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
  const roleDisplay = user.roleLabel?.trim() || user.role.replace(/_/g, " ");

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-canvas)] font-sans">
      {/* Mobile drawer: full nav stack + backdrop */}
      {navDrawerOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/40 lg:hidden animate-fade-in"
            aria-label="Close menu"
            onClick={() => setNavDrawerOpen(false)}
          />
          <div
            id="dashboard-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="fixed inset-y-0 left-0 z-50 flex w-[min(100vw-2.5rem,20rem)] flex-col border-r border-[var(--hairline)] bg-white shadow-security-elevated lg:hidden animate-fade-in"
          >
            <div className="brand-band flex items-center justify-between gap-2 px-4 py-3 shrink-0">
              <Link href="/" className="min-h-11 flex items-center gap-2 min-w-0" onClick={() => setNavDrawerOpen(false)}>
                <img src="/plethora-logo-header.svg" alt="" className="h-9 w-auto object-contain" />
              </Link>
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-security border border-black/20 bg-white/40 text-black hover:bg-white/70 transition-colors focus-ring"
                aria-label="Close navigation"
                onClick={() => setNavDrawerOpen(false)}
              >
                <svg className="mx-auto h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="section-title px-4 pt-4 pb-2 truncate">{companyName}</p>
            <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-1" aria-label="Primary">
              {mainNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setNavDrawerOpen(false)}
                  className={clsx(
                    "flex min-h-11 items-center rounded-security px-3 text-sm font-semibold tracking-wide transition-colors focus-ring",
                    isActive(item.href)
                      ? "bg-security-navy-100 text-black border border-security-navy-400 shadow-sm"
                      : "text-black border border-transparent hover:bg-[var(--bg-nav-hover)] hover:border-[var(--hairline)]"
                  )}
                >
                  {item.label}
                </Link>
              ))}
              {moreNavItems.length > 0 && (
                <>
                  <p className="label-text px-3 pt-4 pb-1">More</p>
                  {moreNavItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setNavDrawerOpen(false)}
                      className={clsx(
                        "flex min-h-11 items-center rounded-security px-3 text-sm font-semibold tracking-wide transition-colors focus-ring",
                        isActive(item.href)
                          ? "bg-security-navy-100 text-black border border-security-navy-400 shadow-sm"
                          : "text-black border border-transparent hover:bg-[var(--bg-nav-hover)] hover:border-[var(--hairline)]"
                      )}
                    >
                      {item.label}
                    </Link>
                  ))}
                </>
              )}
            </nav>
          </div>
        </>
      )}

      {/* Brand header – desktop horizontal nav; mobile shows drawer trigger */}
      <header className="brand-band sticky top-0 z-30 min-h-[64px] flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 py-2 shrink-0 shadow-md">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
          <button
            type="button"
            className="lg:hidden inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-security border border-black/20 bg-white/40 text-black hover:bg-white/70 transition-colors focus-ring"
            aria-expanded={navDrawerOpen}
            aria-controls="dashboard-nav-drawer"
            onClick={() => setNavDrawerOpen(true)}
            aria-label="Open menu"
          >
            <svg className="mx-auto h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link href="/" className="flex items-center shrink-0 min-h-11 focus-ring rounded-security">
            <img
              src="/plethora-logo-header.svg"
              alt="Plethora"
              className="h-10 sm:h-12 lg:h-14 w-auto object-contain max-w-[10rem] sm:max-w-none drop-shadow-sm"
            />
          </Link>
        </div>

        <nav className="hidden lg:flex flex-1 items-center justify-center gap-1 xl:gap-2 min-w-0 px-2" aria-label="Primary">
          <span className="text-sm font-semibold text-black truncate max-w-[12rem] xl:max-w-xs hidden xl:inline mr-2">
            {companyName}
          </span>
          {mainNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "text-sm font-semibold transition-all py-2 px-3 rounded-security whitespace-nowrap min-h-10 inline-flex items-center focus-ring",
                isActive(item.href)
                  ? "bg-white text-black border border-white shadow-md ring-1 ring-black/5"
                  : "text-black border border-transparent hover:bg-white/40 hover:border-white/60"
              )}
            >
              {item.label}
            </Link>
          ))}
          {moreNavItems.length > 0 && (
            <div ref={moreRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                className={clsx(
                  "text-sm font-semibold transition-all py-2 px-3 rounded-security min-h-10 inline-flex items-center gap-1 focus-ring",
                  moreNavItems.some((i) => isActive(i.href)) || moreOpen
                    ? "bg-white text-black border border-white shadow-md ring-1 ring-black/5"
                    : "text-black border border-transparent hover:bg-white/40 hover:border-white/60"
                )}
              >
                More
                <svg className={clsx("w-3.5 h-3.5 transition-transform", moreOpen && "rotate-180")} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {moreOpen && (
                <div className="absolute top-full right-0 mt-2 py-1.5 bg-white border border-[var(--hairline)] rounded-security-lg shadow-security-elevated z-50 min-w-[220px] animate-fade-in">
                  {moreNavItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={clsx(
                        "flex min-h-11 items-center px-4 py-3 text-sm transition-colors focus-ring",
                        isActive(item.href)
                          ? "bg-security-navy-50 text-black font-semibold border-l-2 border-security-navy-500"
                          : "text-black hover:bg-[var(--bg-nav-hover)]"
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

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <div ref={searchRef} className="relative flex items-center">
            {(user.role === "admin" || normalizeUserModuleAccess(user.moduleAccess)) && (
            <>
            {searchOpen ? (
              <div className="flex items-center gap-2">
                <SearchDropdown onClose={() => setSearchOpen(false)} />
                <button
                  onClick={() => setSearchOpen(false)}
                  className="min-h-11 min-w-11 p-2 text-black bg-white/40 hover:bg-white/70 rounded-security transition-colors flex items-center justify-center border border-black/20 focus-ring"
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
                className="min-h-11 min-w-11 p-2 text-black bg-white/30 hover:bg-white/70 rounded-security transition-colors flex items-center justify-center border border-black/15 focus-ring"
                title="Search"
                aria-label="Search"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            )}
            </>
            )}
          </div>

          {canAccessSettings && (
            <Link
              href="/settings"
              className="min-h-11 min-w-11 p-2 text-black bg-white/30 hover:bg-white/70 rounded-security transition-colors inline-flex items-center justify-center border border-black/15 focus-ring"
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
              aria-expanded={profileOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 min-h-11 pl-1 pr-2 sm:pr-3 text-black hover:bg-white/50 rounded-security transition-colors border border-transparent hover:border-white/60 focus-ring"
              title="Profile"
              aria-label="Profile"
            >
              <div className="w-9 h-9 sm:w-9 sm:h-9 rounded-full bg-white border border-security-navy-300 flex items-center justify-center text-black font-bold text-sm shrink-0 shadow-sm">
                {user.name?.charAt(0)?.toUpperCase() ?? "U"}
              </div>
              <span className="text-sm font-semibold max-w-[120px] truncate hidden sm:inline">{user.name}</span>
              <svg className={clsx("w-4 h-4 opacity-80 transition-transform", profileOpen && "rotate-180")} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-full mt-2 py-2 bg-white border border-[var(--hairline)] rounded-security-lg shadow-security-elevated z-50 min-w-[240px] animate-fade-in" role="menu">
                <div className="px-4 py-3 border-b border-[var(--hairline)]">
                  <p className="text-sm font-semibold text-black truncate">{user.name}</p>
                  <p className="text-xs text-black capitalize mt-0.5 truncate">
                    {roleDisplay}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    logout();
                  }}
                  className="w-full text-left min-h-11 px-4 py-3 text-sm text-black hover:bg-[var(--bg-nav-hover)] transition-colors flex items-center gap-2 focus-ring"
                  role="menuitem"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main
        className={clsx(
          "flex-1 px-4 py-4 sm:px-6 sm:py-6 md:px-8 md:py-8 lg:px-10 lg:py-10 bg-gradient-to-b from-[var(--bg-canvas)] via-[var(--bg-content)] to-[var(--surface-soft)]",
          isDashboardHome || isWhatsAppPage
            ? "min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col"
            : isAcademyPage
              ? "min-h-0 flex flex-col overflow-y-auto max-lg:overflow-y-auto lg:h-[calc(100dvh-3.5rem)] lg:max-h-[calc(100dvh-3.5rem)] lg:overflow-hidden"
              : "overflow-auto"
        )}
      >
        {hasAccess ? (isAcademyPage ? <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col lg:h-full">{children}</div> : children) : null}
      </main>
    </div>
  );
}
