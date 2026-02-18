"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from "date-fns";

interface ShiftForClockIn {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  employee: { firstName: string; lastName: string };
  post: { name: string; site: { name: string } };
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
  const searchParams = useSearchParams();
  const modeMissed = searchParams.get("mode") === "missed";

  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [missedShifts, setMissedShifts] = useState<MissedShift[]>([]);
  const [shiftsForClockIn, setShiftsForClockIn] = useState<ShiftForClockIn[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [siteId, setSiteId] = useState<string>("");

  const refresh = useCallback((): Promise<unknown> | void => {
    if (!token) return;
    const params = new URLSearchParams();
    params.set("startDate", dateRange.start.toISOString());
    params.set("endDate", dateRange.end.toISOString());
    if (employeeId) params.set("employeeId", employeeId);
    if (siteId) params.set("siteId", siteId);

    const promises: Promise<unknown>[] = [
      authFetch(`/attendance?${params}`, token)
        .then((r) => r.json())
        .then((d) => setAttendances(d.data || [])),
    ];

    if (modeMissed) {
      const missedParams = new URLSearchParams();
      if (employeeId) missedParams.set("employeeId", employeeId);
      if (siteId) missedParams.set("siteId", siteId);
      promises.push(
        authFetch(`/attendance/missed?${missedParams}`, token)
          .then((r) => r.json())
          .then((d) => setMissedShifts(d.data || []))
      );
    } else {
      const now = new Date();
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(now);
      dayEnd.setHours(23, 59, 59, 999);
      promises.push(
        authFetch(
          `/shifts?startDate=${dayStart.toISOString()}&endDate=${dayEnd.toISOString()}`,
          token
        )
          .then((r) => r.json())
          .then((d) => {
            const shifts = (d.data || []).filter(
              (s: ShiftForClockIn) =>
                s.status === "assigned" &&
                new Date(s.startTime).getTime() - 30 * 60 * 1000 <= now.getTime() &&
                new Date(s.endTime).getTime() > now.getTime()
            );
            setShiftsForClockIn(shifts);
          })
      );
    }

    return Promise.all(promises);
  }, [token, dateRange.start, dateRange.end, employeeId, siteId, modeMissed]);

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

  const { activeAttendances, completedAttendances } = useMemo(() => {
    const active = attendances.filter(
      (a) => a.clockIn && !a.clockOut && a.status === "clocked_in"
    );
    const completed = attendances.filter(
      (a) => a.clockOut != null || a.status === "completed"
    );
    return { activeAttendances: active, completedAttendances: completed };
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
    <div>
      <h1 className="text-2xl font-bold text-neutral-800 dark:text-white mb-6">
        Attendance
      </h1>

      <div className="mb-8 p-6 border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-900 rounded-none">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400 mb-4 pb-3 border-b border-dashed border-gray-300 dark:border-gray-600">
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
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-transparent text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800/50 focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-neutral-900 rounded-none"
              >
                Prev
              </button>
              <span className="text-sm font-medium min-w-[120px] px-3 py-2 border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-neutral-800/50 text-neutral-800 dark:text-neutral-200">
                {format(dateRange.start, "MMM yyyy")}
              </span>
              <button
                type="button"
                onClick={goNextMonth}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-transparent text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800/50 focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-neutral-900 rounded-none"
              >
                Next
              </button>
              <button
                type="button"
                onClick={goCurrentMonth}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-transparent text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800/50 focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-neutral-900 rounded-none"
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
              className="w-full min-w-[180px] px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-900 text-sm text-neutral-800 dark:text-neutral-200 focus:ring-2 focus:ring-gray-400 focus:border-gray-500 dark:focus:border-gray-500 rounded-none outline-none"
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
              className="w-full min-w-[180px] px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-neutral-900 text-sm text-neutral-800 dark:text-neutral-200 focus:ring-2 focus:ring-gray-400 focus:border-gray-500 dark:focus:border-gray-500 rounded-none outline-none"
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
            className="px-4 py-2 border-2 border-gray-400 dark:border-gray-500 bg-transparent text-sm font-semibold text-neutral-800 dark:text-neutral-200 hover:bg-gray-50 dark:hover:bg-neutral-800/50 focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-neutral-900 rounded-none"
          >
            Apply
          </button>
        </div>
      </div>

      {modeMissed && missedShifts.length > 0 && (
        <div className="mb-6 p-4 bg-neutral-50 dark:bg-neutral-900/20 rounded-sm border border-dashed border-black dark:border-white">
          <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2">
            Missed shifts (no clock-in)
          </h3>
          <div className="space-y-2">
            {missedShifts.map((s) => (
              <div
                key={s.id}
                className="p-3 bg-white dark:bg-neutral-800 rounded-sm border border-black dark:border-white flex items-center justify-between"
              >
                <span>
                  {s.employee.firstName} {s.employee.lastName} at {s.post.site.name} - {s.post.name}
                </span>
                <span className="text-sm text-neutral-600 dark:text-neutral-400">
                  {format(new Date(s.startTime), "dd MMM HH:mm")} - {format(new Date(s.endTime), "dd MMM HH:mm")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {modeMissed && missedShifts.length === 0 && !loading && (
        <div className="mb-6 p-4 bg-neutral-50 dark:bg-neutral-900/20 rounded-sm border border-dashed border-black dark:border-white">
          <p className="text-neutral-600 dark:text-neutral-400">No missed shifts found.</p>
        </div>
      )}

      {!modeMissed && shiftsForClockIn.length > 0 && (
        <div className="mb-6 p-4 bg-neutral-50 dark:bg-neutral-900/20 rounded-sm border border-black dark:border-white">
          <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2">
            Clock in (within window)
          </h3>
          <div className="space-y-2">
            {shiftsForClockIn.map((shift) => (
              <ClockInButton
                key={shift.id}
                shift={shift}
                token={token!}
                onSuccess={refresh}
              />
            ))}
          </div>
        </div>
      )}

      {activeAttendances.length > 0 && (
        <div className="mb-6">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400 mb-2">
            Active (clocked in — needs clock out)
          </h3>
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
        {completedAttendances.length > 0 ? (
          completedAttendances.map((att) => (
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
    </div>
  );
}

function AttendanceRow({
  att,
  token,
  onSuccess,
  showClockOut,
}: {
  att: Attendance;
  token: string;
  onSuccess: () => void;
  showClockOut: boolean;
}) {
  return (
    <div className="p-4 bg-white dark:bg-neutral-800 rounded-sm border border-black dark:border-white flex items-center justify-between">
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
        {(att.overtimeHours ?? 0) > 0 && (
          <span className="ml-2 text-neutral-600 font-medium">
            OT: {att.overtimeHours}h
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {showClockOut && att.clockIn && !att.clockOut && (
          <ClockOutButton
            attendanceId={att.id}
            token={token}
            onSuccess={onSuccess}
          />
        )}
        <span
          className={`px-2 py-0.5 rounded text-xs ${
            att.status === "completed"
              ? "border border-black dark:border-white bg-neutral-100 dark:bg-neutral-700/50 text-neutral-800 dark:text-neutral-200"
              : "border border-black dark:border-white bg-neutral-50 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300"
          }`}
        >
          {att.status}
        </span>
      </div>
    </div>
  );
}

function ClockInButton({
  shift,
  token,
  onSuccess,
}: {
  shift: ShiftForClockIn;
  token: string;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
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
    <div className="flex items-center justify-between bg-white dark:bg-neutral-800 p-2 rounded">
      <span>
        {shift.employee.firstName} {shift.employee.lastName} at{" "}
        {shift.post.site.name} - {shift.post.name}
      </span>
      <div>
        {error && <span className="text-red-600 text-sm mr-2">{error}</span>}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {loading ? "..." : "Clock In"}
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
