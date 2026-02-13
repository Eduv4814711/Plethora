"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";

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
    employee: { firstName: string; lastName: string };
    post: { name: string; site: { name: string } };
    startTime: string;
    endTime: string;
    status: string;
  };
}

export default function AttendancePage() {
  const { token } = useAuth();
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [shiftsForClockIn, setShiftsForClockIn] = useState<ShiftForClockIn[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = (): Promise<unknown> | void => {
    if (!token) return;
    const start = new Date();
    start.setDate(1);
    const end = new Date();
    end.setMonth(end.getMonth() + 1);

    return Promise.all([
      authFetch(
        `/attendance?startDate=${start.toISOString()}&endDate=${end.toISOString()}`,
        token
      )
        .then((r) => r.json())
        .then((d) => setAttendances(d.data || [])),

      (() => {
        const now = new Date();
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(now);
        dayEnd.setHours(23, 59, 59, 999);
        return authFetch(
          `/shifts?startDate=${dayStart.toISOString()}&endDate=${dayEnd.toISOString()}`,
          token
        )
          .then((r) => r.json())
          .then((d) => {
            const shifts = (d.data || []).filter(
              (s: ShiftForClockIn) =>
                s.status === "assigned" &&
                new Date(s.startTime).getTime() - 30 * 60 * 1000 <= now.getTime() &&
                new Date(s.startTime).getTime() + 30 * 60 * 1000 >= now.getTime()
            );
            setShiftsForClockIn(shifts);
          });
      })(),
    ]);
  };

  useEffect(() => {
    if (!token) return;
    const p = refresh();
    if (p) p.finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-48 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-slate-200 dark:bg-slate-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">
        Attendance
      </h1>

      {shiftsForClockIn.length > 0 && (
        <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <h3 className="font-medium text-amber-800 dark:text-amber-200 mb-2">
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

      <div className="space-y-3">
        {attendances.map((att) => (
          <div
            key={att.id}
            className="p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-between"
          >
            <div>
              <span className="font-medium">
                {att.shift.employee.firstName} {att.shift.employee.lastName}
              </span>
              <span className="text-slate-500 mx-2">at</span>
              <span>
                {att.shift.post.site.name} - {att.shift.post.name}
              </span>
              <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">
                {att.clockIn
                  ? new Date(att.clockIn).toLocaleString()
                  : "Not clocked in"}
                {att.clockOut && ` - ${new Date(att.clockOut).toLocaleString()}`}
              </span>
              {(att.overtimeHours ?? 0) > 0 && (
                <span className="ml-2 text-amber-600 font-medium">
                  OT: {att.overtimeHours}h
                </span>
              )}
            </div>
            <span
              className={`px-2 py-0.5 rounded text-xs ${
                att.status === "completed"
                  ? "bg-green-100 text-green-700"
                  : "bg-blue-100 text-blue-700"
              }`}
            >
              {att.status}
            </span>
          </div>
        ))}
      </div>

      {attendances.length === 0 && !shiftsForClockIn.length && (
        <p className="text-slate-500 py-8 text-center">No attendance records</p>
      )}
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
    <div className="flex items-center justify-between bg-white dark:bg-slate-800 p-2 rounded">
      <span>
        {shift.employee.firstName} {shift.employee.lastName} at{" "}
        {shift.post.site.name} - {shift.post.name}
      </span>
      <div>
        {error && <span className="text-red-600 text-sm mr-2">{error}</span>}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? "..." : "Clock In"}
        </button>
      </div>
    </div>
  );
}
