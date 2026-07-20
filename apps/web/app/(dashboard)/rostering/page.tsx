"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  fetchRosterContinuityOverview,
  type RosterContinuityOverview,
  type RosterContinuityOverviewSite,
  type RosterContinuityState,
} from "@/lib/roster-api";
import {
  filterRosterOperationsSites,
  rosterSiteActionLabel,
  type RosterStatusFilter,
} from "@/lib/roster-operations-utils";

const STATUS_COPY: Record<RosterContinuityState, { label: string; className: string }> = {
  needs_attention: {
    label: "Needs attention",
    className: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800",
  },
  running: {
    label: "Running",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800",
  },
  not_setup: {
    label: "Not set up",
    className: "bg-neutral-100 text-neutral-700 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-neutral-700",
  },
  paused: {
    label: "Paused",
    className: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-800",
  },
};

function displayDate(value: string | null | undefined): string {
  if (!value) return "Preparing future shifts";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));
}

function StatusBadge({ state }: { state: RosterContinuityState }) {
  const copy = STATUS_COPY[state];
  return (
    <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${copy.className}`}>
      {copy.label}
    </span>
  );
}

function siteStatusLine(site: RosterContinuityOverviewSite): string {
  if (site.state === "running") {
    if (site.maintainedThrough) return `Running through ${displayDate(site.maintainedThrough)}`;
    return site.lastStatus === "failed" ? "Automatic update failed" : "Preparing future shifts";
  }
  if (site.state === "needs_attention") return site.nextIssue?.message ?? "Roster needs manager review";
  if (site.state === "paused") return "Automatic rostering is paused";
  return "Ready for a manager to review and set up";
}

export default function RosteringOperationsPage() {
  const { token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [overview, setOverview] = useState<RosterContinuityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RosterStatusFilter>("all");
  const [query, setQuery] = useState("");

  const legacySiteId = searchParams.get("siteId");

  const load = useCallback(async (quiet = false) => {
    if (!token) return;
    quiet ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setOverview(await fetchRosterContinuityOverview(token));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load rostering operations.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    if (legacySiteId) {
      router.replace(`/rostering/sites/${legacySiteId}`);
      return;
    }
    void load();
  }, [legacySiteId, load, router]);

  useEffect(() => {
    if (!token || legacySiteId) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [legacySiteId, load, token]);

  const filteredSites = useMemo(() => {
    return filterRosterOperationsSites(overview?.sites ?? [], filter, query);
  }, [filter, overview?.sites, query]);

  const interruptions = useMemo(
    () => (overview?.sites ?? []).filter((site) => site.issueCount > 0),
    [overview?.sites]
  );

  if (legacySiteId || (loading && !overview)) {
    return (
      <div className="space-y-5 animate-pulse" aria-label="Loading rostering operations">
        <div className="h-16 rounded-xl bg-neutral-200 dark:bg-neutral-800" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-24 rounded-xl bg-neutral-200 dark:bg-neutral-800" />)}
        </div>
        <div className="h-80 rounded-xl bg-neutral-200 dark:bg-neutral-800" />
      </div>
    );
  }

  const filters: Array<{ id: RosterStatusFilter; label: string; count: number }> = [
    { id: "all", label: "All sites", count: overview?.summary.total ?? 0 },
    { id: "needs_attention", label: "Needs attention", count: overview?.summary.needsAttention ?? 0 },
    { id: "running", label: "Running", count: overview?.summary.running ?? 0 },
    { id: "not_setup", label: "Not set up", count: overview?.summary.notSetup ?? 0 },
    { id: "paused", label: "Paused", count: overview?.summary.paused ?? 0 },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-orange-700 dark:text-orange-300">Operations</p>
          <h1 className="page-title mt-1">Rostering</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
            See which sites are covered, resolve interruptions, and keep approved schedules running.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="btn-secondary self-start disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh status"}
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          <p className="font-semibold">Rostering status could not be loaded</p>
          <p className="mt-1">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-3 btn-secondary">Try again</button>
        </div>
      )}

      {overview && (
        <>
          <section aria-label="Roster status summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {filters.slice(1).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`rounded-2xl border p-4 text-left shadow-sm transition-colors ${
                  filter === item.id
                    ? "border-orange-400 bg-orange-50 ring-2 ring-orange-100 dark:border-orange-600 dark:bg-orange-950/30 dark:ring-orange-900/50"
                    : "border-neutral-200 bg-white hover:border-orange-200 dark:border-neutral-700 dark:bg-neutral-900"
                }`}
                aria-pressed={filter === item.id}
              >
                <span className="text-3xl font-bold text-neutral-900 dark:text-white">{item.count}</span>
                <span className="mt-1 block text-sm font-medium text-neutral-600 dark:text-neutral-300">{item.label}</span>
              </button>
            ))}
          </section>

          {interruptions.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/50 dark:border-amber-900/70 dark:bg-amber-950/20">
              <div className="border-b border-amber-200 px-4 py-3 dark:border-amber-900/70 sm:px-5">
                <h2 className="text-base font-semibold text-amber-950 dark:text-amber-100">Interruption queue</h2>
                <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">Most urgent coverage problems appear first.</p>
              </div>
              <div className="divide-y divide-amber-200 dark:divide-amber-900/60">
                {interruptions.slice(0, 6).map((site) => (
                  <Link
                    key={site.siteId}
                    href={`/rostering/sites/${site.siteId}${site.nextIssue ? `?issue=${site.nextIssue.id}` : ""}`}
                    className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-amber-100/60 dark:hover:bg-amber-950/40 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-neutral-900 dark:text-white">{site.siteName}</p>
                        {site.criticalIssueCount > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300">Urgent</span>}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-sm text-neutral-700 dark:text-neutral-300">{site.nextIssue?.message}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-orange-800 dark:text-orange-300">Review issue →</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">All site rosters</h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Open a site to view its schedule or take action.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative min-w-0 sm:w-72">
                  <span className="sr-only">Search sites</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search sites…"
                    className="input-modern w-full"
                  />
                </label>
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as RosterStatusFilter)}
                  className="input-modern sm:w-48"
                  aria-label="Filter sites by roster status"
                >
                  {filters.map((item) => <option key={item.id} value={item.id}>{item.label} ({item.count})</option>)}
                </select>
              </div>
            </div>

            {filteredSites.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-14 text-center dark:border-neutral-700 dark:bg-neutral-900">
                <p className="font-semibold text-neutral-800 dark:text-neutral-200">No sites match this view</p>
                <p className="mt-1 text-sm text-neutral-500">Clear the search or choose another status.</p>
                <button type="button" onClick={() => { setFilter("all"); setQuery(""); }} className="mt-4 btn-secondary">Show all sites</button>
              </div>
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {filteredSites.map((site) => (
                    <Link key={site.siteId} href={`/rostering/sites/${site.siteId}`} className="block rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><h3 className="font-semibold text-neutral-900 dark:text-white">{site.siteName}</h3><p className="mt-1 text-xs text-neutral-500">{site.guardCount} guard{site.guardCount === 1 ? "" : "s"} · {site.calendar.name}</p></div>
                        <StatusBadge state={site.state} />
                      </div>
                      <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">{siteStatusLine(site)}</p>
                      <span className="mt-4 block text-sm font-semibold text-orange-700 dark:text-orange-300">{rosterSiteActionLabel(site)} →</span>
                    </Link>
                  ))}
                </div>

                <div className="hidden overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900 md:block">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wider text-neutral-500 dark:bg-neutral-900/80 dark:text-neutral-400">
                      <tr><th className="px-5 py-3 font-semibold">Site</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Coverage horizon</th><th className="px-4 py-3 font-semibold">Team</th><th className="px-5 py-3 text-right font-semibold">Next action</th></tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                      {filteredSites.map((site) => (
                        <tr key={site.siteId} className="hover:bg-neutral-50/80 dark:hover:bg-neutral-800/40">
                          <td className="px-5 py-4"><p className="font-semibold text-neutral-900 dark:text-white">{site.siteName}</p><p className="mt-0.5 text-xs text-neutral-500">{site.calendar.name}</p></td>
                          <td className="px-4 py-4"><StatusBadge state={site.state} />{site.issueCount > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{site.issueCount} open issue{site.issueCount === 1 ? "" : "s"}</p>}</td>
                          <td className="px-4 py-4 text-neutral-700 dark:text-neutral-300">{site.state === "running" ? displayDate(site.maintainedThrough) : siteStatusLine(site)}</td>
                          <td className="px-4 py-4 text-neutral-700 dark:text-neutral-300">{site.guardCount} guard{site.guardCount === 1 ? "" : "s"}</td>
                          <td className="px-5 py-4 text-right"><Link href={`/rostering/sites/${site.siteId}`} className="font-semibold text-orange-700 hover:underline dark:text-orange-300">{rosterSiteActionLabel(site)} →</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
