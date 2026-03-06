"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { canAccessRoute } from "@/lib/permissions";

interface DashboardData {
  guardsOnDuty: number;
  activeSitesCount: number;
  payrollStatus: Record<string, number>;
  alerts: { type: string; message: string; count?: number }[];
}

export default function DashboardPage() {
  const { token, user } = useAuth();
  const canAccessSites = user ? canAccessRoute("/sites", user.role) : false;
  const canAccessRostering = user ? canAccessRoute("/rostering", user.role) : false;
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
        <div className="h-9 bg-white border-2 border-black rounded-[10px] w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 bg-white border-[3px] border-black rounded-[10px]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <h1 className="page-title mb-1">Dashboard</h1>
      <p className="text-sm text-black mb-8">
        Overview of your workforce operations
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        {canAccessRostering && (
          <Link
            href="/rostering"
            className="card-elevated group overflow-hidden block"
          >
            <div className="bg-wireframe-accent p-4 border-b-2 border-black">
              <div className="text-xs font-semibold uppercase tracking-wider text-black">
                Guards on Duty
              </div>
            </div>
            <div className="p-6">
              <div className="text-3xl font-bold text-black">
                {data?.guardsOnDuty ?? 0}
              </div>
            </div>
          </Link>
        )}

        {canAccessSites && (
          <Link
            href="/sites"
            className="card-elevated group overflow-hidden block"
          >
            <div className="bg-wireframe-accent p-4 border-b-2 border-black">
              <div className="text-xs font-semibold uppercase tracking-wider text-black">
                Active Sites
              </div>
            </div>
            <div className="p-6">
              <div className="text-3xl font-bold text-black">
                {data?.activeSitesCount ?? 0}
              </div>
            </div>
          </Link>
        )}

        <Link
          href="/payroll"
          className="card-elevated group overflow-hidden block"
        >
          <div className="bg-wireframe-accent p-4 border-b-2 border-black">
            <div className="text-xs font-semibold uppercase tracking-wider text-black">
              Payroll Status
            </div>
          </div>
          <div className="p-6">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="badge-neutral">Draft: {data?.payrollStatus?.draft ?? 0}</span>
              <span className="badge-warning">Calc: {data?.payrollStatus?.calculated ?? 0}</span>
              <span className="badge-success">Paid: {data?.payrollStatus?.paid ?? 0}</span>
            </div>
          </div>
        </Link>

        <div className="card-wireframe overflow-hidden">
          <div className="bg-wireframe-accent p-4 border-b-2 border-black">
            <div className="text-xs font-semibold uppercase tracking-wider text-black">
              Alerts
            </div>
          </div>
          <div className="p-6">
            {data?.alerts?.length ? (
              <ul className="space-y-2 text-sm">
                {data.alerts.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-black">
                    <span className="w-2 h-2 rounded-full bg-black" />
                    {a.type === "missed_shifts" ? (
                      <Link
                        href="/attendance"
                        className="underline underline-offset-2 hover:text-black transition-colors"
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
              <span className="text-sm text-black">No alerts</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
