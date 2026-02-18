"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";

interface DashboardData {
  guardsOnDuty: number;
  activeSitesCount: number;
  payrollStatus: Record<string, number>;
  alerts: { type: string; message: string; count?: number }[];
}

export default function DashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    authFetch("/dashboard", token)
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-9 border border-black dark:border-white rounded-sm w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 border border-dashed border-black dark:border-white rounded-sm" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-1 tracking-tight">
        Dashboard
      </h1>
      <p className="text-[10px] uppercase tracking-widest text-neutral-500 dark:text-neutral-400 mb-8">
        Overview of your workforce operations
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <Link
          href="/rostering"
          className="group p-6 bg-white dark:bg-neutral-900 rounded-sm border border-black dark:border-white hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-sm border border-black dark:border-white flex items-center justify-center">
              <svg className="w-6 h-6 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
            Guards on Duty
          </div>
          <div className="text-3xl font-bold text-neutral-900 dark:text-neutral-100 mt-1">
            {data?.guardsOnDuty ?? 0}
          </div>
        </Link>

        <Link
          href="/sites"
          className="group p-6 bg-white dark:bg-neutral-900 rounded-sm border border-black dark:border-white hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-sm border border-black dark:border-white flex items-center justify-center">
              <svg className="w-6 h-6 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
            Active Sites
          </div>
          <div className="text-3xl font-bold text-neutral-900 dark:text-neutral-100 mt-1">
            {data?.activeSitesCount ?? 0}
          </div>
        </Link>

        <Link
          href="/payroll"
          className="group p-6 bg-white dark:bg-neutral-900 rounded-sm border border-black dark:border-white hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-sm border border-black dark:border-white flex items-center justify-center">
              <svg className="w-6 h-6 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
            Payroll Status
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-sm">
            <span className="px-2 py-0.5 rounded-sm border border-black dark:border-white text-neutral-700 dark:text-neutral-300 text-xs">Draft: {data?.payrollStatus?.draft ?? 0}</span>
            <span className="px-2 py-0.5 rounded-sm border border-black dark:border-white text-neutral-700 dark:text-neutral-300 text-xs">Calc: {data?.payrollStatus?.calculated ?? 0}</span>
            <span className="px-2 py-0.5 rounded-sm border border-black dark:border-white text-neutral-700 dark:text-neutral-300 text-xs">Paid: {data?.payrollStatus?.paid ?? 0}</span>
          </div>
        </Link>

        <div className="p-6 bg-white dark:bg-neutral-900 rounded-sm border border-black dark:border-white">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-sm border border-black dark:border-white flex items-center justify-center">
              <svg className="w-6 h-6 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
            Alerts
          </div>
          <div className="mt-1">
            {data?.alerts?.length ? (
              <ul className="space-y-2 text-sm">
                {data.alerts.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
                    <span className="w-1.5 h-1.5 border border-black dark:border-white" />
                    {a.type === "missed_shifts" ? (
                      <Link
                        href="/attendance"
                        className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
                      >
                        {a.message} {a.count != null && `(${a.count})`}
                      </Link>
                    ) : (
                      <>
                        {a.message} {a.count != null && `(${a.count})`}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-sm text-neutral-500 dark:text-neutral-400">No alerts</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Link href="/rostering" className="btn-primary">
          Rostering
        </Link>
        <Link href="/payroll" className="btn-secondary">
          Payroll
        </Link>
      </div>
    </div>
  );
}
