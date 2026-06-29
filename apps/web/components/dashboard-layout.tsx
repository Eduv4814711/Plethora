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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
    if (!loading && !user) {
      // #region agent log
      fetch("http://127.0.0.1:7661/ingest/453706ed-2456-4856-80b5-ae7dd19b5077", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "2915a3" },
        body: JSON.stringify({
          sessionId: "2915a3",
          runId: "pre-fix",
          hypothesisId: "A,B,C,D,E",
          location: "dashboard-layout.tsx:redirect-login",
          message: "Redirecting to login — user session lost",
          data: { pathname, loading },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileNavOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (profileRef.current && !profileRef.current.contains(t)) setProfileOpen(false);
      if (moreRef.current && !moreRef.current.contains(t)) setMoreOpen(false);
      if (searchRef.current && !searchRef.current.contains(t)) setSearchOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  if (loading || settingsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-security-navy-50">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div
            className="w-14 h-14 rounded-security-lg bg-white border-2 border-neutral-200 flex items-center justify-center shadow-security-card p-2"
            aria-hidden
          >
            {/* Same asset as app/icon.svg (tab favicon) */}
            <img
              src="/icon.svg"
              alt=""
              width={40}
              height={40}
              className="w-10 h-10 object-contain animate-pulse"
              decoding="async"
              fetchPriority="high"
            />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-security-navy-600">Loading</span>
        </div>
      </div>
    );
  }

  if (!user) {
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
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--bg-canvas)]">
      {mobileNavOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[60] bg-black/45 lg:hidden touch-manipulation"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
          <div
            id="dashboard-mobile-nav"
            className="fixed top-0 left-0 bottom-0 z-[70] flex w-[min(20.5rem,90vw)] flex-col border-r border-white/15 bg-security-navy-800 shadow-security-elevated lg:hidden touch-manipulation pt-[max(0.5rem,env(safe-area-inset-top,0px))] pb-[env(safe-area-inset-bottom,0px)]"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
              <p className="min-w-0 truncate text-sm font-semibold text-white/95">{companyName}</p>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-security text-white/90 hover:bg-white/10"
                aria-label="Close menu"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto overscroll-y-contain px-2 py-3">
              {[...mainNavItems, ...moreNavItems].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileNavOpen(false)}
                  className={clsx(
                    "mb-1 block rounded-security px-3 py-3 text-base font-medium tracking-wide transition-colors",
                    isActive(item.href)
                      ? "bg-white/95 text-security-navy-900 shadow-sm"
                      : "text-white/90 hover:bg-white/10 hover:text-white"
                  )}
                >
                  {item.label}
                </Link>
              ))}
              {canAccessSettings && (
                <Link
                  href="/settings"
                  onClick={() => setMobileNavOpen(false)}
                  className={clsx(
                    "mb-1 block rounded-security px-3 py-3 text-base font-medium tracking-wide transition-colors",
                    isActive("/settings")
                      ? "bg-white/95 text-security-navy-900 shadow-sm"
                      : "text-white/90 hover:bg-white/10 hover:text-white"
                  )}
                >
                  Settings
                </Link>
              )}
            </nav>
          </div>
        </>
      )}

      {/* Brand header – fixed so it stays visible while main scrolls (mobile + desktop) */}
      <header className="fixed top-0 left-0 right-0 z-[45] flex min-h-14 items-center justify-between gap-2 border-b border-white/10 bg-security-navy-800/95 px-3 shadow-sm backdrop-blur sm:px-5 pt-[env(safe-area-inset-top,0px)]">
        <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2 lg:flex-initial">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-security text-white/90 hover:bg-white/10 lg:hidden touch-manipulation"
            aria-expanded={mobileNavOpen}
            aria-controls="dashboard-mobile-nav"
            aria-label="Open navigation menu"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link href="/" className="flex min-w-0 items-center shrink-0 overflow-hidden">
            <img
              src="/plethora-logo-header.svg"
              alt="Plethora"
              className="h-9 w-auto max-h-10 object-contain object-left opacity-95 sm:h-10"
            />
          </Link>
        </div>

        <nav className="hidden lg:flex flex-1 items-center justify-center gap-5 xl:gap-7 min-w-0" aria-label="Primary">
          <span className="text-sm font-semibold text-white/95 tracking-wide truncate max-w-[12rem] xl:max-w-none">
            {companyName}
          </span>
          {mainNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "text-sm font-medium tracking-wide transition-all py-2 px-3 rounded-full whitespace-nowrap",
                isActive(item.href)
                  ? "text-security-navy-900 bg-white/95 shadow-sm"
                  : "text-white/90 hover:text-white hover:bg-white/10"
              )}
            >
              {item.label}
            </Link>
          ))}
          {moreNavItems.length > 0 && (
            <div ref={moreRef} className="relative">
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                className={clsx(
                  "text-sm font-medium tracking-wide transition-all py-2 px-3 rounded-full",
                  moreNavItems.some((i) => isActive(i.href))
                    ? "text-security-navy-900 bg-white shadow-sm"
                    : "text-white/90 hover:text-white hover:bg-white/10"
                )}
              >
                More
              </button>
              {moreOpen && (
                <div className="absolute top-full right-0 mt-1 py-1.5 bg-white border border-neutral-200 rounded-security-lg shadow-security-elevated z-50 min-w-[200px]">
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

        <div className="flex items-center gap-0.5 sm:gap-2 shrink-0">
          <div ref={searchRef} className="relative flex items-center">
            {(user.role === "admin" || normalizeUserModuleAccess(user.moduleAccess)) && (
            <>
            {searchOpen ? (
              <div className="flex max-w-[calc(100vw-6.5rem)] items-center gap-1 sm:gap-2 md:max-w-none">
                <SearchDropdown onClose={() => setSearchOpen(false)} />
                <button
                  type="button"
                  onClick={() => setSearchOpen(false)}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-white/85 hover:text-white hover:bg-security-navy-800 rounded-security transition-colors touch-manipulation"
                  aria-label="Close search"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="inline-flex h-11 w-11 items-center justify-center text-white/85 hover:text-white hover:bg-security-navy-800 rounded-security transition-colors touch-manipulation"
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
              className="inline-flex h-11 w-11 items-center justify-center text-security-navy-300 hover:text-white hover:bg-security-navy-800 rounded-security transition-colors touch-manipulation"
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
              type="button"
              onClick={() => setProfileOpen((o) => !o)}
              className="flex min-h-11 items-center gap-2 rounded-security py-1.5 pl-1.5 pr-2 text-white/85 hover:text-white hover:bg-security-navy-800 transition-colors touch-manipulation sm:pr-3"
              title="Profile"
              aria-label="Profile"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-security-navy-400 text-sm font-semibold text-white sm:h-8 sm:w-8">
                {user.name?.charAt(0)?.toUpperCase() ?? "U"}
              </div>
              <span className="hidden max-w-[100px] truncate text-sm font-medium sm:inline md:max-w-[140px]">{user.name}</span>
              <svg className="hidden h-4 w-4 shrink-0 opacity-70 sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-full mt-1 py-2 bg-white border border-neutral-200 rounded-security-lg shadow-security-elevated z-50 min-w-[220px]">
                <div className="px-4 py-3 border-b border-security-navy-100">
                  <p className="text-sm font-semibold text-security-navy">{user.name}</p>
                  <p className="text-xs text-security-navy-500 capitalize mt-0.5">
                    {roleDisplay}
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

      <main
        id="dashboard-main"
        className={clsx(
          "flex min-h-0 flex-1 flex-col box-border bg-gradient-to-b from-[var(--bg-canvas)] via-white to-security-navy-50/35",
          /* Reserve space for fixed header: safe area + min-h-14 row + match previous vertical rhythm */
          "pt-[calc(env(safe-area-inset-top,0px)+3.5rem+1rem)] pb-5 pl-4 pr-4 sm:pt-[calc(env(safe-area-inset-top,0px)+3.5rem+1.5rem)] sm:pb-6 sm:pl-6 sm:pr-6 md:pb-8 md:pl-8 md:pr-8 lg:pt-[calc(env(safe-area-inset-top,0px)+3.5rem+2.5rem)] lg:pb-10 lg:pl-10 lg:pr-10",
          isDashboardHome &&
            "lg:pt-[calc(env(safe-area-inset-top,0px)+3.5rem+1.25rem)] lg:pb-4 xl:pt-[calc(env(safe-area-inset-top,0px)+3.5rem+1.5rem)] xl:pb-5 [@media(max-height:860px)]:lg:pt-[calc(env(safe-area-inset-top,0px)+3.5rem+0.75rem)] [@media(max-height:860px)]:lg:pb-3",
          "overscroll-y-contain",
          isDashboardHome
            ? "overflow-y-auto lg:overflow-hidden"
            : isWhatsAppPage
              ? "overflow-hidden"
              : isAcademyPage
                ? "overflow-y-auto lg:overflow-hidden"
                : "overflow-y-auto",
        )}
      >
        {hasAccess ? (
          isAcademyPage || isDashboardHome ? (
            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col lg:h-full">{children}</div>
          ) : (
            children
          )
        ) : null}
      </main>
    </div>
  );
}
