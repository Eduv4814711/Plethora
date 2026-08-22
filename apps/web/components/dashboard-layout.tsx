"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { SearchDropdown } from "@/components/search-dropdown";
import { NotificationBell } from "@/components/notification-bell";
import { CompanySetupModal } from "@/components/company-setup-modal";
import { MODULE_ICONS, MODULE_ICON_FALLBACK } from "@/lib/module-presentation";
import {
  NAV_ITEMS,
  MAIN_NAV_HREFS,
  MORE_NAV_HREFS,
  canAccessRoute,
  getDefaultRouteForUser,
  hasAnyModuleView,
} from "@/lib/permissions";
import { clsx } from "clsx";

/**
 * The console frame: a graphite header over the bright work surface. Modules
 * are reached from the launcher, from search, or from the drawer on small
 * screens — the desktop keeps its full width for the data.
 */

function NavIcon({ href }: { href: string }) {
  return <>{MODULE_ICONS[href] ?? MODULE_ICON_FALLBACK}</>;
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, loading } = useAuth();
  const { settings, loading: settingsLoading, needsSetup, update, refresh } = useSettings();
  const companyName = settings?.name ?? "Plethora";

  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user || !pathname) return;
    if (!canAccessRoute(pathname, user)) {
      router.replace(getDefaultRouteForUser(user));
    }
  }, [pathname, user, router]);

  useEffect(() => {
    if (!loading && !user) {
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
      if (searchRef.current && !searchRef.current.contains(t)) setSearchOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  if (loading || settingsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-canvas)]">
        <div className="flex animate-fade-in flex-col items-center gap-5">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-security-lg border border-security-navy-100 bg-white p-3 shadow-security-card"
            aria-hidden
          >
            {/* Same asset as app/icon.svg (tab favicon) */}
            <img
              src="/icon.svg"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 object-contain"
              decoding="async"
              fetchPriority="high"
            />
          </div>
          {/* A determinate-looking bar rather than a spinner: it reads as the
              product waking up, not as something stuck. */}
          <div className="h-0.5 w-24 overflow-hidden rounded-full bg-security-navy-100">
            <div className="h-full w-1/2 animate-signal-pulse rounded-full bg-security-amber-500 motion-reduce:animate-none" />
          </div>
          <span className="section-title">Loading your board</span>
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
        isOwner={user.isOwner}
        onLogout={logout}
      />
    );
  }

  const allNavItems = NAV_ITEMS.filter((item) => canAccessRoute(item.href, user));

  const mainNavItems = allNavItems.filter((item) => MAIN_NAV_HREFS.includes(item.href));
  const moreNavItems = allNavItems.filter((item) => MORE_NAV_HREFS.includes(item.href));
  const canAccessSettings = canAccessRoute("/settings", user);

  // `/` is the launcher; its charts live at /overview, which the drawer lists
  // as its own entry.
  const navItems = [
    ...(canAccessRoute("/", user) ? [{ href: "/overview", label: "Overview" }] : []),
    ...mainNavItems.filter((item) => item.href !== "/"),
    ...moreNavItems,
  ];

  const hasAccess = canAccessRoute(pathname, user);
  // The dense chart grid needs a tighter, non-scrolling frame. It moved to
  // /overview when `/` became the module launcher, which takes standard padding.
  const isOverviewPage = pathname === "/overview";
  const isWhatsAppPage = pathname === "/whatsapp" || pathname.startsWith("/whatsapp/");
  const isAcademyPage = pathname === "/academy" || (pathname != null && pathname.startsWith("/academy/"));

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
  const accessDisplay = user.isOwner
    ? "Company owner"
    : user.jobTitle?.trim() || (user.accountType === "client" ? "Client" : "Staff");

  const iconButton =
    "inline-flex h-10 w-10 items-center justify-center rounded-security text-white/75 transition-colors hover:bg-white/10 hover:text-white touch-manipulation";

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--bg-canvas)]">
      {mobileNavOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[60] bg-security-navy-900/60 backdrop-blur-[2px] lg:hidden touch-manipulation"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
          <div
            id="dashboard-mobile-nav"
            className="surface-chrome fixed bottom-0 left-0 top-0 z-[70] flex w-[min(20.5rem,88vw)] animate-slide-up flex-col shadow-security-elevated lg:hidden touch-manipulation motion-reduce:animate-none pt-[max(0.5rem,env(safe-area-inset-top,0px))] pb-[env(safe-area-inset-bottom,0px)]"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-white/60">Modules</p>
                <p className="min-w-0 truncate text-sm font-semibold text-white/95">{companyName}</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className={clsx(iconButton, "h-11 w-11 shrink-0")}
                aria-label="Close menu"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto overscroll-y-contain px-2 py-3">
              {[{ href: "/", label: "All modules" }, ...navItems].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileNavOpen(false)}
                  className={clsx(
                    "spine mb-0.5 flex items-center gap-3 rounded-security py-3 pl-4 pr-3 text-[0.9375rem] font-medium transition-colors [&_svg]:h-5 [&_svg]:w-5",
                    isActive(item.href)
                      ? "spine-live bg-white/10 text-white"
                      : "spine-idle before:bg-transparent text-white/75 hover:bg-white/5 hover:text-white"
                  )}
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  <span
                    className={clsx("shrink-0", isActive(item.href) ? "text-security-amber-400" : "text-white/60")}
                    aria-hidden
                  >
                    <NavIcon href={item.href} />
                  </span>
                  {item.label}
                </Link>
              ))}
              {canAccessSettings && (
                <Link
                  href="/settings"
                  onClick={() => setMobileNavOpen(false)}
                  className={clsx(
                    "spine mb-0.5 mt-2 flex items-center gap-3 rounded-security border-t border-white/10 py-3 pl-4 pr-3 text-[0.9375rem] font-medium transition-colors [&_svg]:h-5 [&_svg]:w-5",
                    isActive("/settings")
                      ? "spine-live bg-white/10 text-white"
                      : "spine-idle before:bg-transparent text-white/75 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <span
                    className={clsx("shrink-0", isActive("/settings") ? "text-security-amber-400" : "text-white/60")}
                    aria-hidden
                  >
                    <NavIcon href="/settings" />
                  </span>
                  Settings
                </Link>
              )}
            </nav>
          </div>
        </>
      )}

      {/* Brand header — fixed so it stays visible while main scrolls. */}
      <header className="surface-chrome fixed left-0 right-0 top-0 z-[45] flex min-h-14 items-center justify-between gap-2 px-2 sm:px-4 pt-[env(safe-area-inset-top,0px)]">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className={clsx(iconButton, "h-11 w-11 shrink-0 lg:hidden")}
            aria-expanded={mobileNavOpen}
            aria-controls="dashboard-mobile-nav"
            aria-label="Open navigation menu"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link
            href="/"
            className="flex min-w-0 shrink-0 items-center overflow-hidden rounded-security px-1"
            aria-label="All modules"
          >
            <img
              src="/plethora-logo-header.svg"
              alt="Plethora"
              className="h-8 w-auto object-contain object-left sm:h-9 lg:h-7"
            />
          </Link>
          {/* The company name is the one piece of orientation the header owes
              you on a small screen; the module name is already the page title. */}
          <span className="hidden min-w-0 truncate border-l border-white/15 pl-3 text-sm font-medium text-white/75 lg:inline">
            {companyName}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <div ref={searchRef} className="relative flex items-center">
            {hasAnyModuleView(user) && (
              <>
                {/* Desktop keeps the field on screen: hunting for a guard by
                    name is the most common thing anyone does in here, and it
                    should not cost a click to start. */}
                <div className="hidden lg:block">
                  <SearchDropdown />
                </div>
                <div className="lg:hidden">
                  {searchOpen ? (
                    <div className="flex max-w-[calc(100vw-6.5rem)] items-center gap-1 sm:gap-2">
                      <SearchDropdown onClose={() => setSearchOpen(false)} />
                      <button
                        type="button"
                        onClick={() => setSearchOpen(false)}
                        className={clsx(iconButton, "h-11 w-11 shrink-0")}
                        aria-label="Close search"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSearchOpen(true)}
                      className={clsx(iconButton, "h-11 w-11")}
                      title="Search"
                      aria-label="Search"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <NotificationBell />

          {canAccessSettings && (
            <Link
              href="/settings"
              className={clsx(iconButton, "h-11 w-11", isActive("/settings") && "bg-white/10 text-white")}
              title="Settings"
              aria-label="Settings"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
          )}

          <div ref={profileRef} className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen((o) => !o)}
              className="flex min-h-11 items-center gap-2 rounded-security py-1.5 pl-1.5 pr-2 text-white/75 transition-colors hover:bg-white/10 hover:text-white touch-manipulation sm:pr-3"
              title={user.name ?? "Profile"}
              aria-expanded={profileOpen}
              aria-label={user.name ? `Profile, ${user.name}` : "Profile"}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-security-amber-500 font-display text-sm font-semibold text-security-navy-900">
                {user.name?.charAt(0)?.toUpperCase() ?? "U"}
              </span>
              <span className="hidden max-w-[9rem] text-sm font-medium leading-tight sm:inline md:max-w-[12rem] xl:max-w-none xl:whitespace-nowrap">
                {user.name}
              </span>
              <svg className="hidden h-4 w-4 shrink-0 opacity-60 sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-full z-50 mt-2 min-w-[240px] animate-slide-up overflow-hidden rounded-security-lg border border-security-navy-100 bg-white py-1.5 shadow-security-elevated motion-reduce:animate-none">
                <div className="border-b border-security-navy-100 px-4 py-3">
                  <p className="text-sm font-semibold text-security-navy-900">{user.name}</p>
                  <p className="mt-0.5 text-xs text-security-navy-500">{accessDisplay}</p>
                </div>
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    logout();
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-security-navy-700 transition-colors hover:bg-security-navy-50"
                >
                  <svg className="h-4 w-4 text-security-navy-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main
        id="dashboard-main"
        className={clsx(
          "flex min-h-0 flex-1 flex-col box-border bg-[var(--bg-canvas)]",
          /* Reserve space for the fixed header: safe area + the 3.5rem row. */
          "pt-[calc(env(safe-area-inset-top,0px)+3.5rem+1rem)] pb-5 pl-4 pr-4 sm:pt-[calc(env(safe-area-inset-top,0px)+3.5rem+1.5rem)] sm:pb-6 sm:pl-6 sm:pr-6 md:pb-8 md:pl-8 md:pr-8 lg:pt-[calc(env(safe-area-inset-top,0px)+3.5rem+2rem)] lg:pb-10 lg:pl-8 lg:pr-8 xl:pl-10 xl:pr-10",
          isOverviewPage &&
            "lg:pt-[calc(env(safe-area-inset-top,0px)+3.5rem+1.25rem)] lg:pb-4 xl:pt-[calc(env(safe-area-inset-top,0px)+3.5rem+1.5rem)] xl:pb-5 [@media(max-height:860px)]:lg:pt-[calc(env(safe-area-inset-top,0px)+3.5rem+0.75rem)] [@media(max-height:860px)]:lg:pb-3",
          "overscroll-y-contain",
          isOverviewPage
            ? "overflow-y-auto"
            : isWhatsAppPage
              ? "overflow-hidden"
              : isAcademyPage
                ? "overflow-y-auto lg:overflow-hidden"
                : "overflow-y-auto"
        )}
      >
        {hasAccess ? (
          isAcademyPage || isOverviewPage ? (
            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">{children}</div>
          ) : (
            children
          )
        ) : null}
      </main>
    </div>
  );
}
