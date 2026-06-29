"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { authFetch } from "@/lib/api";
import Link from "next/link";
import {
  addSiteTimesheetRow,
  approveSiteTimesheet,
  fetchSiteTimesheet,
  resyncSiteTimesheet,
  siteTimesheetCsvUrl,
  type SiteTimesheet,
  type SiteTimesheetAttendance,
  type SiteTimesheetRow,
  unlockSiteTimesheet,
  updateSiteTimesheetRow,
} from "@/lib/roster-api";

type GuardOption = { id: string; firstName: string; lastName: string; employeeNumber?: string | null; psiraNumber?: string | null };

const ATTENDANCE_OPTIONS: { value: SiteTimesheetAttendance; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "late", label: "Late" },
  { value: "left_early", label: "Left early" },
  { value: "reliever", label: "Reliever" },
  { value: "shift_swapped", label: "Shift swapped" },
  { value: "leave", label: "Leave" },
  { value: "sick_leave", label: "Sick leave" },
  { value: "training", label: "Training" },
  { value: "off", label: "Off" },
];

function label(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "Not set";
}

function timeValue(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Combine a work date (yyyy-MM-dd) with an HH:mm time into a local-time ISO string. */
function combineDateTime(workDate: string, time: string): string | null {
  if (!time) return null;
  const d = new Date(`${workDate}T${time}:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function hoursBetween(clockIn: string | null, clockOut: string | null): number | null {
  if (!clockIn || !clockOut) return null;
  let start = new Date(clockIn).getTime();
  let end = new Date(clockOut).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  // Night shifts: an end at/earlier than the start rolls over to the next day.
  if (end <= start) end += 24 * 60 * 60 * 1000;
  return Math.round(((end - start) / (1000 * 60 * 60)) * 100) / 100;
}

function guardName(guard: GuardOption) {
  return `${guard.firstName} ${guard.lastName}`.trim();
}

export function SiteTimesheetsSection({
  token,
  siteId,
  periodStart,
  periodEnd,
}: {
  token: string;
  siteId: string;
  periodStart: string;
  periodEnd: string;
}) {
  const [sheet, setSheet] = useState<SiteTimesheet | null>(null);
  const [guards, setGuards] = useState<GuardOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newRow, setNewRow] = useState({
    workDate: periodStart,
    actualGuardId: "",
    actualShiftType: "day",
    actualShiftCode: "D",
    attendanceStatus: "reliever" as SiteTimesheetAttendance,
    comments: "",
  });

  const locked = sheet?.status === "approved" || sheet?.status === "locked";
  const loadIdRef = useRef(0);

  const load = async () => {
    const loadId = ++loadIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const [nextSheet, employeesRes] = await Promise.all([
        fetchSiteTimesheet(token, siteId, periodStart, periodEnd),
        authFetch("/employees?limit=500", token).then((r) => r.json()),
      ]);
      if (loadId !== loadIdRef.current) return;
      setSheet(nextSheet);
      setGuards((employeesRes.data ?? []).filter((e: GuardOption & { employeeType?: string; status?: string }) => (e.employeeType ?? "security") === "security" && e.status !== "offboarded"));
    } catch (err) {
      if (loadId !== loadIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load site timesheet");
    } finally {
      if (loadId === loadIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token, siteId, periodStart, periodEnd]);

  const guardOptions = useMemo(() => guards.map((g) => ({ id: g.id, label: `${guardName(g)}${g.employeeNumber ? ` (${g.employeeNumber})` : ""}` })), [guards]);

  const updateRow = async (row: SiteTimesheetRow, patch: Partial<SiteTimesheetRow>) => {
    setSavingRowId(row.id);
    setError(null);
    try {
      const res = await updateSiteTimesheetRow(token, row.id, patch);
      setSheet((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((r) => (r.id === row.id ? res.row : r)),
            }
          : current
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save timesheet row");
    } finally {
      setSavingRowId(null);
    }
  };

  const exportPdf = () => {
    if (!sheet) return;
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16);
    doc.text("Site Timesheet", 14, 16);
    doc.setFontSize(10);
    doc.text(`${sheet.siteName} | ${sheet.periodStart} to ${sheet.periodEnd} | Generated ${new Date().toLocaleDateString()}`, 14, 24);
    doc.text(`Status: ${label(sheet.status)} | Approved: ${sheet.approvedAt ? new Date(sheet.approvedAt).toLocaleString() : "Not approved"}`, 14, 30);
    autoTable(doc, {
      startY: 36,
      head: [["Date", "Day", "Scheduled", "Actual", "Planned", "Actual shift", "Status", "Hours", "Discrepancies", "Comments"]],
      body: sheet.rows.map((row) => [
        row.workDate,
        row.dayOfWeek,
        row.plannedGuardName ?? "",
        row.actualGuardName ?? "",
        row.plannedShiftType ?? row.plannedShiftCode ?? "",
        row.actualShiftType ?? row.actualShiftCode ?? "",
        label(row.attendanceStatus),
        row.hoursWorked ?? "",
        row.discrepancyCodes.map(label).join("; "),
        row.comments ?? "",
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [15, 23, 42] },
    });
    const y = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 180;
    doc.text("Supervisor signature: ____________________    Manager signature: ____________________", 14, y + 12);
    doc.save(`site-timesheet-${sheet.siteName}-${sheet.periodStart}.pdf`);
  };

  if (loading && !sheet) {
    return <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">Loading site timesheet…</div>;
  }

  return (
    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Site Timesheet</h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Review and edit who actually worked, then approve. The approved timesheet is the official attendance
            record and the source for payroll actuals. Download it as audit evidence of who worked each day.
          </p>
        </div>
        {sheet && (
          <div className="flex flex-wrap gap-2">
            {!locked && (
              <button
                type="button"
                onClick={async () => {
                  setLoading(true);
                  setError(null);
                  try {
                    const refreshed = await resyncSiteTimesheet(token, siteId, periodStart, periodEnd);
                    setSheet(refreshed);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to refresh from shifts");
                  } finally {
                    setLoading(false);
                  }
                }}
                className="btn-secondary"
                title="Pull the latest published shifts and clock-ins into this timesheet"
              >
                Refresh from shifts
              </button>
            )}
            <button type="button" onClick={exportPdf} className="btn-secondary">Download PDF</button>
            <button
              type="button"
              onClick={async () => {
                const res = await authFetch(siteTimesheetCsvUrl(siteId, periodStart, periodEnd), token);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `site-timesheet-${sheet.siteName}-${sheet.periodStart}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="btn-secondary"
            >
              Download CSV
            </button>
            {locked ? (
              <button
                type="button"
                onClick={async () => {
                  const reason = window.prompt("Reason for unlocking this approved timesheet?");
                  if (reason == null) return;
                  await unlockSiteTimesheet(token, sheet.id, reason);
                  await load();
                }}
                className="btn-secondary"
              >
                Admin unlock
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm("Approve and lock this site timesheet for payroll?")) return;
                  await approveSiteTimesheet(token, sheet.id);
                  await load();
                }}
                className="btn-primary"
              >
                Approve timesheet
              </button>
            )}
          </div>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {locked && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <span>Attendance approved for this period. Next step: process payroll from the verified hours.</span>
          <Link href="/payroll" className="btn-primary">Go to Payroll</Link>
        </div>
      )}

      {sheet && (
        <>
          <div className="grid gap-2 text-xs sm:grid-cols-6">
            {[
              ["Status", label(sheet.status)],
              ["Day shifts", sheet.totals.dayShifts],
              ["Night shifts", sheet.totals.nightShifts],
              ["Hours", sheet.totals.totalHours],
              ["Relievers", sheet.totals.relieverShifts],
              ["Discrepancies", sheet.totals.discrepancies],
            ].map(([title, value]) => (
              <div key={title} className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
                <p className="text-neutral-500">{title}</p>
                <p className="mt-1 font-semibold text-neutral-900 dark:text-neutral-100">{value}</p>
              </div>
            ))}
          </div>

          {!locked && (
            <div className="grid gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900 md:grid-cols-6">
              <input type="date" value={newRow.workDate} onChange={(e) => setNewRow({ ...newRow, workDate: e.target.value })} className="input-compact" />
              <select value={newRow.actualGuardId} onChange={(e) => setNewRow({ ...newRow, actualGuardId: e.target.value })} className="input-compact md:col-span-2">
                <option value="">Choose reliever/guard…</option>
                {guardOptions.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
              <select value={newRow.actualShiftType} onChange={(e) => setNewRow({ ...newRow, actualShiftType: e.target.value, actualShiftCode: e.target.value === "night" ? "N" : "D" })} className="input-compact">
                <option value="day">Day shift</option>
                <option value="night">Night shift</option>
              </select>
              <input value={newRow.comments} onChange={(e) => setNewRow({ ...newRow, comments: e.target.value })} placeholder="Reason/comment" className="input-compact" />
              <button
                type="button"
                disabled={!newRow.actualGuardId}
                onClick={async () => {
                  await addSiteTimesheetRow(token, sheet.id, newRow);
                  setNewRow({ ...newRow, actualGuardId: "", comments: "" });
                  await load();
                }}
                className="btn-secondary disabled:opacity-50"
              >
                Add reliever
              </button>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
            <table className="min-w-[1200px] w-full text-left text-xs">
              <thead className="bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                <tr>
                  {["Date", "Scheduled", "Actual worked", "Planned", "Actual shift", "Start / End", "Status", "Discrepancies", "Comments"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {sheet.rows.map((row) => (
                  <tr key={row.id} className={row.discrepancyCodes.length ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}>
                    <td className="px-3 py-2 font-medium">{row.workDate}<br /><span className="text-neutral-500">{row.dayOfWeek}</span></td>
                    <td className="px-3 py-2">{row.plannedGuardName ?? "Unrostered"}<br /><span className="text-neutral-500">{row.employeeNumber ?? row.psiraNumber ?? ""}</span></td>
                    <td className="px-3 py-2">
                      <select
                        disabled={locked || savingRowId === row.id}
                        value={row.actualGuardId ?? ""}
                        onChange={(e) => void updateRow(row, { actualGuardId: e.target.value || null })}
                        className="input-compact min-w-44"
                      >
                        <option value="">No actual worker</option>
                        {guardOptions.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">{label(row.plannedShiftType ?? row.plannedShiftCode)}</td>
                    <td className="px-3 py-2">
                      <select
                        disabled={locked}
                        value={row.actualShiftType ?? ""}
                        onChange={(e) => void updateRow(row, { actualShiftType: e.target.value || null, actualShiftCode: e.target.value === "night" ? "N" : e.target.value === "day" ? "D" : null })}
                        className="input-compact"
                      >
                        <option value="">Not worked</option>
                        <option value="day">Day</option>
                        <option value="night">Night</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <input
                          type="time"
                          disabled={locked || savingRowId === row.id}
                          defaultValue={timeValue(row.clockIn)}
                          onBlur={(e) => {
                            const clockIn = combineDateTime(row.workDate, e.target.value);
                            if (clockIn === (row.clockIn ?? null)) return;
                            void updateRow(row, { clockIn, hoursWorked: hoursBetween(clockIn, row.clockOut) });
                          }}
                          className="input-compact w-24"
                          title="Actual start time"
                        />
                        <span className="text-neutral-400">/</span>
                        <input
                          type="time"
                          disabled={locked || savingRowId === row.id}
                          defaultValue={timeValue(row.clockOut)}
                          onBlur={(e) => {
                            const clockOut = combineDateTime(row.workDate, e.target.value);
                            if (clockOut === (row.clockOut ?? null)) return;
                            void updateRow(row, { clockOut, hoursWorked: hoursBetween(row.clockIn, clockOut) });
                          }}
                          className="input-compact w-24"
                          title="Actual end time"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <select disabled={locked} value={row.attendanceStatus} onChange={(e) => void updateRow(row, { attendanceStatus: e.target.value as SiteTimesheetAttendance })} className="input-compact">
                        {ATTENDANCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {row.discrepancyCodes.length ? row.discrepancyCodes.map((code) => (
                          <span key={code} className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">{label(code)}</span>
                        )) : <span className="text-neutral-400">None</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        disabled={locked}
                        defaultValue={row.comments ?? ""}
                        onBlur={(e) => void updateRow(row, { comments: e.target.value })}
                        className="input-compact min-w-48"
                        placeholder="Supervisor/controller comment"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
