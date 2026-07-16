"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { authFetch } from "@/lib/api";
import Link from "next/link";
import { GuardSearchPicker } from "@/components/guard-search-picker";
import { SiteTimesheetRowCard } from "@/components/site-timesheet-row-card";
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

function normalizeShiftType(value: string | null | undefined): "day" | "night" | null {
  if (!value) return null;
  if (value === "day" || value === "D") return "day";
  if (value === "night" || value === "N") return "night";
  return null;
}

function rowShiftType(row: SiteTimesheetRow): "day" | "night" | null {
  return normalizeShiftType(
    row.actualShiftType ?? row.plannedShiftType ?? row.actualShiftCode ?? row.plannedShiftCode
  );
}

/** Day 06:00–18:00, night 18:00–06:00 — matches site shift defaults. */
function defaultShiftTime(shiftType: "day" | "night" | null, which: "start" | "end"): string {
  if (shiftType === "night") return which === "start" ? "18:00" : "06:00";
  if (shiftType === "day") return which === "start" ? "06:00" : "18:00";
  return "";
}

function displayShiftTime(
  iso: string | null | undefined,
  shiftType: "day" | "night" | null,
  which: "start" | "end"
): string {
  return timeValue(iso) || defaultShiftTime(shiftType, which);
}

/** Combine a work date (yyyy-MM-dd) with an HH:mm time into a local-time ISO string. */
function combineDateTime(workDate: string, time: string): string | null {
  if (!time) return null;
  const d = new Date(`${workDate}T${time}:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function combineClockOut(workDate: string, time: string, clockIn: string | null): string | null {
  const out = combineDateTime(workDate, time);
  if (!out || !clockIn) return out;
  if (new Date(out).getTime() <= new Date(clockIn).getTime()) {
    const next = new Date(`${workDate}T00:00:00`);
    next.setDate(next.getDate() + 1);
    const nextDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    return combineDateTime(nextDate, time);
  }
  return out;
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

function buildRowApprovalPatch(row: SiteTimesheetRow): Partial<SiteTimesheetRow> {
  const shiftType = rowShiftType(row);
  const actualGuardId = row.actualGuardId ?? row.plannedGuardId;
  const startTime = displayShiftTime(row.clockIn, shiftType, "start");
  const endTime = displayShiftTime(row.clockOut, shiftType, "end");
  const clockIn = row.clockIn ?? (startTime ? combineDateTime(row.workDate, startTime) : null);
  const clockOut =
    row.clockOut ?? (endTime ? combineClockOut(row.workDate, endTime, clockIn) : null);

  return {
    actualGuardId,
    clockIn,
    clockOut,
    hoursWorked: row.hoursWorked ?? hoursBetween(clockIn, clockOut),
    attendanceStatus: row.attendanceStatus === "pending" ? "present" : row.attendanceStatus,
    actualShiftType: row.actualShiftType ?? shiftType,
    actualShiftCode:
      row.actualShiftCode ??
      (shiftType === "night" ? "N" : shiftType === "day" ? "D" : null),
    approvalStatus: "reviewed",
  };
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
      setGuards((employeesRes.data ?? []).filter((e: GuardOption & { employeeType?: string; status?: string; jobRole?: string | null }) => (e.employeeType ?? "security") === "security" && e.status !== "offboarded" && !(e.jobRole ?? "").startsWith("roster_placeholder:")));
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

  const guardOptions = useMemo(() => guards, [guards]);
  const reviewedCount = sheet?.rows.filter((r) => r.approvalStatus !== "pending").length ?? 0;
  const pendingReviewCount = sheet ? sheet.rows.length - reviewedCount : 0;

  const updateRow = async (row: SiteTimesheetRow, patch: Partial<SiteTimesheetRow>) => {
    const nextPatch =
      row.approvalStatus === "reviewed" && patch.approvalStatus === undefined
        ? { ...patch, approvalStatus: "pending" as const }
        : patch;
    setSavingRowId(row.id);
    setError(null);
    try {
      const res = await updateSiteTimesheetRow(token, row.id, nextPatch);
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

  const approveRowAttendance = async (row: SiteTimesheetRow) => {
    await updateRow(row, buildRowApprovalPatch(row));
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
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
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
                className="btn-secondary w-full sm:w-auto"
                title="Pull the latest published shifts and clock-ins into this timesheet"
              >
                Refresh from shifts
              </button>
            )}
            <button type="button" onClick={exportPdf} className="btn-secondary w-full sm:w-auto">
              Download PDF
            </button>
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
              className="btn-secondary w-full sm:w-auto"
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
                className="btn-secondary w-full sm:w-auto"
              >
                Admin unlock
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  const unreviewed = sheet.rows.filter((r) => r.approvalStatus === "pending").length;
                  const message =
                    unreviewed > 0
                      ? `${unreviewed} row(s) have not been individually approved yet. Approve and lock this site timesheet for payroll anyway?`
                      : "Approve and lock this site timesheet for payroll?";
                  if (!window.confirm(message)) return;
                  await approveSiteTimesheet(token, sheet.id);
                  await load();
                }}
                className="btn-primary w-full sm:w-auto"
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
          <div className="grid gap-2 text-xs sm:grid-cols-7">
            {[
              ["Status", label(sheet.status)],
              ["Reviewed", `${reviewedCount}/${sheet.rows.length}`],
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

          {!locked && pendingReviewCount > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Review each row and click <span className="font-medium">Approve attendance</span> to confirm who worked, shift times, and status.
              {" "}
              <span className="font-medium">{pendingReviewCount}</span> row{pendingReviewCount === 1 ? "" : "s"} still need review.
            </div>
          )}

          {!locked && (
            <div className="grid gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900 sm:grid-cols-2 lg:grid-cols-6">
              <div className="sm:col-span-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Date</label>
                <input
                  type="date"
                  value={newRow.workDate}
                  onChange={(e) => setNewRow({ ...newRow, workDate: e.target.value })}
                  className="input-modern mt-1 w-full"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Guard</label>
                <GuardSearchPicker
                  guards={guardOptions}
                  value={newRow.actualGuardId || null}
                  onChange={(id) => setNewRow({ ...newRow, actualGuardId: id ?? "" })}
                  placeholder="Choose reliever or guard…"
                  className="input-modern mt-1 w-full"
                  allowClear={false}
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Shift</label>
                <select
                  value={newRow.actualShiftType}
                  onChange={(e) =>
                    setNewRow({
                      ...newRow,
                      actualShiftType: e.target.value,
                      actualShiftCode: e.target.value === "night" ? "N" : "D",
                    })
                  }
                  className="input-modern mt-1 w-full"
                >
                  <option value="day">Day shift</option>
                  <option value="night">Night shift</option>
                </select>
              </div>
              <div className="flex flex-col justify-end gap-2 sm:col-span-2 lg:col-span-1">
                <input
                  value={newRow.comments}
                  onChange={(e) => setNewRow({ ...newRow, comments: e.target.value })}
                  placeholder="Reason (optional)"
                  className="input-modern w-full"
                />
                <button
                  type="button"
                  disabled={!newRow.actualGuardId}
                  onClick={async () => {
                    await addSiteTimesheetRow(token, sheet.id, newRow);
                    setNewRow({ ...newRow, actualGuardId: "", comments: "" });
                    await load();
                  }}
                  className="btn-secondary w-full disabled:opacity-50"
                >
                  Add reliever
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3 lg:hidden">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Tap each day below to confirm who worked, then approve when correct.
            </p>
            {sheet.rows.map((row) => (
              <SiteTimesheetRowCard
                key={row.id}
                row={row}
                guards={guardOptions}
                locked={locked}
                saving={savingRowId === row.id}
                rowShiftType={rowShiftType}
                displayShiftTime={displayShiftTime}
                combineDateTime={combineDateTime}
                combineClockOut={combineClockOut}
                hoursBetween={hoursBetween}
                onUpdate={(r, patch) => void updateRow(r, patch)}
                onApprove={(r) => void approveRowAttendance(r)}
              />
            ))}
          </div>

          <div className="hidden lg:block overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
            <table className="min-w-[1320px] w-full text-left text-xs">
              <thead className="bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                <tr>
                  {["Date", "Scheduled", "Actual worked", "Planned", "Actual shift", "Start / End", "Status", "Discrepancies", "Comments", "Attendance"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {sheet.rows.map((row) => (
                  <tr
                    key={row.id}
                    className={
                      row.approvalStatus === "pending"
                        ? row.discrepancyCodes.length
                          ? "bg-amber-50/60 dark:bg-amber-950/20"
                          : ""
                        : "bg-emerald-50/40 dark:bg-emerald-950/15"
                    }
                  >
                    <td className="px-3 py-2 font-medium">{row.workDate}<br /><span className="text-neutral-500">{row.dayOfWeek}</span></td>
                    <td className="px-3 py-2">{row.plannedGuardName ?? "Unrostered"}<br /><span className="text-neutral-500">{row.employeeNumber ?? row.psiraNumber ?? ""}</span></td>
                    <td className="px-3 py-2">
                      <GuardSearchPicker
                        guards={guardOptions}
                        value={row.actualGuardId}
                        defaultGuardId={row.plannedGuardId}
                        disabled={locked || savingRowId === row.id}
                        onChange={(guardId) => void updateRow(row, { actualGuardId: guardId })}
                        clearLabel="Nobody worked"
                      />
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
                          key={`${row.id}-in-${row.clockIn ?? "default"}`}
                          defaultValue={displayShiftTime(row.clockIn, rowShiftType(row), "start")}
                          onBlur={(e) => {
                            const shiftType = rowShiftType(row);
                            const displayed = displayShiftTime(row.clockIn, shiftType, "start");
                            if (e.target.value === displayed && row.clockIn) return;
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
                          key={`${row.id}-out-${row.clockOut ?? "default"}`}
                          defaultValue={displayShiftTime(row.clockOut, rowShiftType(row), "end")}
                          onBlur={(e) => {
                            const shiftType = rowShiftType(row);
                            const displayed = displayShiftTime(row.clockOut, shiftType, "end");
                            if (e.target.value === displayed && row.clockOut) return;
                            const clockIn = row.clockIn ?? combineDateTime(row.workDate, displayShiftTime(null, shiftType, "start"));
                            const clockOut = combineClockOut(row.workDate, e.target.value, clockIn);
                            if (clockOut === (row.clockOut ?? null)) return;
                            void updateRow(row, { clockOut, hoursWorked: hoursBetween(clockIn, clockOut) });
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
                    <td className="px-3 py-2">
                      {row.approvalStatus === "approved" || locked ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Approved
                        </span>
                      ) : row.approvalStatus === "reviewed" ? (
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex w-fit items-center rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Reviewed
                          </span>
                          <button
                            type="button"
                            disabled={savingRowId === row.id}
                            onClick={() => void updateRow(row, { approvalStatus: "pending" })}
                            className="text-left text-[10px] text-neutral-500 underline-offset-2 hover:text-neutral-700 hover:underline dark:hover:text-neutral-300"
                          >
                            Undo review
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={savingRowId === row.id}
                          onClick={() => void approveRowAttendance(row)}
                          className="btn-primary whitespace-nowrap px-2.5 py-1.5 text-[11px] disabled:opacity-50"
                        >
                          {savingRowId === row.id ? "Saving…" : "Approve attendance"}
                        </button>
                      )}
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
