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
        <Link href="/academy" className="text-sm text-primary hover:underline lg:hidden">
          ← Academy
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-security-navy-900">Activity</h1>
        <p className="text-sm text-base-content/70">Recent changes across students, enrolments, invoices, and payments.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error" role="alert">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      {loading && items.length === 0 ? (
        <ul className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="h-16 animate-pulse rounded-xl bg-base-200/60" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="text-sm text-base-content/50">No activity yet.</p>
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
