"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AcademyActivityRow, type AcademyActivityItem } from "@/components/academy-activity";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

const PAGE_LIMIT = 60;

export default function AcademyActivityPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<AcademyActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    academyApi
      .getActivity(token, { limit: PAGE_LIMIT })
      .then((res) => {
        setItems(
          res.items.map((a) => ({
            id: a.id,
            at: a.at,
            label: a.label,
            userName: a.userName,
            link: a.link,
          }))
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [token]);

  return (
    <div className="w-full min-w-0 space-y-4">
      <div>
        <Link href="/academy" className="text-sm text-security-navy-700 hover:underline lg:hidden">
          ← Academy
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-security-navy-900">Activity</h1>
        <p className="text-sm text-security-navy-600">Recent changes across students, enrolments, invoices, and payments.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      {loading && items.length === 0 ? (
        <ul className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="h-16 animate-pulse rounded-security-lg bg-security-navy-50" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="text-sm text-security-navy-500">No activity yet.</p>
      ) : (
        <ul className="max-w-3xl space-y-2">
          {items.map((a) => (
            <li key={a.id}>
              <AcademyActivityRow item={a} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
