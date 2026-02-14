"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { format, addDays, addWeeks, addMonths, startOfWeek, startOfMonth, isSameDay, parseISO } from "date-fns";

interface Shift {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  employee: { id: string; firstName: string; lastName: string };
  post: { id: string; name: string; shiftType: string | null; site: { name: string } };
}

const statusColors: Record<string, string> = {
  created: "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300",
  assigned: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  active: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
  completed: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400",
  verified: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
};

export default function RosteringPage() {
  const { token } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<{ id: string; firstName: string; lastName: string; status?: string }[]>([]);
  const [sites, setSites] = useState<{ id: string; name: string; posts: { id: string; name: string; shiftType?: string | null }[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedDayForShift, setSelectedDayForShift] = useState<Date | null>(null);
  const [dateRange, setDateRange] = useState<"week" | "month">("week");
  const [viewOffset, setViewOffset] = useState(0);

  const getDateRangeParams = () => {
    const now = new Date();
    let start: Date;
    if (dateRange === "week") {
      start = startOfWeek(now, { weekStartsOn: 1 });
      start = addWeeks(start, viewOffset);
    } else {
      start = startOfMonth(now);
      start = addMonths(start, viewOffset);
    }
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    if (dateRange === "week") {
      end.setDate(end.getDate() + 6);
    } else {
      end.setMonth(end.getMonth() + 1);
      end.setMilliseconds(-1);
    }
    end.setHours(23, 59, 59, 999);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  };

  const { calendarDays, displayCells } = useMemo(() => {
    const now = new Date();
    let start: Date;
    if (dateRange === "week") {
      start = startOfWeek(now, { weekStartsOn: 1 });
      start = addWeeks(start, viewOffset);
    } else {
      start = startOfMonth(now);
      start = addMonths(start, viewOffset);
    }
    const end = dateRange === "week" ? addDays(start, 6) : addDays(addMonths(start, 1), -1);
    const days: Date[] = [];
    let d = new Date(start);
    while (d <= end) {
      days.push(new Date(d));
      d = addDays(d, 1);
    }
    if (dateRange === "month" && days.length > 0) {
      const firstDay = days[0].getDay();
      const startPad = (firstDay - 1 + 7) % 7;
      const endPad = (7 - ((startPad + days.length) % 7)) % 7;
      const cells: (Date | null)[] = [
        ...Array(startPad).fill(null),
        ...days,
        ...Array(endPad).fill(null),
      ];
      return { calendarDays: days, displayCells: cells };
    }
    return { calendarDays: days, displayCells: days as (Date | null)[] };
  }, [dateRange, viewOffset]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const day of calendarDays) {
      const key = format(day, "yyyy-MM-dd");
      map.set(key, []);
    }
    for (const shift of shifts) {
      const start = parseISO(shift.startTime);
      const key = format(start, "yyyy-MM-dd");
      if (map.has(key)) {
        map.get(key)!.push(shift);
      }
    }
    return map;
  }, [shifts, calendarDays]);

  const refresh = () => {
    if (!token) return;
    const { startDate, endDate } = getDateRangeParams();
    Promise.all([
      authFetch(`/shifts?startDate=${startDate}&endDate=${endDate}`, token).then((r) => r.json()),
      authFetch("/employees?limit=100", token).then((r) => r.json()),
      authFetch("/sites?limit=100", token).then((r) => r.json()),
    ])
      .then(([shiftsRes, empRes, sitesRes]) => {
        setShifts(shiftsRes.data || []);
        setEmployees(empRes.data || []);
        setSites(sitesRes.data || []);
      })
      .catch(console.error);
  };

  useEffect(() => {
    if (!token) return;
    refresh();
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (token) refresh();
  }, [token, dateRange, viewOffset]);

  if (loading) {
    return (
      <div className="animate-pulse flex flex-col h-[calc(100vh-8rem)]">
        <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded w-48 mb-4" />
        <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-xl" />
      </div>
    );
  }

  const periodLabel = calendarDays.length > 0
    ? dateRange === "week"
      ? `${format(calendarDays[0], "d MMM")} – ${format(calendarDays[calendarDays.length - 1], "d MMM yyyy")}`
      : format(calendarDays[0], "MMMM yyyy")
    : "";

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[500px]">
      <div className="shrink-0 p-6 pb-4">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Rostering</h1>
            {periodLabel && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{periodLabel}</p>}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 p-1 bg-slate-50/50 dark:bg-slate-800/30">
              <button
                type="button"
                onClick={() => setViewOffset((o) => o - 1)}
                className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-700 transition-colors"
                aria-label="Previous"
              >
                <svg className="w-4 h-4 text-slate-600 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setViewOffset(0)}
                className="px-3 py-2 text-sm font-medium rounded-lg hover:bg-white dark:hover:bg-slate-700 transition-colors text-slate-700 dark:text-slate-300"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setViewOffset((o) => o + 1)}
                className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-700 transition-colors"
                aria-label="Next"
              >
                <svg className="w-4 h-4 text-slate-600 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <select
              value={dateRange}
              onChange={(e) => { setDateRange(e.target.value as "week" | "month"); setViewOffset(0); }}
              className="input-modern py-2 text-sm rounded-xl"
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
            <button
              onClick={() => { setSelectedDayForShift(null); setShowForm(!showForm); }}
              className="btn-primary flex items-center gap-2 text-sm py-2 rounded-xl"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {showForm ? "Cancel" : "Add Shift"}
            </button>
          </div>
        </div>

        {showForm && (
          <div className="mt-4">
            <ShiftForm
              token={token!}
              employees={employees}
              sites={sites}
              defaultDate={selectedDayForShift ?? undefined}
              onSuccess={() => {
                setShowForm(false);
                setSelectedDayForShift(null);
                refresh();
              }}
            />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 px-6 pb-6 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 rounded-2xl bg-white dark:bg-slate-900 relative shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08),0_8px_16px_-8px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.3)] ring-1 ring-slate-200/60 dark:ring-slate-700/50 overflow-y-auto overflow-x-hidden">
          <div className="grid min-h-full w-full" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((wd, i) => (
              <div
                key={wd}
                className={`shrink-0 py-3.5 px-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] border-b ${
                  i >= 5
                    ? "text-slate-400 dark:text-slate-500 bg-slate-50/80 dark:bg-slate-800/30 border-slate-100 dark:border-slate-700/80"
                    : "text-slate-600 dark:text-slate-400 bg-gradient-to-b from-slate-50 to-slate-100/50 dark:from-slate-800/60 dark:to-slate-800/30 border-slate-200/80 dark:border-slate-700"
                }`}
              >
                {wd}
              </div>
            ))}
            {displayCells.map((day, idx) => {
              if (!day) {
                return (
                  <div
                    key={`empty-${idx}`}
                    className="min-h-[100px] bg-slate-50/40 dark:bg-slate-800/10 border-b border-r border-slate-100/80 dark:border-slate-700/40"
                  />
                );
              }
              const key = format(day, "yyyy-MM-dd");
              const dayShifts = shiftsByDay.get(key) ?? [];
              const isToday = isSameDay(day, new Date());
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              return (
                <div
                  key={key}
                  className={`flex flex-col min-h-0 border-b border-r border-slate-100/80 dark:border-slate-700/40 last:border-r-0 transition-colors ${
                    isToday
                      ? "bg-indigo-50/50 dark:bg-indigo-950/30"
                      : isWeekend
                        ? "bg-slate-50/30 dark:bg-slate-800/10"
                        : "bg-white dark:bg-slate-900"
                  }`}
                >
                  <div className="shrink-0 py-2.5 px-3 text-center">
                    <span
                      className={`inline-flex items-center justify-center w-9 h-9 rounded-xl text-sm font-semibold transition-all ${
                        isToday
                          ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 dark:shadow-indigo-500/20 ring-2 ring-indigo-400/30"
                          : "text-slate-600 dark:text-slate-300 bg-slate-100/80 dark:bg-slate-700/50"
                      }`}
                    >
                      {format(day, "d")}
                    </span>
                    <div className={`text-[10px] font-medium mt-1 ${isToday ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"}`}>
                      {format(day, "MMM")}
                    </div>
                  </div>
                  <div
                    onClick={() => { setSelectedDayForShift(day); setShowForm(true); }}
                    className="flex-1 px-3 py-2.5 space-y-2 overflow-y-auto min-h-0 cursor-pointer group"
                  >
                    {dayShifts.length === 0 ? (
                      <div className="flex-1 min-h-[60px] flex items-center justify-center rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700/60 group-hover:border-indigo-300 dark:group-hover:border-indigo-600/50 group-hover:bg-indigo-50/30 dark:group-hover:bg-indigo-950/20 transition-all duration-200">
                        <span className="text-slate-400 dark:text-slate-500 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Add shift
                        </span>
                      </div>
                    ) : (
                      dayShifts.map((s) => (
                        <div
                          key={s.id}
                          onClick={(e) => e.stopPropagation()}
                          className={`px-3 py-2 rounded-xl text-xs font-medium shrink-0 transition-all duration-200 hover:scale-[1.02] ${
                            s.post.shiftType === "night"
                              ? "bg-gradient-to-br from-indigo-500/15 to-indigo-600/10 dark:from-indigo-500/20 dark:to-indigo-600/10 text-indigo-800 dark:text-indigo-200 border border-indigo-200/60 dark:border-indigo-700/50 shadow-sm"
                              : "bg-gradient-to-br from-amber-500/15 to-orange-500/10 dark:from-amber-500/20 dark:to-orange-600/10 text-amber-900 dark:text-amber-100 border border-amber-200/60 dark:border-amber-700/50 shadow-sm"
                          }`}
                        >
                          <span className="truncate block">{s.employee.firstName} {s.employee.lastName}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {shifts.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-slate-900 pointer-events-none rounded-2xl">
              <div className="text-center px-8">
                <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-800/50 flex items-center justify-center ring-1 ring-slate-200/50 dark:ring-slate-700/50">
                  <svg className="w-10 h-10 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" strokeWidth={1.25} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-slate-600 dark:text-slate-400 font-semibold">No shifts scheduled</p>
                <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Click on a day to add a shift</p>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-8 mt-4 pl-1">
          <span className="flex items-center gap-2.5 text-sm text-slate-600 dark:text-slate-400">
            <span className="w-4 h-4 rounded-lg bg-gradient-to-br from-amber-400/30 to-orange-500/20 dark:from-amber-500/30 dark:to-orange-600/20 border border-amber-300/50 dark:border-amber-600/40 shadow-sm" />
            <span className="font-medium">Day shift</span>
          </span>
          <span className="flex items-center gap-2.5 text-sm text-slate-600 dark:text-slate-400">
            <span className="w-4 h-4 rounded-lg bg-gradient-to-br from-indigo-400/30 to-indigo-600/20 dark:from-indigo-500/30 dark:to-indigo-600/20 border border-indigo-300/50 dark:border-indigo-600/40 shadow-sm" />
            <span className="font-medium">Night shift</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function formatForDatetimeLocal(d: Date) {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ShiftForm({
  token,
  employees,
  sites,
  defaultDate,
  onSuccess,
}: {
  token: string;
  employees: { id: string; firstName: string; lastName: string; status?: string }[];
  sites: { id: string; name: string; posts: { id: string; name: string }[] }[];
  defaultDate?: Date;
  onSuccess: () => void;
}) {
  const baseDate = defaultDate ?? new Date();
  const initialStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 6, 0, 0, 0);
  const initialEnd = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 18, 0, 0, 0);
  const [employeeId, setEmployeeId] = useState("");
  const [postId, setPostId] = useState("");
  const [startTime, setStartTime] = useState(() => formatForDatetimeLocal(initialStart));
  const [endTime, setEndTime] = useState(() => formatForDatetimeLocal(initialEnd));
  const [error, setError] = useState("");

  const posts = sites.flatMap((s) =>
    s.posts.map((p) => ({ ...p, siteName: s.name }))
  );

  const activeEmployees = employees.filter((e) => e.status === "active");

  useEffect(() => {
    const base = defaultDate ?? new Date();
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 6, 0, 0, 0);
    const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 18, 0, 0, 0);
    setStartTime(formatForDatetimeLocal(start));
    setEndTime(formatForDatetimeLocal(end));
  }, [defaultDate ? format(defaultDate, "yyyy-MM-dd") : "today"]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const res = await authFetch("/shifts", token, {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          postId,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          status: "assigned",
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create shift");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700"
    >
      <h3 className="font-medium mb-4 text-slate-900 dark:text-white">New Shift</h3>
      {error && (
        <div className="mb-4 p-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          required
          className="input-modern"
        >
          <option value="">Select employee</option>
          {activeEmployees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.firstName} {e.lastName}
            </option>
          ))}
        </select>
        <select
          value={postId}
          onChange={(e) => setPostId(e.target.value)}
          required
          className="input-modern"
        >
          <option value="">Select post</option>
          {posts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.siteName} - {p.name}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          required
          className="input-modern"
        />
        <input
          type="datetime-local"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          required
          className="input-modern"
        />
      </div>
      <button type="submit" className="mt-4 btn-primary">
        Create Shift
      </button>
    </form>
  );
}
