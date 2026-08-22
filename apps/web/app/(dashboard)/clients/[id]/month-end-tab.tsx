"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AlertBanner } from "@/components/ui";
import { hasCapability } from "@/lib/permissions";
import {
  downloadMonthEndPackPdf,
  downloadMonthEndTimesheetsCsv,
  downloadSiteReportPdf,
  downloadSiteTimesheetPdf,
  getClientMonthEndSummary,
  type MonthEndSummary,
} from "@/lib/msr-api";

/** Month-end reporting is retrospective, so default to the month that just closed. */
function previousMonth(): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return date.toISOString().slice(0, 7);
}

function isApproved(status: string): boolean {
  return status === "approved" || status === "locked";
}

export function ClientMonthEndTab({ clientId, token }: { clientId: string; token: string }) {
  const { user } = useAuth();
  const [month, setMonth] = useState(previousMonth);
  const [summary, setSummary] = useState<MonthEndSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [includeUnapproved, setIncludeUnapproved] = useState(false);

  const canExport = Boolean(
    user &&
      (hasCapability(user, "/clients", "export") ||
        hasCapability(user, "/attendance", "export") ||
        hasCapability(user, "/rostering", "export"))
  );

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      setSummary(await getClientMonthEndSummary(token, clientId, month));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load month-end summary");
      setSummary(null);
    }
  }, [token, clientId, month]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(`${label} downloaded.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusy("");
    }
  };

  const unapproved = summary?.sites.filter((site) => !isApproved(site.timesheetStatus)) ?? [];
  const recipients = summary?.recipients ?? [];
  const mailto = recipients.length
    ? `mailto:${recipients.join(",")}?subject=${encodeURIComponent(
        `Site report & timesheets — ${summary?.period.label ?? month}`
      )}`
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label-text mb-1 block" htmlFor="month-end-month">
            Reporting month
          </label>
          <input
            id="month-end-month"
            type="month"
            className="input-modern"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <button type="button" className="btn-secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error && <AlertBanner variant="error">{error}</AlertBanner>}
      {notice && <AlertBanner variant="success">{notice}</AlertBanner>}

      {loading ? (
        <div className="h-40 animate-pulse rounded-security-lg bg-security-navy-100 dark:bg-security-navy-700" aria-label="Loading summary" />
      ) : !summary ? (
        <p className="text-sm text-security-navy-600">No summary available for this month.</p>
      ) : (
        <>
          {summary.warnings.length > 0 && (
            <div className="rounded-lg border border-security-amber-300 bg-security-amber-50 px-3 py-2 text-sm text-security-amber-900">
              <p className="font-medium">Check before sending</p>
              <ul className="mt-1 list-disc pl-5">
                {summary.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Day shifts", summary.totals.dayShifts],
              ["Night shifts", summary.totals.nightShifts],
              ["Absences", summary.totals.absences],
              ["Hours", summary.totals.totalHours],
              ["Overtime", summary.totals.overtimeHours],
              ["Incidents", summary.totals.incidents],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-security-lg border border-security-navy-100 p-3 dark:border-security-navy-700">
                <p className="text-[10px] uppercase tracking-wider text-security-navy-500">{label}</p>
                <p className="text-lg font-semibold tabular-nums text-security-navy-900 dark:text-security-navy-100">{value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-security-lg border border-security-navy-100 dark:border-security-navy-700">
            <table className="min-w-full divide-y divide-security-navy-100 text-sm dark:divide-security-navy-700">
              <thead className="bg-security-navy-50 dark:bg-security-navy-900">
                <tr className="text-left text-[10px] uppercase tracking-wider text-security-navy-500">
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Timesheet</th>
                  <th className="px-3 py-2 text-right">Rows</th>
                  <th className="px-3 py-2 text-right">Hours</th>
                  <th className="px-3 py-2 text-right">Absences</th>
                  <th className="px-3 py-2 text-right">Incidents</th>
                  <th className="px-3 py-2 text-right">Exceptions</th>
                  {canExport && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-100 dark:divide-security-navy-800">
                {summary.sites.map((site) => (
                  <tr key={site.siteId}>
                    <td className="px-3 py-2 font-medium text-security-navy-900 dark:text-security-navy-100">{site.siteName}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          isApproved(site.timesheetStatus)
                            ? "rounded-full bg-security-emerald-50 px-2 py-0.5 text-xs font-medium text-security-emerald-700"
                            : "rounded-full bg-security-amber-50 px-2 py-0.5 text-xs font-medium text-security-amber-800"
                        }
                      >
                        {site.timesheetStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{site.rowCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{site.totals.totalHours}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{site.totals.absences}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{site.incidentCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{site.exceptionTotal}</td>
                    {canExport && (
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <button
                          type="button"
                          className="btn-secondary py-1 text-xs"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            run("Site report", () =>
                              downloadSiteReportPdf(token, clientId, site.siteId, month)
                            )
                          }
                        >
                          Site report
                        </button>
                        <button
                          type="button"
                          className="btn-secondary ml-2 py-1 text-xs"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            run("Timesheet", () =>
                              downloadSiteTimesheetPdf(token, clientId, site.siteId, month)
                            )
                          }
                        >
                          Timesheet
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {summary.sites.length === 0 && (
                  <tr>
                    <td colSpan={canExport ? 8 : 7} className="px-3 py-8 text-center text-sm text-security-navy-600">
                      No sites linked to this client — attach them on the Sites tab first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canExport && summary.sites.length > 0 && (
            <div className="card-dashboard space-y-3 p-4">
              {unapproved.length > 0 && (
                <label className="flex items-start gap-2 text-sm text-security-amber-900">
                  <input
                    type="checkbox"
                    checked={includeUnapproved}
                    onChange={(e) => setIncludeUnapproved(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    Include {unapproved.length} unapproved timesheet(s) in the pack. Those pages are
                    watermarked <strong>DRAFT - NOT APPROVED</strong>.
                  </span>
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    run("Month-end pack", () =>
                      downloadMonthEndPackPdf(token, clientId, month, { includeUnapproved })
                    )
                  }
                >
                  {busy === "Month-end pack" ? "Building…" : "Download pack (PDF)"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    run("Timesheets CSV", () => downloadMonthEndTimesheetsCsv(token, clientId, month))
                  }
                >
                  Download timesheets (CSV)
                </button>
              </div>
              <p className="text-xs text-security-navy-500">
                The pack renders one report and one timesheet per site — with several sites this can take
                a minute.
              </p>
            </div>
          )}

          <div className="card-dashboard space-y-2 p-4">
            <h2 className="text-sm font-semibold text-security-navy-900 dark:text-security-navy-100">Send it</h2>
            <p className="text-xs text-security-navy-500">
              Nothing is emailed automatically. Download the pack, then send it to:
            </p>
            {recipients.length === 0 ? (
              <p className="text-sm text-security-navy-600">
                No recipients captured — add them on the Details tab.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-security-navy-50 px-2 py-1 text-sm dark:bg-security-navy-800">
                  {recipients.join(", ")}
                </code>
                <button
                  type="button"
                  className="btn-secondary py-1 text-xs"
                  onClick={() => {
                    void navigator.clipboard?.writeText(recipients.join(", "));
                    setNotice("Recipients copied.");
                  }}
                >
                  Copy
                </button>
                {mailto && (
                  <a className="btn-secondary py-1 text-xs" href={mailto}>
                    Open email draft
                  </a>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
