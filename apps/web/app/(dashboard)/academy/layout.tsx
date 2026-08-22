"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { canAccessRoute } from "@/lib/permissions";
import { clsx } from "clsx";

const navItems: { href: string; label: string }[] = [
  { href: "/academy", label: "Dashboard" },
  { href: "/academy/profile", label: "Profile" },
  { href: "/academy/instructors", label: "Instructors" },
  { href: "/academy/training-sites", label: "Training sites" },
  { href: "/academy/classrooms", label: "Classrooms" },
  { href: "/academy/intake", label: "Intake" },
  { href: "/academy/students", label: "Students" },
  { href: "/academy/courses", label: "Courses" },
  { href: "/academy/course-runs", label: "Course runs" },
  { href: "/academy/enrolments", label: "Enrolments" },
  { href: "/academy/attendance", label: "Attendance" },
  { href: "/academy/assessments", label: "Assessments" },
  { href: "/academy/certificates", label: "Certificates" },
  { href: "/academy/compliance-documents", label: "Compliance docs" },
  { href: "/academy/policies", label: "Policies & SOPs" },
  { href: "/academy/renewals", label: "Renewals & alerts" },
  { href: "/academy/reports", label: "Reports" },
  { href: "/academy/audit", label: "Audit logs" },
  { href: "/academy/finance", label: "Finance" },
  { href: "/academy/invoices", label: "Invoices" },
  { href: "/academy/branches", label: "Branches" },
];

function NavGroup({
  isActive,
  children,
  href,
}: {
  isActive: boolean;
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-security-navy-50 text-security-navy-700 shadow-security-card"
          : "text-security-navy-600 hover:bg-security-navy-50 hover:text-security-navy-800"
      )}
    >
      {children}
    </Link>
  );
}

function iconDashboard() {
  return (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}

const icons: Record<string, React.ReactNode> = {
  "/academy": iconDashboard(),
  "/academy/intake": (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
      />
    </svg>
  ),
  "/academy/students": (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
  ),
  "/academy/courses": (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
      />
    </svg>
  ),
  "/academy/course-runs": (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  "/academy/enrolments": (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  ),
  "/academy/finance": (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
      />
    </svg>
  ),
  "/academy/invoices": (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  ),
  "/academy/branches": (
    <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
      />
    </svg>
  ),
};

function isNavActive(pathname: string, href: string) {
  if (href === "/academy") return pathname === "/academy" || pathname === "/academy/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AcademyLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const { user } = useAuth();
  const canReports = user ? canAccessRoute("/reports", user) : false;
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col gap-4 pb-2 lg:h-full lg:flex-row lg:items-stretch lg:gap-6 lg:pb-0">
      <div className="flex shrink-0 items-center justify-between gap-2 lg:hidden">
        <span className="text-sm font-semibold text-security-navy-800">Academy</span>
        <button
          type="button"
          className="btn-ghost px-3 py-1.5 text-xs"
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
          aria-controls="academy-side-nav"
        >
          {mobileOpen ? "Close" : "Menu"}
        </button>
      </div>

      <aside
        id="academy-side-nav"
        className={clsx(
          "flex w-full shrink-0 flex-col border border-security-navy-100 bg-white/90 shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
          "rounded-security-lg p-3",
          "max-lg:max-h-[min(32rem,70vh)] max-lg:overflow-y-auto",
          "lg:h-full lg:min-h-0 lg:max-w-[15rem] lg:overflow-hidden lg:self-stretch",
          !mobileOpen && "hidden",
          "lg:flex"
        )}
      >
        <div className="shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-security-navy-500">Academy</p>
        </div>
        <nav className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5 lg:min-h-0" aria-label="Academy">
          {navItems.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <NavGroup key={item.href} href={item.href} isActive={active}>
                {icons[item.href] ?? icons["/academy"]}
                <span>{item.label}</span>
              </NavGroup>
            );
          })}
          {canReports && (
            <NavGroup
              key="/reports"
              href="/reports"
              isActive={isNavActive(pathname, "/reports")}
            >
              <svg
                className="h-5 w-5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <span>Reports</span>
            </NavGroup>
          )}
        </nav>
        <div className="mt-3 shrink-0 rounded-lg border border-security-navy-100 bg-gradient-to-b from-security-navy-50 to-white p-2.5 lg:mt-auto">
          <p className="text-sm font-medium text-security-navy-800">Need help?</p>
          <p className="mt-1 text-xs text-security-navy-500">Module access and billing questions? Contact the company owner or an access manager.</p>
          <p className="mt-2 rounded-security border border-security-navy-100 bg-white px-3 py-2 text-xs text-security-navy-600">
            Ask the company owner or an access manager to update module access or billing details.
          </p>
        </div>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto [overflow-x:hidden] pr-0.5">{children}</div>
    </div>
  );
}
