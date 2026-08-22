"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { fetchRosterContinuityStatus, type RosterContinuityStatus } from "@/lib/roster-api";
import { OneDayChangeModal } from "../../OneDayChangeModal";
import { RosterContinuityPanel } from "../../RosterContinuityPanel";
import { RosterScheduleView } from "../../RosterScheduleView";

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function statusHeadline(status: RosterContinuityStatus): string {
  if (status.state === "not_setup") return "Set up roster";
  if (status.state === "paused") return "Automatic rostering is paused";
  if (status.state === "needs_attention") return "Roster needs attention";
  if (status.maintainedThrough) return `Running through ${displayDate(status.maintainedThrough)}`;
  if (status.lastStatus === "failed") return "Automatic update failed";
  return "Preparing future shifts";
}

const BADGE_STYLES: Record<string, string> = {
  running: "bg-security-emerald-50 text-security-emerald-700 ring-security-emerald-200 dark:bg-security-emerald-700/40 dark:text-security-emerald-200 dark:ring-security-emerald-700",
  needs_attention: "bg-security-amber-50 text-security-amber-800 ring-security-amber-200 dark:bg-security-amber-950/40 dark:text-security-amber-200 dark:ring-security-amber-800",
  paused: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-800",
  not_setup: "bg-security-navy-50 text-security-navy-700 ring-security-navy-100 dark:bg-security-navy-800 dark:text-security-navy-200 dark:ring-security-navy-700",
};

export default function RosterSiteWorkspacePage() {
  const params = useParams<{ siteId: string }>();
  const searchParams = useSearchParams();
  const { token } = useAuth();
  const siteId = params.siteId;
  const tab = searchParams.get("tab") === "schedule" ? "schedule" : "overview";
  const [status, setStatus] = useState<RosterContinuityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [oneDayOpen, setOneDayOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closeOneDayChange = useCallback(() => setOneDayOpen(false), []);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try { setStatus(await fetchRosterContinuityStatus(token, siteId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load this site roster."); }
    finally { setLoading(false); }
  }, [siteId, token]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const issueId = searchParams.get("issue");
    if (!status || !issueId) return;
    const target = document.getElementById(`roster-issue-${issueId}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus({ preventScroll: true });
  }, [searchParams, status]);

  if (loading && !status) {
    return <div className="space-y-4 animate-pulse"><div className="h-24 rounded-2xl bg-security-navy-100 dark:bg-security-navy-800" /><div className="h-72 rounded-2xl bg-security-navy-100 dark:bg-security-navy-800" /></div>;
  }

  if (!status || error) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"><h1 className="text-lg font-semibold">Site roster could not be opened</h1><p className="mt-2 text-sm">{error ?? "Site not found"}</p><div className="mt-4 flex gap-2"><button type="button" onClick={() => { setLoading(true); void load(); }} className="btn-secondary">Try again</button><Link href="/rostering" className="btn-secondary">Back to Rostering</Link></div></div>;
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="rounded-2xl border border-security-navy-100 bg-white p-4 shadow-security-card dark:border-security-navy-700 dark:bg-security-navy-900 sm:p-5">
        <Link href="/rostering" className="text-sm font-medium text-security-amber-700 hover:underline dark:text-security-amber-300">← All site rosters</Link>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold text-security-navy-900 dark:text-white">{status.siteName}</h1><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${BADGE_STYLES[status.state]}`}>{statusHeadline(status)}</span></div><p className="mt-2 text-sm text-security-navy-500">{status.guardCount} guard{status.guardCount === 1 ? "" : "s"} · {status.calendar.name} roster period</p></div>
          {status.permissions.canUseAdvancedEditor && <Link href={`/rostering/sites/${siteId}/advanced`} className="btn-secondary hidden self-start sm:inline-flex">Advanced editor</Link>}
        </div>
        <nav className="mt-5 flex gap-1 border-b border-security-navy-100 dark:border-security-navy-700" aria-label="Site roster sections">
          <Link href={`/rostering/sites/${siteId}`} aria-current={tab === "overview" ? "page" : undefined} className={`border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === "overview" ? "border-security-amber-500 text-security-amber-700 dark:text-security-amber-300" : "border-transparent text-security-navy-500 hover:text-security-navy-900 dark:hover:text-white"}`}>Overview</Link>
          <Link href={`/rostering/sites/${siteId}?tab=schedule${searchParams.get("period") ? `&period=${encodeURIComponent(searchParams.get("period")!)}` : ""}`} aria-current={tab === "schedule" ? "page" : undefined} className={`border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === "schedule" ? "border-security-amber-500 text-security-amber-700 dark:text-security-amber-300" : "border-transparent text-security-navy-500 hover:text-security-navy-900 dark:hover:text-white"}`}>Schedule</Link>
        </nav>
      </header>

      {notice && <div role="status" className="rounded-security-lg border border-security-emerald-200 bg-security-emerald-50 px-4 py-3 text-sm text-security-emerald-700 dark:border-security-emerald-700 dark:bg-security-emerald-700/30 dark:text-security-emerald-200">{notice}</div>}

      {tab === "overview" ? <RosterContinuityPanel siteId={siteId} status={status} onChanged={load} onOneDayChange={() => setOneDayOpen(true)} /> : <RosterScheduleView siteId={siteId} calendarId={status.calendar.id} />}

      <OneDayChangeModal open={oneDayOpen} siteId={siteId} siteName={status.siteName} onClose={closeOneDayChange} onSaved={async () => { await load(); setNotice("The one-day change was applied and published. The ongoing schedule was not changed."); }} />
    </div>
  );
}
