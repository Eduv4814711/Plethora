"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
      <header>
        <Link href="/academy" className="link-inline text-sm font-semibold lg:hidden">
          ← Academy
        </Link>
        <p className="label-text mt-1">Module · Academy</p>
        <h1 className="page-title mt-1">Reports</h1>
        <p className="mt-1 max-w-xl text-sm text-black">
          Operational and compliance analytics with date-range filtering.
        </p>
      </header>

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="card-wireframe p-4 sm:p-5">
        <h2 className="section-title">Date range</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label>
            <span className="label-text mb-1 block">From</span>
            <input className="input-modern" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span className="label-text mb-1 block">To</span>
            <input className="input-modern" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="button" className="btn-secondary text-sm" onClick={load}>
            Apply filters
          </button>
        </div>
      </div>

      {data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(data).map(([k, v]) => (
            <div key={k} className="card-wireframe p-4">
              <p className="section-title">{k}</p>
              {typeof v === "object" && v != null && !Array.isArray(v) ? (
                <div className="mt-2 space-y-1 text-sm text-black">
                  {Object.entries(v as Record<string, unknown>).map(([innerKey, innerValue]) => (
                    <p key={innerKey} className="break-words">
                      <span className="font-semibold">{innerKey}: </span>
                      <span>{String(innerValue ?? "—")}</span>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-2 break-words text-sm font-semibold text-black">{String(v)}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card-wireframe p-6 text-sm text-black">
          {loading ? "Loading report metrics…" : "No report data available for this period."}
        </div>
      )}
    </div>
  );
}
