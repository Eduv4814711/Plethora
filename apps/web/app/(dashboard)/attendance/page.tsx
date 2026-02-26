"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from "date-fns";
import { DateInput } from "@/components/date-input";

interface ShiftForClockIn {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  employee: { id: string; firstName: string; lastName: string };
  post: { name: string; site: { id: string; name: string } };
}

interface Attendance {
  id: string;
  shiftId: string;
  clockIn: string | null;
  clockOut: string | null;
  hoursWorked: number | null;
  overtimeHours: number | null;
  status: string;
  shift: {
    employee: { id: string; firstName: string; lastName: string };
    post: { name: string; site: { id: string; name: string } };
    startTime: string;
    endTime: string;
    status: string;
  };
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface SiteOption {
  id: string;
  name: string;
}

interface MissedShift {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  employee: { id: string; firstName: string; lastName: string };
  post: { name: string; site: { id: string; name: string } };
}

function getDefaultDateRange() {
  const now = new Date();
  return {
    start: startOfMonth(now),
    end: endOfMonth(now),
  };
}

export default function AttendancePage() {
  const { token } = useAuth();

  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [missedShifts, setMissedShifts] = useState<MissedShift[]>([]);
  const [shiftsForClockIn, setShiftsForClockIn] = useState<ShiftForClockIn[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [siteId, setSiteId] = useState<string>("");

  const [replacingShift, setReplacingShift] = useState<MissedShift | null>(null);
  const [availableRelievers, setAvailableRelievers] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const [replacingLoading, setReplacingLoading] = useState(false);
  const [replaceError, setReplaceError] = useState("");

  const refresh = useCallback((): Promise<unknown> | void => {
    if (!token) return;
    const params = new URLSearchParams();
    params.set("startDate", dateRange.start.toISOString());
    params.set("endDate", dateRange.end.toISOString());
    if (employeeId) params.set("employeeId", employeeId);
    if (siteId) params.set("siteId", siteId);

    const missedParams = new URLSearchParams();
    if (employeeId) missedParams.set("employeeId", employeeId);
    if (siteId) missedParams.set("siteId", siteId);

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const promises: Promise<unknown>[] = [
      authFetch(`/attendance?${params}`, token)
        .then((r) => r.json())
        .then((d) => setAttendances(d.data || [])),
      authFetch(`/attendance/missed?${missedParams}`, token)
        .then((r) => r.json())
        .then((d) => setMissedShifts(d.data || [])),
      authFetch(
        `/shifts?startDate=${dayStart.toISOString()}&endDate=${dayEnd.toISOString()}`,
        token
      )
        .then((r) => r.json())
        .then((d) => {
          const shifts = (d.data || []).filter(
            (s: ShiftForClockIn) =>
              s.status === "assigned" &&
              new Date(s.startTime).getTime() - 15 * 60 * 1000 <= now.getTime() &&
              new Date(s.endTime).getTime() > now.getTime()
          );
          setShiftsForClockIn(shifts);
        }),
    ];

    return Promise.all(promises);
  }, [token, dateRange.start, dateRange.end, employeeId, siteId]);

  useEffect(() => {
    if (!token) return;
    authFetch("/employees?limit=200", token)
      .then((r) => r.json())
      .then((d) => setEmployees(d.data || []))
      .catch(console.error);
    authFetch("/sites?limit=100", token)
      .then((r) => r.json())
      .then((d) => setSites(d.data || []))
      .catch(console.error);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const p = refresh();
    if (p) p.finally(() => setLoading(false));
  }, [token, refresh]);

  const { activeAttendances, completedAttendances, manualEntries } = useMemo(() => {
    const active = attendances.filter(
      (a) => a.clockIn && !a.clockOut && a.status === "clocked_in"
    );
    const completed = attendances.filter(
      (a) => a.clockOut != null || a.status === "completed"
    );
    const manual = attendances.filter(
      (a) => a.shift?.post?.site?.name === "Manual"
    );
    return { activeAttendances: active, completedAttendances: completed, manualEntries: manual };
  }, [attendances]);

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-neutral-200 dark:bg-neutral-700 rounded w-48 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-neutral-200 dark:bg-neutral-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const goPrevMonth = () => {
    setDateRange((prev) => ({
      start: subMonths(prev.start, 1),
      end: endOfMonth(subMonths(prev.start, 1)),
    }));
  };
  const goNextMonth = () => {
    setDateRange((prev) => ({
      start: addMonths(prev.start, 1),
      end: endOfMonth(addMonths(prev.start, 1)),
    }));
  };
  const goCurrentMonth = () => {
    setDateRange(getDefaultDateRange());
  };

  return (
    <div className="animate-fade-in">
      <h1 className="page-title mb-6">Attendance</h1>

      <div className="card-wireframe mb-8 p-6">
        <h3 className="section-title mb-4 pb-3 border-b border-neutral-200 dark:border-neutral-700">
          Filters
        </h3>
        <div className="flex flex-wrap gap-6 items-end">
          <div className="space-y-2">
            <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Date range
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goPrevMonth}
                className="btn-secondary text-sm"
              >
                Prev
              </button>
              <span className="text-sm font-medium min-w-[120px] px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 text-neutral-800 dark:text-neutral-200">
                {format(dateRange.start, "MMM yyyy")}
              </span>
              <button
                type="button"
                onClick={goNextMonth}
                className="btn-secondary text-sm"
              >
                Next
              </button>
              <button
                type="button"
                onClick={goCurrentMonth}
                className="btn-secondary text-sm"
              >
                This month
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Employee
            </label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="input-modern w-full min-w-[180px]"
            >
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Site
            </label>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="input-modern w-full min-w-[180px]"
            >
              <option value="">All sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              const p = refresh();
              if (p) p.finally(() => setLoading(false));
            }}
            className="btn-primary"
          >
            Apply
          </button>
        </div>
      </div>

      <ManualEntryForm
        employees={employees}
        token={token!}
        onSuccess={refresh}
      />

      {manualEntries.length > 0 && (
        <div className="card-wireframe mb-6 p-4">
          <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2">
            Recorder manual entries
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
            Attendance records added manually (not from clock-in/clock-out).
          </p>
          <div className="space-y-2">
            {manualEntries.map((att) => (
              <AttendanceRow
                key={att.id}
                att={att}
                token={token!}
                onSuccess={refresh}
                showClockOut={false}
                isManualEntry
              />
            ))}
          </div>
        </div>
      )}

      {replacingShift && (
        <ReplaceGuardModal
          shift={replacingShift}
          availableRelievers={availableRelievers}
          loading={replacingLoading}
          error={replaceError}
          token={token!}
          onClose={() => {
            setReplacingShift(null);
            setReplaceError("");
          }}
          onSuccess={() => {
            setReplacingShift(null);
            setReplaceError("");
            refresh();
          }}
          onError={(msg) => setReplaceError(msg)}
        />
      )}

      {shiftsForClockIn.length > 0 && (
        <div className="card-wireframe mb-6 p-4">
          <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2">
            Clock in / Clock out
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
            Shifts within clock-in window. Clock in when the guard arrives, or mark absent to replace with another guard.
          </p>
          <div className="space-y-2">
            {shiftsForClockIn.map((shift) => (
              <ClockInRow
                key={shift.id}
                shift={shift}
                token={token!}
                onSuccess={refresh}
                onMarkAbsent={() => {
                  setReplacingShift(shift);
                  setReplaceError("");
                  setAvailableRelievers([]);
                  setReplacingLoading(true);
                  authFetch(`/shifts/${shift.id}/available-relievers`, token!)
                    .then((r) => r.json())
                    .then((d) => setAvailableRelievers(d.data || []))
                    .catch(() => setAvailableRelievers([]))
                    .finally(() => setReplacingLoading(false));
                }}
              />
            ))}
          </div>
        </div>
      )}

      {activeAttendances.length > 0 && (
        <div className="card-wireframe mb-6 p-4">
          <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2">
            Clock out
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
            Guards currently on shift. Clock them out when they finish.
          </p>
          <div className="space-y-3">
            {activeAttendances.map((att) => (
              <AttendanceRow
                key={att.id}
                att={att}
                token={token!}
                onSuccess={refresh}
                showClockOut
              />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400 mb-2">
          Completed
        </h3>
        {completedAttendances.filter((a) => a.shift?.post?.site?.name !== "Manual").length > 0 ? (
          completedAttendances
            .filter((a) => a.shift?.post?.site?.name !== "Manual")
            .map((att) => (
              <AttendanceRow
                key={att.id}
                att={att}
                token={token!}
                onSuccess={refresh}
                showClockOut={false}
              />
            ))
        ) : (
          <p className="text-neutral-500 text-sm py-2">No completed records</p>
        )}
      </div>

      {attendances.length === 0 && !shiftsForClockIn.length && (
        <p className="text-neutral-500 py-8 text-center">No attendance records</p>
      )}

      <div className="card-wireframe mt-8 mb-6 p-4">
        <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2">
          Missed shifts (no clock-in)
        </h3>
        {missedShifts.length > 0 ? (
          <div className="space-y-2">
            {missedShifts.map((s) => (
              <div
                key={s.id}
                className="card-wireframe p-3 flex items-center justify-between gap-4"
              >
                <span>
                  {s.employee.firstName} {s.employee.lastName} at {s.post.site.name} - {s.post.name}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">
                    {format(new Date(s.startTime), "dd MMM HH:mm")} - {format(new Date(s.endTime), "dd MMM HH:mm")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setReplacingShift(s);
                      setReplaceError("");
                      setAvailableRelievers([]);
                      setReplacingLoading(true);
                      authFetch(`/shifts/${s.id}/available-relievers`, token!)
                        .then((r) => r.json())
                        .then((d) => setAvailableRelievers(d.data || []))
                        .catch(() => setAvailableRelievers([]))
                        .finally(() => setReplacingLoading(false));
                    }}
                    className="btn-secondary text-sm"
                  >
                    Replace
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-neutral-600 dark:text-neutral-400">No missed shifts found.</p>
        )}
      </div>
    </div>
  );
}

function ManualEntryForm({
  employees,
  token,
  onSuccess,
}: {
  employees: EmployeeOption[];
  token: string;
  onSuccess: () => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [clockInTime, setClockInTime] = useState("08:00");
  const [clockOutTime, setClockOutTime] = useState("17:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!employeeId) {
      setError("Select an employee");
      return;
    }
    setSaving(true);
    try {
      const clockIn = new Date(`${date}T${clockInTime}`);
      const clockOut = new Date(`${date}T${clockOutTime}`);
      if (clockOut <= clockIn) {
        setError("Clock-out must be after clock-in");
        setSaving(false);
        return;
      }
      const res = await authFetch("/attendance/manual", token, {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          clockIn: clockIn.toISOString(),
          clockOut: clockOut.toISOString(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || "Failed to add manual attendance");
      }
      setEmployeeId("");
      setClockInTime("08:00");
      setClockOutTime("17:00");
      setDate(format(new Date(), "yyyy-MM-dd"));
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card-wireframe mb-6 p-4">
      <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2">
        Manual entry
      </h3>
      <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
        Add clock-in and clock-out for employees who were not rostered.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Employee
          </label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="input-modern w-full min-w-[180px]"
            required
          >
            <option value="">Select employee</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.firstName} {emp.lastName}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Date
          </label>
          <DateInput value={date} onChange={setDate} className="input-modern" showToday />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Clock-in
          </label>
          <input
            type="time"
            value={clockInTime}
            onChange={(e) => setClockInTime(e.target.value)}
            className="input-modern w-28"
            required
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Clock-out
          </label>
          <input
            type="time"
            value={clockOutTime}
            onChange={(e) => setClockOutTime(e.target.value)}
            className="input-modern w-28"
            required
          />
        </div>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? "Adding…" : "Add"}
        </button>
      </form>
      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

type ShiftForReplace = MissedShift | ShiftForClockIn;

function ReplaceGuardModal({
  shift,
  availableRelievers,
  loading,
  error,
  token,
  onClose,
  onSuccess,
  onError,
}: {
  shift: ShiftForReplace;
  availableRelievers: { id: string; firstName: string; lastName: string }[];
  loading: boolean;
  error: string;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [replacing, setReplacing] = useState(false);

  const handleSelect = async (relieverId: string) => {
    onError("");
    setReplacing(true);
    try {
      const res = await authFetch(`/shifts/${shift.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ employeeId: relieverId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || "Replace failed");
      }
      onSuccess();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Replace failed");
    } finally {
      setReplacing(false);
    }
  };

  const guardName = `${shift.employee.firstName} ${shift.employee.lastName}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="card-wireframe p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200 mb-2">
          Replace absent guard
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
          {guardName} is absent. Select an active guard to replace them for this shift.
        </p>
        {error && (
          <div className="mb-4 p-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-sm">
            {error}
          </div>
        )}
        {loading ? (
          <p className="text-neutral-600 dark:text-neutral-400 py-4">Loading available relievers...</p>
        ) : availableRelievers.length === 0 ? (
          <p className="text-neutral-600 dark:text-neutral-400 py-4">No available relievers for this shift.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {availableRelievers.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between p-2 rounded-md border border-neutral-200 dark:border-neutral-700"
              >
                <span className="text-neutral-800 dark:text-neutral-200">
                  {r.firstName} {r.lastName}
                </span>
                <button
                  type="button"
                  onClick={() => handleSelect(r.id)}
                  disabled={replacing}
                  className="btn-secondary text-sm disabled:opacity-50"
                >
                  {replacing ? "..." : "Select"}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function AttendanceRow({
  att,
  token,
  onSuccess,
  showClockOut,
  isManualEntry = false,
}: {
  att: Attendance;
  token: string;
  onSuccess: () => void;
  showClockOut: boolean;
  isManualEntry?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const shiftStart = new Date(att.shift.startTime);
  const shiftEnd = new Date(att.shift.endTime);
  const shiftHours = Math.round(((shiftEnd.getTime() - shiftStart.getTime()) / (1000 * 60 * 60)) * 100) / 100;

  return (
    <div className="card-wireframe overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => e.key === "Enter" && setExpanded((ex) => !ex)}
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 text-neutral-500 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <div>
            <span className="font-medium">
              {att.shift.employee.firstName} {att.shift.employee.lastName}
            </span>
            <span className="text-neutral-500 mx-2">at</span>
            <span>
              {att.shift.post.site.name} - {att.shift.post.name}
            </span>
            <span className="ml-2 text-sm text-neutral-600 dark:text-neutral-400">
              {att.clockIn
                ? new Date(att.clockIn).toLocaleString()
                : "Not clocked in"}
              {att.clockOut && ` - ${new Date(att.clockOut).toLocaleString()}`}
            </span>
            <span className="ml-2 text-sm text-neutral-500 dark:text-neutral-500">
              | Shift: {shiftHours}h
            </span>
            {(att.overtimeHours ?? 0) > 0 && (
              <span className="ml-2 text-neutral-600 font-medium">
                OT: {att.overtimeHours}h
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
          {showClockOut && att.clockIn && !att.clockOut && (
            <ClockOutButton
              attendanceId={att.id}
              token={token}
              onSuccess={onSuccess}
            />
          )}
          {(isManualEntry || att.shift?.post?.site?.name === "Manual") && (
            <span className="badge bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700">
              Manual
            </span>
          )}
          <span
            className={`badge ${
              att.status === "completed"
                ? "badge-success"
                : "badge-neutral"
            }`}
          >
            {att.status}
          </span>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-neutral-200 dark:border-neutral-700">
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Employee
              </p>
              <p className="text-neutral-800 dark:text-neutral-200">
                {att.shift.employee.firstName} {att.shift.employee.lastName}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Location
              </p>
              <p className="text-neutral-800 dark:text-neutral-200">
                {att.shift.post.site.name} — {att.shift.post.name}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Scheduled shift
              </p>
              <p className="text-neutral-800 dark:text-neutral-200">
                {format(shiftStart, "EEE, MMM d, yyyy · h:mm a")} — {format(shiftEnd, "h:mm a")}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Clock in / out
              </p>
              <p className="text-neutral-800 dark:text-neutral-200">
                {att.clockIn
                  ? format(new Date(att.clockIn), "EEE, MMM d · h:mm a")
                  : "—"}
                {att.clockOut && (
                  <>
                    {" → "}
                    {format(new Date(att.clockOut), "h:mm a")}
                  </>
                )}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Hours
              </p>
              <p className="text-neutral-800 dark:text-neutral-200">
                Shift: {shiftHours}h
                {(att.overtimeHours ?? 0) > 0 && (
                  <span className="ml-2 font-medium">Overtime: {att.overtimeHours}h</span>
                )}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Status
              </p>
              <p className="text-neutral-800 dark:text-neutral-200 capitalize">{att.status.replace(/_/g, " ")}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ClockInRow({
  shift,
  token,
  onSuccess,
  onMarkAbsent,
}: {
  shift: ShiftForClockIn;
  token: string;
  onSuccess: () => void;
  onMarkAbsent: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleClockIn = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await authFetch("/attendance/clock-in", token, {
        method: "POST",
        body: JSON.stringify({ shiftId: shift.id }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Clock-in failed");
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-wireframe flex items-center justify-between p-3">
      <span className="text-neutral-800 dark:text-neutral-200">
        {shift.employee.firstName} {shift.employee.lastName} at{" "}
        {shift.post.site.name} - {shift.post.name}
      </span>
      <div className="flex items-center gap-2">
        {error && <span className="text-red-600 dark:text-red-400 text-sm">{error}</span>}
        <button
          onClick={handleClockIn}
          disabled={loading}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          {loading ? "..." : "Clock In"}
        </button>
        <button
          type="button"
          onClick={onMarkAbsent}
          disabled={loading}
          className="btn-primary bg-red-600 dark:bg-red-600 border-red-600 dark:border-red-600 hover:bg-red-700 dark:hover:bg-red-700 disabled:opacity-50"
        >
          Mark Absent
        </button>
      </div>
    </div>
  );
}

function ClockOutButton({
  attendanceId,
  token,
  onSuccess,
}: {
  attendanceId: string;
  token: string;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await authFetch("/attendance/clock-out", token, {
        method: "POST",
        body: JSON.stringify({ attendanceId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Clock-out failed");
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {error && <span className="text-red-600 text-sm mr-2">{error}</span>}
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="btn-secondary text-sm disabled:opacity-50"
      >
        {loading ? "..." : "Clock Out"}
      </button>
    </>
  );
}
