"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import {
  bulkSetStaffAttendanceDay,
  fetchStaffAttendanceDay,
  setStaffAttendanceDay,
  type StaffAttendanceDay,
  type StaffAttendanceRow,
  type StaffAttendanceStatus,
} from "@/lib/staff-attendance-api";
import {
  defaultOfficeTimes,
  formatStaffName,
  formatTimeOfDay,
  remainingToCapture,
  rollCallState,
} from "@/lib/staff-attendance-utils";
import { shiftDateKey } from "@/lib/attendance-navigation";

/**
 * Office-staff roll call: one tap per person.
 *
 * Office staff have no site, no roster and no occurrence book, so this is deliberately
 * not the guard capture screen. Present/Absent saves immediately; times and notes are
 * behind a disclosure for the rare day that needs them.
 */
export function StaffRollCall({
  token,
  date,
  onDateChange,
  onLoaded,
}: {
  token: string;
  date: string;
  onDateChange: (date: string) => void;
  onLoaded?: (day: StaffAttendanceDay) => void;
}) {
  const [day, setDay] = useState<StaffAttendanceDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const next = await fetchStaffAttendanceDay(token, date);
      setDay(next);
      onLoaded?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load office attendance");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    setExpandedId(null);
    // `load` is redefined each render; the date is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, date]);

  const save = async (row: StaffAttendanceRow, status: StaffAttendanceStatus, patch?: {
    timeIn?: string | null;
    timeOut?: string | null;
    notes?: string | null;
  }) => {
    setSavingId(row.employeeId);
    setError(null);
    try {
      const times =
        status === "present" && patch?.timeIn === undefined
          ? defaultOfficeTimes(row.ordinaryHours)
          : { timeIn: patch?.timeIn ?? null, timeOut: patch?.timeOut ?? null };
      await setStaffAttendanceDay(token, date, {
        employeeId: row.employeeId,
        status,
        timeIn: status === "present" ? times.timeIn : null,
        timeOut: status === "present" ? times.timeOut : null,
        notes: patch?.notes ?? row.notes,
      });
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save attendance");
    } finally {
      setSavingId(null);
    }
  };

  const markAllRemainingPresent = async () => {
    if (!day) return;
    const remaining = remainingToCapture(day.rows);
    if (remaining.length === 0) return;
    setError(null);
    try {
      const result = await bulkSetStaffAttendanceDay(
        token,
        date,
        remaining.map((row) => {
          const times = defaultOfficeTimes(row.ordinaryHours);
          return {
            employeeId: row.employeeId,
            status: "present" as const,
            timeIn: times.timeIn,
            timeOut: times.timeOut,
          };
        })
      );
      if (result.failed.length > 0) {
        setError(
          `${result.failed.length} of ${remaining.length} could not be marked present. ${result.failed[0].message}`
        );
      }
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark everyone present");
    }
  };

  const visibleRows = (day?.rows ?? []).filter((row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${formatStaffName(row)} ${row.employeeNumber ?? ""}`.toLowerCase().includes(q);
  });
  const remainingCount = day ? remainingToCapture(day.rows).length : 0;

  return (
    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Office staff roll call
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Tap Present or Absent for each person. Office staff are on a fixed salary, so this
            record is for leave and reporting — it does not change anyone&rsquo;s pay.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onDateChange(shiftDateKey(date, -1))}
            className="btn-secondary min-h-11 px-3"
            aria-label="Previous day"
          >
            ◀
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && onDateChange(e.target.value)}
            className="input-modern min-h-11"
            aria-label="Attendance date"
          />
          <button
            type="button"
            onClick={() => onDateChange(new Date().toISOString().slice(0, 10))}
            className="btn-secondary min-h-11 px-3"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onDateChange(shiftDateKey(date, 1))}
            className="btn-secondary min-h-11 px-3"
            aria-label="Next day"
          >
            ▶
          </button>
        </div>
      </div>

      {error && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          <span>{error}</span>
          <button type="button" className="min-h-11 font-semibold underline" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {day && (
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-neutral-700 dark:text-neutral-300" aria-live="polite">
            <span className="font-semibold">{day.counts.present} present</span> ·{" "}
            {day.counts.absent} absent · {day.counts.onLeave} on leave ·{" "}
            {day.counts.notCaptured} not captured
          </p>
          {remainingCount > 0 && (
            <button
              type="button"
              onClick={() => void markAllRemainingPresent()}
              className="btn-primary min-h-11"
            >
              Mark all {remainingCount} remaining present
            </button>
          )}
        </div>
      )}

      <div>
        <label htmlFor="staff-rollcall-search" className="sr-only">
          Search office staff
        </label>
        <input
          id="staff-rollcall-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or employee number…"
          className="input-modern min-h-11 w-full"
          autoComplete="off"
        />
      </div>

      {loading && !day && (
        <p className="text-sm text-neutral-500">Loading office attendance…</p>
      )}

      {day && day.totalGeneralEmployees === 0 && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-4 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          No office staff on record. Employees with an employee type of “general” appear here.
        </div>
      )}

      {day && day.totalGeneralEmployees > 0 && visibleRows.length === 0 && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          Nobody matches “{query.trim()}”.
        </div>
      )}

      <ul className="space-y-2">
        {visibleRows.map((row) => {
          const state = rollCallState(row);
          const saving = savingId === row.employeeId;
          const expanded = expandedId === row.employeeId;
          return (
            <li
              key={row.employeeId}
              className={clsx(
                "rounded-xl border p-3",
                state === "present"
                  ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20"
                  : state === "absent"
                    ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20"
                    : state === "leave"
                      ? "border-sky-200 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/20"
                      : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-950"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {formatStaffName(row)}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {[row.employeeNumber, row.jobRole].filter(Boolean).join(" · ") || "Office staff"}
                    {state === "present" && row.timeIn
                      ? ` · ${formatTimeOfDay(row.timeIn)}–${formatTimeOfDay(row.timeOut)}`
                      : ""}
                  </p>
                </div>

                {state === "leave" && row.onApprovedLeave ? (
                  <span className="rounded-full border border-sky-200 bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
                    On approved leave
                    {row.approvedLeaveType ? ` · ${row.approvedLeaveType.toLowerCase()}` : ""}
                  </span>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void save(row, "present")}
                      aria-pressed={state === "present"}
                      className={clsx(
                        "min-h-11 rounded-security border-2 px-5 text-sm font-semibold disabled:opacity-50",
                        state === "present"
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-neutral-300 bg-white text-neutral-700 hover:border-emerald-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                      )}
                    >
                      Present
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void save(row, "absent")}
                      aria-pressed={state === "absent"}
                      className={clsx(
                        "min-h-11 rounded-security border-2 px-5 text-sm font-semibold disabled:opacity-50",
                        state === "absent"
                          ? "border-amber-600 bg-amber-600 text-white"
                          : "border-neutral-300 bg-white text-neutral-700 hover:border-amber-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                      )}
                    >
                      Absent
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : row.employeeId)}
                      aria-expanded={expanded}
                      className="btn-secondary min-h-11 text-sm"
                    >
                      {expanded ? "Done" : "Adjust"}
                    </button>
                  </div>
                )}
              </div>

              {expanded && (
                <div className="mt-3 grid gap-3 border-t border-neutral-200 pt-3 dark:border-neutral-700 sm:grid-cols-3">
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                      Start
                    </label>
                    <input
                      type="time"
                      defaultValue={formatTimeOfDay(row.timeIn) || undefined}
                      onBlur={(e) =>
                        void save(row, row.status ?? "present", {
                          timeIn: e.target.value || null,
                          timeOut: formatTimeOfDay(row.timeOut) || null,
                        })
                      }
                      className="input-modern mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                      End
                    </label>
                    <input
                      type="time"
                      defaultValue={formatTimeOfDay(row.timeOut) || undefined}
                      onBlur={(e) =>
                        void save(row, row.status ?? "present", {
                          timeIn: formatTimeOfDay(row.timeIn) || null,
                          timeOut: e.target.value || null,
                        })
                      }
                      className="input-modern mt-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                      Note
                    </label>
                    <input
                      defaultValue={row.notes ?? ""}
                      onBlur={(e) =>
                        void save(row, row.status ?? "present", {
                          timeIn: formatTimeOfDay(row.timeIn) || null,
                          timeOut: formatTimeOfDay(row.timeOut) || null,
                          notes: e.target.value || null,
                        })
                      }
                      placeholder="Optional"
                      className="input-modern mt-1 w-full"
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
