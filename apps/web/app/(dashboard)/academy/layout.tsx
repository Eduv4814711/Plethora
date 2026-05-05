"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { canAccessRoute } from "@/lib/permissions";
import { clsx } from "clsx";

type NavItem = { href: string; label: string; iconKey: IconKey };
type NavSection = { id: string; label: string; items: NavItem[] };
type IconKey =
  | "dashboard"
  | "students"
  | "intake"
  | "courses"
  | "courseRuns"
  | "enrolments"
  | "attendance"
  | "assessments"
  | "certificates"
  | "compliance"
  | "policies"
  | "renewals"
  | "reports"
  | "activity"
  | "finance"
  | "instructors"
  | "trainingSites"
  | "classrooms"
  | "branches"
  | "profile"
  | "moduleSettings";

const SECTIONS: NavSection[] = [
  {
    id: "insights",
    label: "Insights",
    items: [
      { href: "/academy", label: "Dashboard", iconKey: "dashboard" },
      { href: "/academy/activity", label: "Activity & audit", iconKey: "activity" },
      { href: "/academy/reports", label: "Reports", iconKey: "reports" },
    ],
  },
  {
    id: "people",
    label: "People",
    items: [
      { href: "/academy/students", label: "Students", iconKey: "students" },
      { href: "/academy/intake", label: "Intake", iconKey: "intake" },
      { href: "/academy/instructors", label: "Instructors", iconKey: "instructors" },
    ],
  },
  {
    id: "catalogue",
    label: "Catalogue",
    items: [
      { href: "/academy/courses", label: "Courses", iconKey: "courses" },
      { href: "/academy/course-runs", label: "Course runs", iconKey: "courseRuns" },
      { href: "/academy/enrolments", label: "Enrolments", iconKey: "enrolments" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { href: "/academy/attendance", label: "Attendance", iconKey: "attendance" },
      { href: "/academy/assessments", label: "Assessments", iconKey: "assessments" },
      { href: "/academy/certificates", label: "Certificates", iconKey: "certificates" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    items: [
      { href: "/academy/compliance-documents", label: "Compliance docs", iconKey: "compliance" },
      { href: "/academy/policies", label: "Policies & SOPs", iconKey: "policies" },
      { href: "/academy/renewals", label: "Renewals & alerts", iconKey: "renewals" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [{ href: "/academy/finance", label: "Finance", iconKey: "finance" }],
  },
  {
    id: "setup",
    label: "Setup",
    items: [
      { href: "/settings?tab=academy", label: "Module settings", iconKey: "moduleSettings" },
      { href: "/academy/profile", label: "Academy profile", iconKey: "profile" },
      { href: "/academy/branches", label: "Branches", iconKey: "branches" },
      { href: "/academy/training-sites", label: "Training sites", iconKey: "trainingSites" },
      { href: "/academy/classrooms", label: "Classrooms", iconKey: "classrooms" },
    ],
  },
];

function NavIcon({ name }: { name: IconKey }) {
  const common = "h-[18px] w-[18px] shrink-0";
  switch (name) {
    case "dashboard":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13l9-9 9 9M5 11v9a1 1 0 001 1h3v-7h6v7h3a1 1 0 001-1v-9" />
        </svg>
      );
    case "activity":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h3l2-6 4 12 2-6h5" />
        </svg>
      );
    case "reports":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5m0 14h16M8 15v-4m4 4V9m4 6v-2" />
        </svg>
      );
    case "students":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 14a4 4 0 10-8 0M12 7a3 3 0 110 6 3 3 0 010-6zm-9 14a9 9 0 0118 0H3z" />
        </svg>
      );
    case "intake":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
        </svg>
      );
    case "instructors":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 12a4 4 0 100-8 4 4 0 000 8zm6 9v-1a6 6 0 00-12 0v1m9-3l3 3m0 0l3-3m-3 3v-6" />
        </svg>
      );
    case "courses":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13M12 6.253C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5s3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18s-3.332.477-4.5 1.253" />
        </svg>
      );
    case "courseRuns":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3M5 11h14M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case "enrolments":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "attendance":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      );
    case "assessments":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-5m-1.41-8.41a2 2 0 112.83 2.83L11.83 14H9v-2.83l5.59-5.58z" />
        </svg>
      );
    case "certificates":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 21l2-3 2 1 2-1 2 3" />
        </svg>
      );
    case "compliance":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case "policies":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253" />
        </svg>
      );
    case "renewals":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5m11 11v-5h-5M5.5 14a8 8 0 0014 4M18.5 10a8 8 0 00-14-4" />
        </svg>
      );
    case "finance":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "trainingSites":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 11a3 3 0 100-6 3 3 0 000 6zm0 11s7-7.13 7-12A7 7 0 105 10c0 4.87 7 12 7 12z" />
        </svg>
      );
    case "classrooms":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10l9-7 9 7M5 9v11a1 1 0 001 1h12a1 1 0 001-1V9M9 21v-6h6v6" />
        </svg>
      );
    case "branches":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16M9 7h1m4 0h1M9 11h1m4 0h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5M3 21h18" />
        </svg>
      );
    case "profile":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case "moduleSettings":
      return (
        <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"
          />
        </svg>
      );
  }
}

function isNavActive(pathname: string, href: string) {
  const base = href.split("?")[0] ?? href;
  if (base === "/academy") return pathname === "/academy" || pathname === "/academy/";
  return pathname === base || pathname.startsWith(`${base}/`);
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "relative flex min-h-10 items-center gap-2.5 rounded-security px-2.5 py-1.5 text-sm font-medium transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-security-navy-300 focus-visible:ring-offset-1",
        active
          ? "bg-security-navy-100 text-black border border-security-navy-400 font-semibold shadow-security-card"
          : "text-black border border-transparent hover:bg-[var(--bg-nav-hover)] hover:border-[var(--hairline)]"
      )}
    >
      <NavIcon name={item.iconKey} />
      <span className="truncate">{item.label}</span>
      {active && (
        <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-security-navy-600" />
      )}
    </Link>
  );
}

export default function AcademyLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const { user } = useAuth();
  const canSettlementReports = user ? canAccessRoute("/reports", user.role, user.moduleAccess) : false;
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col gap-4 pb-2 lg:h-full lg:flex-row lg:items-stretch lg:gap-6 lg:pb-0">
      {/* Mobile top bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 lg:hidden">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-security-lg bg-security-navy-500 text-white shadow-security-card">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422a12 12 0 01.665 5.516A11.95 11.95 0 0112 18.057a11.95 11.95 0 01-6.824-1.962 12 12 0 01.665-5.515L12 14z" />
            </svg>
          </span>
          <span className="text-base font-semibold tracking-tight text-black">Academy</span>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
          aria-controls="academy-side-nav"
        >
          {mobileOpen ? "Close" : "Menu"}
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={closeMobile}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        id="academy-side-nav"
        className={clsx(
          "card-wireframe flex w-full shrink-0 flex-col p-3",
          // Mobile: slide-in drawer
          "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:w-[80vw] max-lg:max-w-xs max-lg:overflow-y-auto max-lg:rounded-none max-lg:border-r max-lg:shadow-security-elevated max-lg:transition-transform max-lg:duration-200",
          mobileOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full",
          // Desktop: sticky sidebar
          "lg:flex lg:h-full lg:min-h-0 lg:w-[16rem] lg:max-w-[16rem] lg:translate-x-0 lg:overflow-hidden lg:self-stretch lg:p-4"
        )}
      >
        <div className="flex shrink-0 items-center gap-2.5 px-1 pb-3">
          <span aria-hidden className="inline-flex h-9 w-9 items-center justify-center rounded-security-lg bg-gradient-to-br from-security-navy-500 to-security-navy-600 text-white shadow-security-card">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422a12 12 0 01.665 5.516A11.95 11.95 0 0112 18.057a11.95 11.95 0 01-6.824-1.962 12 12 0 01.665-5.515L12 14z" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-black">Academy</p>
            <p className="text-[11px] uppercase tracking-wider text-black/70">Training & compliance</p>
          </div>
        </div>

        <div className="-mx-1 mb-2 h-px bg-[var(--hairline)]" aria-hidden />

        <nav
          className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5 lg:min-h-0"
          aria-label="Academy navigation"
        >
          {SECTIONS.map((section) => (
            <div key={section.id}>
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-black/60">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={isNavActive(pathname, item.href)}
                    onNavigate={closeMobile}
                  />
                ))}
              </div>
            </div>
          ))}

          {canSettlementReports && (
            <div>
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-black/60">
                Cross-module
              </p>
              <NavLink
                item={{ href: "/reports", label: "Company reports", iconKey: "reports" }}
                active={isNavActive(pathname, "/reports")}
                onNavigate={closeMobile}
              />
            </div>
          )}
        </nav>

        <div className="mt-3 shrink-0 card-feature-orange p-3">
          <p className="text-sm font-semibold text-black">Need help?</p>
          <p className="mt-1 text-xs leading-relaxed text-black">
            Module access and billing questions? Contact an administrator.
          </p>
          <button type="button" className="btn-secondary mt-3 w-full text-xs">
            Contact support
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h4m0 0v4m0-4l-6 6" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h3a2 2 0 012 2v3" />
            </svg>
          </button>
        </div>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto [overflow-x:hidden] pr-0.5">{children}</div>
    </div>
  );
}
