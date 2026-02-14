"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { clsx } from "clsx";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/employees", label: "Employees" },
  { href: "/sites", label: "Sites" },
  { href: "/rostering", label: "Rostering" },
  { href: "/attendance", label: "Attendance" },
  { href: "/payroll", label: "Payroll" },
  { href: "/reports", label: "Reports" },
  { href: "/audit", label: "Audit" },
  { href: "/settings", label: "Settings" },
];

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, loading } = useAuth();
  const { settings } = useSettings();
  const companyName = settings?.name ?? "Plethora";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-sm border border-neutral-300 dark:border-neutral-600 animate-pulse" />
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Loading</span>
        </div>
      </div>
    );
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  return (
    <div className="min-h-screen flex bg-neutral-50 dark:bg-neutral-950">
      <aside className="w-64 bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 flex flex-col shrink-0">
        <div className="p-5 border-b border-neutral-200 dark:border-neutral-800">
          <Link href="/" className="flex items-center gap-3">
            {settings?.logoUrl ? (
              <img src={settings.logoUrl} alt="" className="w-10 h-10 rounded-sm object-cover border border-neutral-200 dark:border-neutral-700" />
            ) : (
              <div className="w-10 h-10 rounded-sm border border-neutral-300 dark:border-neutral-600 flex items-center justify-center bg-white dark:bg-neutral-900">
                <span className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{companyName.charAt(0)}</span>
              </div>
            )}
            <span className="text-lg font-bold text-neutral-900 dark:text-neutral-100 tracking-tight truncate">
              {companyName}
            </span>
          </Link>
        </div>
        <nav className="flex-1 p-4 space-y-0 overflow-y-auto">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400 dark:text-neutral-500 px-4 py-2">
            Navigation
          </div>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center px-4 py-2.5 text-sm font-medium transition-colors border-l-2 -ml-px",
                pathname === item.href
                  ? "border-neutral-900 dark:border-neutral-100 bg-neutral-100 dark:bg-neutral-800/50 text-neutral-900 dark:text-neutral-100"
                  : "border-transparent text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800/30 hover:text-neutral-900 dark:hover:text-neutral-100"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <div className="relative">
              <input
                type="search"
                placeholder="Search..."
                className="w-72 pl-10 pr-4 py-2 rounded-sm border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-sm placeholder-neutral-400 focus:ring-2 focus:ring-neutral-400 focus:border-neutral-500 outline-none"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 rounded-sm border border-transparent text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </button>
            <div className="flex items-center gap-3 pl-4 border-l border-neutral-200 dark:border-neutral-700">
              <div className="w-9 h-9 rounded-sm border border-neutral-300 dark:border-neutral-600 flex items-center justify-center text-neutral-900 dark:text-neutral-100 font-semibold text-sm bg-white dark:bg-neutral-900">
                {user.name.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{user.name}</p>
                <p className="text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{user.role.replace(/_/g, " ")}</p>
              </div>
              <button
                onClick={logout}
                className="ml-2 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border border-neutral-300 dark:border-neutral-600 hover:border-neutral-400 dark:hover:border-neutral-500 rounded-sm transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
