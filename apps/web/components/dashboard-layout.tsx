"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState, useRef, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { SearchDropdown } from "@/components/search-dropdown";
import { NotificationBell } from "@/components/notification-bell";
import { CompanySetupModal } from "@/components/company-setup-modal";
import {
  MODULE_ICONS,
  MODULE_ICON_FALLBACK,
  MODULE_CATEGORIES,
  MODULE_CATEGORY_ORDER,
  getModuleCategory,
  type ModuleCategoryKey,
} from "@/lib/module-presentation";
import {
  NAV_ITEMS,
  canAccessRoute,
  getDefaultRouteForUser,
  hasAnyModuleView,
  resolveModulePath,
} from "@/lib/permissions";
import { clsx } from "clsx";

const SUBROUTE_LABELS: Record<string, string> = {
  "/attendance/exceptions": "Exceptions",
  "/attendance/staff": "Staff Attendance",
  "/employees/compliance": "Compliance",
  "/billing/clients": "Client Accounts",
  "/billing/invoices": "Invoices",
  "/billing/quotes": "Quotes",
};

const SIDEBAR_STORAGE_KEY = "plethora:sidebar-collapsed";

function NavIcon({ href }: { href: string }) {
  return <>{MODULE_ICONS[href] ?? MODULE_ICON_FALLBACK}</>;
}

interface SidebarNavItem {
  href: string;
  label: string;
}

/**
 * Single unified navigation frame: one persistent left sidebar on desktop and
 * the exact same semantic navigation tree in a slide-over drawer on mobile.
 */
export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, loading } = useAuth();
  const { settings, loading: settingsLoading, needsSetup, update, refresh } = useSettings();
  const companyName = settings?.name ?? "Plethora";

  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const profilePopoverId = useId();
  const profilePopoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1") {
        setSidebarCollapsed(true);
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage write errors
      }
      return next;
    });
  };

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
      if (e.key === "Escape") {
        setMobileNavOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (searchRef.current && !searchRef.current.contains(t)) setSearchOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const groupedNav = useMemo(() => {
    if (!user) return { primary: [], admin: [] as SidebarNavItem[], all: [] as SidebarNavItem[] };

    const rawAccessible: SidebarNavItem[] = [
      ...(canAccessRoute("/", user)
        ? [
            { href: "/", label: "Dashboard" },
            { href: "/overview", label: "Live Analytics" },
          ]
        : []),
      ...NAV_ITEMS.filter((item) => item.href !== "/" && canAccessRoute(item.href, user)),
      ...(canAccessRoute("/settings", user) ? [{ href: "/settings", label: "Settings" }] : []),
    ];

    const seen = new Set<string>();
    const accessible = rawAccessible.filter((item) => {
      if (seen.has(item.href)) return false;
      seen.add(item.href);
      return true;
    });

    const byCategory = new Map<ModuleCategoryKey, SidebarNavItem[]>();
    for (const key of MODULE_CATEGORY_ORDER) {
      byCategory.set(key, []);
    }

    for (const item of accessible) {
      const cat = getModuleCategory(item.href);
      byCategory.get(cat)?.push(item);
    }

    const primary = MODULE_CATEGORY_ORDER.filter((key) => key !== "administration")
      .map((key) => ({
        key,
        label: MODULE_CATEGORIES[key].label,
        items: byCategory.get(key) ?? [],
      }))
      .filter((group) => group.items.length > 0);

    const admin = byCategory.get("administration") ?? [];

    return { primary, admin, all: accessible };
  }, [user]);

  if (loading || settingsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-canvas)]">
        <div className="flex animate-fade-in flex-col items-center gap-5">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-security-lg border border-security-navy-100 bg-white p-3 shadow-security-card"
            aria-hidden
          >
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

  const navItemByHref = new Map(groupedNav.all.map((item) => [item.href, item]));

  // Build semantic breadcrumb items
  const breadcrumbs: { href: string; label: string }[] = [];
  if (pathname === "/") {
    breadcrumbs.push({ href: "/", label: "Dashboard" });
  } else if (pathname) {
    breadcrumbs.push({ href: "/", label: "Dashboard" });
    if (pathname === "/overview") {
      breadcrumbs.push({ href: "/overview", label: "Live Analytics" });
    } else if (pathname === "/settings" || pathname.startsWith("/settings/")) {
      breadcrumbs.push({ href: "/settings", label: "Settings" });
      if (pathname === "/settings/migrate") {
        breadcrumbs.push({ href: "/settings/migrate", label: "Data Import / Export" });
      }
    } else {
      const modulePath = resolveModulePath(pathname);
      const moduleItem = modulePath ? navItemByHref.get(modulePath) : undefined;
      if (moduleItem) {
        breadcrumbs.push(moduleItem);
        if (pathname !== moduleItem.href) {
          const subLabel =
            SUBROUTE_LABELS[pathname] ??
            (pathname.startsWith("/rostering/sites/")
              ? pathname.endsWith("/advanced")
                ? "Advanced Pattern Editor"
                : "Site Roster"
              : pathname.startsWith("/attendance/sites/")
                ? "Site Timesheet"
                : pathname.startsWith("/sites/")
                  ? "Site Details"
                  : pathname.startsWith("/clients/")
                    ? "Client Details"
                    : pathname.startsWith("/incidents/")
                      ? "Incident Details"
                      : pathname.startsWith("/documents/")
                        ? "Document Details"
                        : pathname.startsWith("/billing/invoices/")
                          ? "Invoice Details"
                          : pathname.startsWith("/billing/quotes/")
                            ? "Quote Details"
                            : pathname.startsWith("/billing/clients/")
                              ? "Client Account"
                              : null);
          if (subLabel) {
            breadcrumbs.push({ href: pathname, label: subLabel });
          }
        }
      }
    }
  }

  const hasAccess = canAccessRoute(pathname, user);
  const isHomePage = pathname === "/";
  const isOverviewPage = pathname === "/overview";
  const isWhatsAppPage = pathname === "/whatsapp" || pathname.startsWith("/whatsapp/");

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  const accessDisplay = user.isOwner
    ? "Company owner"
    : user.jobTitle?.trim() || (user.accountType === "client" ? "Client" : "Staff");

  const renderNavLinks = (collapsed: boolean, onNavigate?: () => void) => (
    <div className="flex flex-1 flex-col justify-between overflow-y-auto overscroll-y-contain px-2.5 py-3">
      <div className="space-y-4">
        {groupedNav.primary.map((group) => (
          <div key={group.key}>
            {!collapsed && (
              <p className="mb-1 px-2.5 text-[11px] font-medium text-white/45">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "group flex items-center gap-2.5 rounded-security py-2 text-[13px] transition-colors [&_svg]:h-4 [&_svg]:w-4",
                        collapsed ? "justify-center px-2" : "px-2.5",
                        active
                          ? "bg-gradient-to-r from-security-amber-500/20 to-security-amber-500/5 font-semibold text-white shadow-[inset_3px_0_0_#f97a08]"
                          : "font-medium text-white/70 hover:bg-white/[0.06] hover:text-white"
                      )}
                    >
                      <span
                        className={clsx(
                          "shrink-0 transition-colors",
                          active ? "text-security-amber-400" : "text-white/55 group-hover:text-white/85"
                        )}
                        aria-hidden="true"
                      >
                        <NavIcon href={item.href} />
                      </span>
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {groupedNav.admin.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3">
          {!collapsed && (
            <p className="mb-1 px-2.5 text-[11px] font-medium text-white/45">
              Admin
            </p>
          )}
          <ul className="space-y-0.5">
            {groupedNav.admin.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={clsx(
                      "group flex items-center gap-2.5 rounded-security py-2 text-[13px] transition-colors [&_svg]:h-4 [&_svg]:w-4",
                      collapsed ? "justify-center px-2" : "px-2.5",
                      active
                        ? "bg-white/12 font-semibold text-white shadow-[inset_3px_0_0_#f97a08]"
                        : "font-medium text-white/70 hover:bg-white/[0.06] hover:text-white"
                    )}
                  >
                    <span
                      className={clsx(
                        "shrink-0 transition-colors",
                        active ? "text-security-amber-400" : "text-white/55 group-hover:text-white/85"
                      )}
                      aria-hidden="true"
                    >
                      <NavIcon href={item.href} />
                    </span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-[var(--bg-canvas)]">
      {/* ── Mobile Slide-Over Navigation Drawer ── */}
      {mobileNavOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[60] bg-security-navy-900/60 backdrop-blur-[2px] lg:hidden touch-manipulation"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside
            id="dashboard-mobile-nav"
            className="surface-chrome fixed bottom-0 left-0 top-0 z-[70] flex w-[min(18.5rem,86vw)] animate-slide-up flex-col shadow-security-elevated lg:hidden touch-manipulation motion-reduce:animate-none pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
            role="dialog"
            aria-modal="true"
            aria-label="Primary navigation"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex h-13 items-center justify-between gap-2 border-b border-white/10 px-4">
              <Link
                href="/"
                onClick={() => setMobileNavOpen(false)}
                className="flex min-w-0 items-center gap-2.5"
              >
                <img
                  src="/plethora-logo-header.svg"
                  alt="Plethora"
                  className="h-6 w-auto object-contain"
                />
              </Link>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-security text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close menu"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="border-b border-white/10 px-4 py-2">
              <p className="truncate text-xs font-medium text-white/70">{companyName}</p>
            </div>
            <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col">
              {renderNavLinks(false, () => setMobileNavOpen(false))}
            </nav>
          </aside>
        </>
      )}

      {/* ── Desktop Persistent Navigation Sidebar ── */}
      <aside
        className={clsx(
          "surface-chrome hidden shrink-0 flex-col border-r border-white/[0.08] transition-[width] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:flex",
          sidebarCollapsed ? "w-[64px]" : "w-[228px]"
        )}
      >
        <div
          className={clsx(
            "flex h-13 shrink-0 items-center border-b border-white/10",
            sidebarCollapsed ? "justify-center px-2" : "justify-between px-4"
          )}
        >
          <Link
            href="/"
            className="flex min-w-0 items-center overflow-hidden rounded-security py-0.5"
            aria-label="Plethora Dashboard"
          >
            {sidebarCollapsed ? (
              <img
                src="/icon.svg"
                alt="Plethora"
                className="h-7 w-7 object-contain"
              />
            ) : (
              <img
                src="/plethora-logo-header.svg"
                alt="Plethora"
                className="h-7 w-auto object-contain object-left"
              />
            )}
          </Link>
        </div>

        {!sidebarCollapsed && (
          <div className="border-b border-white/[0.07] px-3 py-2.5">
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5">
              <svg className="h-3.5 w-3.5 shrink-0 text-white/55" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <p className="truncate text-xs font-medium text-white/80" title={companyName}>
                {companyName}
              </p>
            </div>
          </div>
        )}

        <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col">
          {renderNavLinks(sidebarCollapsed)}
        </nav>
      </aside>

      {/* ── Main Content Column ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Slim Single-Row Top Bar */}
        <header className="relative z-30 flex h-13 shrink-0 items-center justify-between gap-3 border-b border-security-navy-100 bg-white px-3 sm:px-5 pt-[env(safe-area-inset-top,0px)]">
          <div className="flex min-w-0 items-center gap-2">
            {/* Mobile menu trigger */}
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-security text-security-navy-600 transition-colors hover:bg-security-navy-50 hover:text-security-navy-900 lg:hidden"
              aria-expanded={mobileNavOpen}
              aria-controls="dashboard-mobile-nav"
              aria-label="Open navigation menu"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Desktop sidebar collapse toggle */}
            <button
              type="button"
              onClick={toggleSidebar}
              className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-security text-security-navy-500 transition-colors hover:bg-security-navy-50 hover:text-security-navy-900 lg:inline-flex"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
              </svg>
            </button>

            {/* Mobile brand logo */}
            <Link href="/" className="flex shrink-0 items-center lg:hidden" aria-label="Plethora Dashboard">
              <img src="/icon.svg" alt="Plethora" className="h-6 w-6 object-contain" />
            </Link>

            {/* Clean Breadcrumb Trail */}
            <nav aria-label="Breadcrumbs" className="hidden min-w-0 items-center sm:flex">
              <ol className="flex items-center gap-1.5 text-xs">
                {breadcrumbs.map((crumb, idx) => {
                  const isLast = idx === breadcrumbs.length - 1;
                  return (
                    <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
                      {idx > 0 && (
                        <span className="select-none text-security-navy-300" aria-hidden="true">
                          /
                        </span>
                      )}
                      <Link
                        href={crumb.href}
                        aria-current={isLast ? "page" : undefined}
                        className={clsx(
                          "truncate rounded px-1.5 py-0.5 no-underline transition-colors",
                          isLast
                            ? "font-semibold text-security-navy-900"
                            : "font-medium text-security-navy-500 hover:bg-security-navy-50 hover:text-security-navy-800"
                        )}
                      >
                        {crumb.label}
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
            <div ref={searchRef} className="relative flex items-center">
              {hasAnyModuleView(user) && (
                <>
                  <div className="hidden md:block">
                    <SearchDropdown />
                  </div>
                  <div className="md:hidden">
                    {searchOpen ? (
                      <div className="flex max-w-[calc(100vw-6.5rem)] items-center gap-1">
                        <SearchDropdown onClose={() => setSearchOpen(false)} />
                        <button
                          type="button"
                          onClick={() => setSearchOpen(false)}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-security text-security-navy-500 hover:bg-security-navy-50"
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
                        className="inline-flex h-9 w-9 items-center justify-center rounded-security text-security-navy-500 hover:bg-security-navy-50 hover:text-security-navy-900"
                        title="Search"
                        aria-label="Search"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            <NotificationBell />

            <div className="relative">
              <button
                type="button"
                popoverTarget={profilePopoverId}
                className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-security-navy-200/80 bg-white py-0.5 pl-1 pr-2 text-security-navy-700 transition-colors hover:border-security-navy-300 hover:bg-security-navy-50 sm:pr-2.5"
                title={user.name ?? "Profile"}
                aria-expanded={profileOpen}
                aria-controls={profilePopoverId}
                aria-label={user.name ? `Profile, ${user.name}` : "Profile"}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-security-navy-900 font-display text-[11px] font-bold text-white">
                  {user.name?.charAt(0)?.toUpperCase() ?? "U"}
                </span>
                <span className="hidden max-w-[8rem] truncate text-xs font-medium sm:inline">
                  {user.name}
                </span>
                <svg className="hidden h-3 w-3 shrink-0 opacity-60 sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div
                ref={profilePopoverRef}
                id={profilePopoverId}
                popover="auto"
                onToggle={(e) => {
                  const nextState = (e.nativeEvent as ToggleEvent).newState;
                  setProfileOpen(nextState === "open");
                }}
                className="header-popover min-w-[220px] overflow-hidden rounded-security-lg border border-security-navy-100 bg-white py-1.5 text-left text-security-navy-900 shadow-security-elevated"
              >
                <div className="border-b border-security-navy-100 px-4 py-2.5">
                  <p className="text-sm font-semibold text-security-navy-900">{user.name}</p>
                  <p className="mt-0.5 text-xs text-security-navy-500">{accessDisplay}</p>
                </div>
                {canAccessRoute("/settings", user) && (
                  <Link
                    href="/settings"
                    onClick={() => profilePopoverRef.current?.hidePopover?.()}
                    className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium text-security-navy-700 no-underline transition-colors hover:bg-security-navy-50"
                  >
                    Settings
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => {
                    profilePopoverRef.current?.hidePopover?.();
                    logout();
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium text-security-navy-700 transition-colors hover:bg-security-navy-50"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </header>

        <main
          id="dashboard-main"
          className={clsx(
            "flex min-h-0 flex-1 flex-col box-border bg-[var(--bg-canvas)] overscroll-y-contain",
            isHomePage
              ? "overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-6"
              : clsx(
                  "px-4 py-4 sm:px-6 sm:py-6 lg:px-8",
                  isWhatsAppPage ? "overflow-hidden" : "overflow-y-auto"
                )
          )}
        >
          {hasAccess ? (
            isOverviewPage || isHomePage ? (
              <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">{children}</div>
            ) : (
              children
            )
          ) : null}
        </main>
      </div>
    </div>
  );
}
