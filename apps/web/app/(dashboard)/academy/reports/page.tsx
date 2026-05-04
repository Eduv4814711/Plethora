"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

export default function AcademyReportsPage() {
  const { token } = useAuth();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    academyApi
      .getReportsDashboard(token, { from: from || undefined, to: to || undefined })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  return (
    <div className="module-shell">
      <div>
        <h1 className="page-title">Reports</h1>
        <p className="mt-1 text-sm text-black">Operational and compliance analytics with date-range filtering.</p>
      </div>

      {error && <div className="rounded-lg border-2 border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-sm text-black">Date range</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-sm text-black">From</span>
            <input className="input-modern" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-sm text-black">To</span>
            <input className="input-modern" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn-secondary rounded-security-lg" onClick={load}>Apply filters</button>
        </div>
      </div>

      {data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(data).map(([k, v]) => (
            <div key={k} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-sm text-black">{k}</p>
              {typeof v === "object" && v != null && !Array.isArray(v) ? (
                <div className="mt-2 space-y-1 text-sm text-security-navy-900">
                  {Object.entries(v as Record<string, unknown>).map(([innerKey, innerValue]) => (
                    <p key={innerKey} className="break-words">
                      <span className="font-medium">{innerKey}: </span>
                      <span>{String(innerValue ?? "—")}</span>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-2 break-words text-sm font-semibold text-security-navy-900">{String(v)}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-black shadow-sm">
          {loading ? "Loading report metrics..." : "No report data available for this period."}
        </div>
      )}
    </div>
  );
}
