"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { DateInput } from "@/components/date-input";
import {
  SiteShiftRosterSheet,
  type MatrixDay,
  type MatrixRow,
} from "@/components/rostering/SiteShiftRosterSheet";

interface Site {
  id: string;
  name: string;
}

interface MatrixPayload {
  site: { id: string; name: string };
  periodLabel: string;
  siteRules: string | null;
  days: MatrixDay[];
  rows: MatrixRow[];
}

function MatrixPageInner() {
  const { token, user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const qpSite = searchParams.get("siteId") ?? "";

  const now = new Date();
  const [periodStart, setPeriodStart] = useState(() => format(startOfMonth(now), "yyyy-MM-dd"));
  const [periodEnd, setPeriodEnd] = useState(() => format(endOfMonth(now), "yyyy-MM-dd"));
  const [sites, setSites] = useState<Site[]>([]);
  const [activeSiteId, setActiveSiteId] = useState("");
  const [matrix, setMatrix] = useState<MatrixPayload | null>(null);
  const [loadingSites, setLoadingSites] = useState(true);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoadingSites(true);
    authFetch("/sites?limit=100", token)
      .then((r) => r.json())
      .then((data) => {
        const list: Site[] = data.data || [];
        list.sort((a, b) => a.name.localeCompare(b.name));
        setSites(list);
        if (qpSite && list.some((s) => s.id === qpSite)) {
          setActiveSiteId(qpSite);
        } else if (list.length > 0) {
          setActiveSiteId(list[0]!.id);
        }
      })
      .catch(() => setError("Failed to load sites"))
      .finally(() => setLoadingSites(false));
  }, [token, qpSite]);

  const syncUrl = useCallback(
    (siteId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (siteId) params.set("siteId", siteId);
      else params.delete("siteId");
      router.replace(`/rostering/matrix?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const onSelectSite = (siteId: string) => {
    setActiveSiteId(siteId);
    syncUrl(siteId);
  };

  useEffect(() => {
    if (!token || !activeSiteId) {
      setMatrix(null);
      return;
    }
    const start = periodStart.slice(0, 10);
    const end = periodEnd.slice(0, 10);
    let cancelled = false;
    setLoadingMatrix(true);
    setError(null);
    const q = new URLSearchParams({ siteId: activeSiteId, startDate: start, endDate: end });
    authFetch(`/shifts/site-matrix?${q}`, token)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.message || data.error || "Failed to load roster matrix");
        return data as MatrixPayload;
      })
      .then((data) => {
        if (!cancelled) setMatrix(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load roster matrix");
      })
      .finally(() => {
        if (!cancelled) setLoadingMatrix(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, activeSiteId, periodStart, periodEnd]);

  if (!token) {
    return null;
  }

  if (loadingSites) {
    return (
      <div className="animate-pulse max-w-[1328px] mx-auto p-6 space-y-4">
        <div className="h-10 bg-neutral-200 dark:bg-neutral-700 rounded w-64" />
        <div className="h-96 bg-neutral-200 dark:bg-neutral-700 rounded-lg" />
      </div>
    );
  }

  if (sites.length === 0) {
    return (
      <div className="max-w-[1328px] mx-auto p-6 space-y-4">
        <Link href="/rostering" className="text-sm font-medium text-neutral-600 hover:underline">
          ← Roster calendar
        </Link>
        <p className="text-neutral-600 dark:text-neutral-400">No sites yet. Add a site first.</p>
        <Link href="/sites" className="btn-primary inline-block text-center">
          Go to Sites
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 mb-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 max-w-[1328px] mx-auto px-4">
        <div>
          <Link href="/rostering" className="text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:underline">
            ← Roster calendar
          </Link>
          <h1 className="page-title mt-2">Site shift roster</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            Matrix view by site. Edits are done from the roster calendar or attendance.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-500 mb-1">From</label>
            <DateInput value={periodStart} onChange={setPeriodStart} className="input-modern" />
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-500 mb-1">To</label>
            <DateInput value={periodEnd} onChange={setPeriodEnd} className="input-modern" />
          </div>
        </div>
      </div>

      {error && (
        <div className="max-w-[1328px] mx-auto px-4 p-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {loadingMatrix && (
        <div className="max-w-[1328px] mx-auto px-4 text-sm text-neutral-500">Loading roster…</div>
      )}

      {!loadingMatrix && matrix && (
        <SiteShiftRosterSheet
          siteName={matrix.site.name}
          periodLabel={matrix.periodLabel}
          siteRules={matrix.siteRules}
          days={matrix.days}
          rows={matrix.rows}
          sites={sites}
          activeSiteId={activeSiteId}
          onSelectSite={onSelectSite}
          pdfGeneratedBy={user ? `${user.name} (${user.email})` : null}
        />
      )}
    </div>
  );
}

export default function RosteringMatrixPage() {
  return (
    <Suspense
      fallback={
        <div className="animate-pulse max-w-[1328px] mx-auto p-6 h-96 bg-neutral-100 dark:bg-neutral-800 rounded-lg" />
      }
    >
      <MatrixPageInner />
    </Suspense>
  );
}
