"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { format, addDays, addWeeks, addMonths, startOfWeek, startOfMonth, endOfMonth, isSameDay, parseISO, differenceInMonths } from "date-fns";

type BulkPattern =
  | "all_days"
  | "weekdays"
  | "2_on_2_off"
  | "4_on_4_off"
  | "5_on_2_off"
  | "6_on_3_off"
  | "3_on_3_off"
  | "custom"
  | "custom_builder";

import { CustomPatternBuilder } from "./CustomPatternBuilder";
import type { CustomBlock } from "./CustomPatternBuilder";
import { generateFullRosterPDF, generateGuardRosterPDF } from "@/lib/roster-pdf";

const PATTERN_LABELS: Record<BulkPattern, string> = {
  all_days: "All days",
  weekdays: "Weekdays (Mon-Fri)",
  "2_on_2_off": "2 on 2 off",
  "4_on_4_off": "4 on 4 off",
  "5_on_2_off": "5 on 2 off",
  "6_on_3_off": "6 on 3 off",
  "3_on_3_off": "3 days, 3 nights, 3 off",
  custom: "Custom days",
  custom_builder: "Build custom pattern",
};

interface Shift {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  employee: { id: string; firstName: string; lastName: string };
  post: { id: string; name: string; shiftType: string | null; site: { name: string } };
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  status?: string;
  employeeType?: string;
}

interface Post {
  id: string;
  name: string;
  shiftType?: string | null;
}

interface Site {
  id: string;
  name: string;
  posts: Post[];
}

const statusColors: Record<string, string> = {
  created: "border border-black dark:border-white bg-neutral-50 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300",
  assigned: "border border-black dark:border-white bg-neutral-100 dark:bg-neutral-700/50 text-neutral-800 dark:text-neutral-200",
  active: "border border-black dark:border-white bg-neutral-200 dark:bg-neutral-600/50 text-neutral-900 dark:text-neutral-100",
  completed: "border border-black dark:border-white bg-neutral-50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400",
  verified: "border border-black dark:border-white bg-neutral-200 dark:bg-neutral-600/50 text-neutral-900 dark:text-neutral-100",
};

export default function RosteringPage() {
  const { token, user } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedDayForShift, setSelectedDayForShift] = useState<Date | null>(null);
  const [dateRange, setDateRange] = useState<"week" | "month">("week");
  const [viewOffset, setViewOffset] = useState(0);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [pattern, setPattern] = useState<BulkPattern>("3_on_3_off");
  const [customDays, setCustomDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [customBlocks, setCustomBlocks] = useState<CustomBlock[]>([
    { type: "day", count: 3 },
    { type: "night", count: 3 },
    { type: "off", count: 3 },
  ]);
  const [draggedGuard, setDraggedGuard] = useState<Employee | null>(null);
  const [dragOverPostId, setDragOverPostId] = useState<string | null>(null);
  const [dragOverSiteId, setDragOverSiteId] = useState<string | null>(null);

  const isDualPattern = pattern === "3_on_3_off" || pattern === "custom_builder";
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [deletingShiftId, setDeletingShiftId] = useState<string | null>(null);
  const [showResetMenu, setShowResetMenu] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showPdfMenu, setShowPdfMenu] = useState(false);

  const rosteredEmployees = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; firstName: string; lastName: string }[] = [];
    for (const s of shifts) {
      if (!seen.has(s.employee.id)) {
        seen.add(s.employee.id);
        list.push(s.employee);
      }
    }
    return list.sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
  }, [shifts]);

  const handleResetPerson = async (employeeId: string) => {
    if (!token) return;
    const emp = rosteredEmployees.find((e) => e.id === employeeId);
    const name = emp ? `${emp.firstName} ${emp.lastName}` : "this person";
    if (!confirm(`Reset all rostered shifts for ${name} in this month only?`)) return;
    setShowResetMenu(false);
    setResetting(true);
    setBulkError(null);
    try {
      const { startDate, endDate } = getMonthRangeForReset();
      const body: Record<string, unknown> = {
        startDate: startDate.slice(0, 10),
        endDate: endDate.slice(0, 10),
        employeeId,
      };
      if (selectedSiteId) body.siteId = selectedSiteId;
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6f3bcb'},body:JSON.stringify({sessionId:'6f3bcb',location:'rostering/page.tsx:handleResetPerson',message:'ResetPerson request',data:{body,employeeId,startDate:startDate.slice(0,10),endDate:endDate.slice(0,10),selectedSiteId,dateRange,viewOffset},hypothesisId:'H1,H2',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const res = await authFetch("/shifts/reset", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6f3bcb'},body:JSON.stringify({sessionId:'6f3bcb',location:'rostering/page.tsx:handleResetPerson:response',message:'ResetPerson response',data:{deleted:data?.deleted,ok:res.ok},hypothesisId:'H3',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (!res.ok) throw new Error(data?.message || data?.error || "Failed to reset");
      await refresh();
      if (data.deleted > 0) {
        setBulkError(`Removed ${data.deleted} shift(s) for ${name}.`);
        setTimeout(() => setBulkError(null), 4000);
      }
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed to reset");
    } finally {
      setResetting(false);
    }
  };

  const handleResetAll = async () => {
    if (!token) return;
    if (!confirm("Reset the entire roster for this month only? This will remove all created/assigned shifts in the visible month.")) return;
    setShowResetMenu(false);
    setResetting(true);
    setBulkError(null);
    try {
      const { startDate, endDate } = getMonthRangeForReset();
      const body: Record<string, unknown> = {
        startDate: startDate.slice(0, 10),
        endDate: endDate.slice(0, 10),
      };
      if (selectedSiteId) body.siteId = selectedSiteId;
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6f3bcb'},body:JSON.stringify({sessionId:'6f3bcb',location:'rostering/page.tsx:handleResetAll',message:'ResetAll request',data:{body,startDate:startDate.slice(0,10),endDate:endDate.slice(0,10),selectedSiteId,dateRange,viewOffset},hypothesisId:'H1,H2',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const res = await authFetch("/shifts/reset", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6f3bcb'},body:JSON.stringify({sessionId:'6f3bcb',location:'rostering/page.tsx:handleResetAll:response',message:'ResetAll response',data:{deleted:data?.deleted,ok:res.ok},hypothesisId:'H3',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (!res.ok) throw new Error(data?.message || data?.error || "Failed to reset");
      await refresh();
      if (data.deleted > 0) {
        setBulkError(`Removed ${data.deleted} shift(s) from roster.`);
        setTimeout(() => setBulkError(null), 4000);
      }
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed to reset");
    } finally {
      setResetting(false);
    }
  };

  const safeFilename = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "roster";

  const getGuardName = (id: string) => {
    const emp = rosteredEmployees.find((e) => e.id === id);
    return emp ? `${emp.firstName} ${emp.lastName}` : "Guard";
  };

  const handlePdfPreview = (employeeId?: string) => {
    const period = periodLabel || "";
    const generatedBy = user?.name ?? undefined;
    const blob = employeeId
      ? generateGuardRosterPDF(shifts.filter((s) => s.employee.id === employeeId), getGuardName(employeeId), period, generatedBy)
      : generateFullRosterPDF(shifts, calendarDays, period, generatedBy);
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) {
      handlePdfDownload(employeeId);
    } else {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    setShowPdfMenu(false);
  };

  const handlePdfDownload = (employeeId?: string) => {
    const period = periodLabel || "roster";
    const generatedBy = user?.name ?? undefined;
    const filename = employeeId
      ? `roster-${safeFilename(getGuardName(employeeId))}-${safeFilename(period)}.pdf`
      : `roster-${safeFilename(period)}.pdf`;
    const blob = employeeId
      ? generateGuardRosterPDF(shifts.filter((s) => s.employee.id === employeeId), getGuardName(employeeId), periodLabel || "", generatedBy)
      : generateFullRosterPDF(shifts, calendarDays, periodLabel || "", generatedBy);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setShowPdfMenu(false);
  };

  const handleRemoveShift = async (shift: Shift) => {
    if (!token) return;
    const name = `${shift.employee.firstName} ${shift.employee.lastName}`;
    if (!confirm(`Remove ${name} from this shift?`)) return;
    setDeletingShiftId(shift.id);
    try {
      const res = await authFetch(`/shifts/${shift.id}`, token, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || "Failed to remove shift");
      }
      await refresh();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed to remove shift");
    } finally {
      setDeletingShiftId(null);
    }
  };

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

  /** Returns the full month containing the visible period, for reset operations. */
  const getMonthRangeForReset = () => {
    const { startDate } = getDateRangeParams();
    const start = startOfMonth(parseISO(startDate.slice(0, 10)));
    const end = endOfMonth(start);
    start.setHours(0, 0, 0, 0);
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

  const availableGuards = useMemo(
    () =>
      employees.filter(
        (e) =>
          e.employeeType === "security" &&
          ["active", "training", "hired"].includes(e.status ?? "")
      ),
    [employees]
  );

  const postsForSelectedSite = useMemo(() => {
    if (!selectedSiteId) return [];
    const site = sites.find((s) => s.id === selectedSiteId);
    return site?.posts ?? [];
  }, [sites, selectedSiteId]);

  const handleBulkDrop = async (employeeId: string, postId: string) => {
    if (!token) return;
    setBulkError(null);
    const { startDate, endDate } = getDateRangeParams();
    const body: Record<string, unknown> = {
      employeeId,
      postId,
      startDate: startDate.slice(0, 10),
      endDate: endDate.slice(0, 10),
      pattern,
    };
    if (pattern === "custom") body.customDays = customDays;
    try {
      const res = await authFetch("/shifts/bulk", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create shifts");
      refresh();
      if (data.deleted > 0 && data.created > 0) {
        setBulkError(`Replaced ${data.deleted} shift(s), created ${data.created} for the period.`);
        setTimeout(() => setBulkError(null), 4000);
      } else if (data.errors?.length) {
        setBulkError(`Created ${data.created}. Some skipped: ${data.errors.slice(0, 3).join("; ")}`);
      }
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed to create shifts");
    }
  };

  const handleBulkDropOnSite = async (employeeId: string, siteId: string) => {
    if (!token) return;
    setBulkError(null);
    const { startDate, endDate } = getDateRangeParams();
    const body: Record<string, unknown> = {
      employeeId,
      siteId,
      startDate: startDate.slice(0, 10),
      endDate: endDate.slice(0, 10),
      pattern,
    };
    if (pattern === "custom_builder") body.customBlocks = customBlocks;
    try {
      const res = await authFetch("/shifts/bulk", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to create shifts");
      refresh();
      if (data.deleted > 0 && data.created > 0) {
        setBulkError(`Replaced ${data.deleted} shift(s), created ${data.created} for the period.`);
        setTimeout(() => setBulkError(null), 4000);
      } else if (data.errors?.length) {
        setBulkError(`Created ${data.created}. Some skipped: ${data.errors.slice(0, 3).join("; ")}`);
      }
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed to create shifts");
    }
  };

  const refresh = () => {
    if (!token) return Promise.resolve();
    const { startDate, endDate } = getDateRangeParams();
    return Promise.all([
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
        <div className="h-10 bg-neutral-200 dark:bg-neutral-700 rounded w-48 mb-4" />
        <div className="flex-1 bg-neutral-200 dark:bg-neutral-700 rounded-sm" />
      </div>
    );
  }

  const periodLabel =
    calendarDays.length > 0
      ? dateRange === "week"
        ? format(calendarDays[0], "d MMM") + " - " + format(calendarDays[calendarDays.length - 1], "d MMM yyyy")
        : format(calendarDays[0], "MMMM yyyy")
      : "";

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[500px] w-full">
      <aside className="w-64 shrink-0 card-wireframe flex flex-col overflow-hidden">
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 shrink-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-3">
            Drag guard to post
          </h3>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">Site</label>
          <select
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            className="input-modern py-2 text-sm w-full mb-3"
          >
            <option value="">Select site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">Pattern</label>
          <select
            value={pattern}
            onChange={(e) => setPattern(e.target.value as BulkPattern)}
            className="input-modern py-2 text-sm w-full"
          >
            {(Object.keys(PATTERN_LABELS) as BulkPattern[]).map((p) => (
              <option key={p} value={p}>
                {PATTERN_LABELS[p]}
              </option>
            ))}
          </select>
          {pattern === "custom" && (
            <div className="mt-2 flex flex-wrap gap-1">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
                <label key={day} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={customDays.includes(i)}
                    onChange={(e) =>
                      setCustomDays((prev) =>
                        e.target.checked ? [...prev, i] : prev.filter((d) => d !== i)
                      )
                    }
                    className="rounded"
                  />
                  {day}
                </label>
              ))}
            </div>
          )}
          {pattern === "custom_builder" && (
            <CustomPatternBuilder blocks={customBlocks} onChange={setCustomBlocks} />
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {selectedSiteId && (
            <>
              {isDualPattern ? (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2">
                    Drop guard on site
                  </h4>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverSiteId(selectedSiteId);
                    }}
                    onDragLeave={() => setDragOverSiteId(null)}
                    onDrop={async (e) => {
                      e.preventDefault();
                      setDragOverSiteId(null);
                      const guardId = e.dataTransfer.getData("guardId");
                      if (guardId) {
                        await handleBulkDropOnSite(guardId, selectedSiteId);
                      }
                      setDraggedGuard(null);
                    }}
                    className={`min-h-[56px] p-3 rounded-sm border-2 border-dashed flex items-center justify-center text-sm font-medium transition-colors ${
                      dragOverSiteId === selectedSiteId
                        ? "border-neutral-500 dark:border-neutral-400 bg-neutral-100 dark:bg-neutral-800"
                        : "border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400"
                    }`}
                  >
                    {sites.find((s) => s.id === selectedSiteId)?.name ?? "Site"}
                  </div>
                </div>
              ) : (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2">
                    Posts (drop zone)
                  </h4>
                  <div className="space-y-2">
                    {postsForSelectedSite.map((post) => (
                      <div
                        key={post.id}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDragOverPostId(post.id);
                        }}
                        onDragLeave={() => setDragOverPostId(null)}
                        onDrop={async (e) => {
                          e.preventDefault();
                          setDragOverPostId(null);
                          const guardId = e.dataTransfer.getData("guardId");
                          if (guardId) {
                            await handleBulkDrop(guardId, post.id);
                          }
                          setDraggedGuard(null);
                        }}
                        className={`min-h-[48px] p-3 rounded-sm border-2 border-dashed flex items-center justify-center text-sm font-medium transition-colors ${
                          dragOverPostId === post.id
                            ? "border-black dark:border-white bg-neutral-100 dark:bg-neutral-800"
                            : "border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400"
                        }`}
                      >
                        {post.name} {post.shiftType ? `(${post.shiftType})` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2">
                  Available guards
                </h4>
                <div className="space-y-1">
                  {availableGuards.map((g) => (
                    <div
                      key={g.id}
                      draggable
                      onDragStart={(e) => {
                        setDraggedGuard(g);
                        e.dataTransfer.setData("guardId", g.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDraggedGuard(null)}
                      className={`px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-700 text-sm cursor-grab active:cursor-grabbing ${
                        draggedGuard?.id === g.id ? "opacity-50" : "bg-neutral-50 dark:bg-neutral-800/50 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      }`}
                    >
                      {g.firstName} {g.lastName}
                    </div>
                  ))}
                  {availableGuards.length === 0 && (
                    <p className="text-xs text-neutral-500 py-2">No guards available</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        {bulkError && (
          <div className="p-3 border-t border-neutral-200 dark:border-neutral-700 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-xs">
            {bulkError}
          </div>
        )}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
      <div className="shrink-0 p-6 pb-4">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-neutral-800 dark:text-neutral-100">Rostering</h1>
            {periodLabel && calendarDays.length > 0 && (
              <input
                type="month"
                value={format(calendarDays[0], "yyyy-MM")}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  const targetDate = parseISO(`${val}-01`);
                  const now = new Date();
                  const offset = differenceInMonths(targetDate, startOfMonth(now));
                  setDateRange("month");
                  setViewOffset(offset);
                }}
                className="block mt-0.5 text-sm text-neutral-500 dark:text-neutral-400 bg-transparent border border-transparent rounded px-1 py-0.5 cursor-pointer hover:text-neutral-700 dark:hover:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:border-transparent [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60"
                title="Click to select month"
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center h-11 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/30 overflow-hidden">
              <button
                type="button"
                onClick={() => setViewOffset((o) => o - 1)}
                className="h-full px-3 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors text-neutral-600 dark:text-neutral-400"
                aria-label="Previous"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setViewOffset(0)}
                className="h-full px-4 text-sm font-medium border-x border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors text-neutral-700 dark:text-neutral-300"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setViewOffset((o) => o + 1)}
                className="h-full px-3 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors text-neutral-600 dark:text-neutral-400"
                aria-label="Next"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDateRange("month");
                  setViewOffset((o) => o + 1);
                }}
                className="h-full px-3 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors text-neutral-600 dark:text-neutral-400 border-l border-neutral-200 dark:border-neutral-700"
                aria-label="Next month"
                title="Jump to next month"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <select
              value={dateRange}
              onChange={(e) => { setDateRange(e.target.value as "week" | "month"); setViewOffset(0); }}
              className="input-modern h-11 min-w-[100px] cursor-pointer"
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
            <button
              onClick={() => { setSelectedDayForShift(null); setShowForm(!showForm); }}
              className="btn-secondary h-11 flex items-center gap-2 shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {showForm ? "Cancel" : "Add Shift"}
            </button>
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => { setShowResetMenu(false); setShowPdfMenu((v) => !v); }}
                className="h-11 px-5 py-2.5 text-sm font-semibold rounded-sm border-2 border-black dark:border-white bg-transparent dark:bg-transparent text-neutral-900 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 dark:focus:ring-offset-neutral-900 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                PDF
              </button>
              {showPdfMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    aria-hidden
                    onClick={() => setShowPdfMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 z-20 min-w-[260px] py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg">
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                      Full roster
                    </div>
                    <button
                      type="button"
                      onClick={() => handlePdfPreview()}
                      className="w-full px-4 py-2 text-left text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePdfDownload()}
                      className="w-full px-4 py-2 text-left text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      Download
                    </button>
                    {rosteredEmployees.length > 0 && (
                      <>
                        <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />
                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                          Per guard
                        </div>
                        {rosteredEmployees.map((e) => (
                          <div key={e.id} className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => handlePdfPreview(e.id)}
                              className="flex-1 px-4 py-2 text-left text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePdfDownload(e.id)}
                              className="flex-1 px-4 py-2 text-left text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              Download
                            </button>
                            <span className="px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400 truncate min-w-0">
                              {e.firstName} {e.lastName}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => { setShowPdfMenu(false); setShowResetMenu((v) => !v); }}
                disabled={resetting}
                className="btn-secondary h-11 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Reset
              </button>
              {showResetMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    aria-hidden
                    onClick={() => setShowResetMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 z-20 min-w-[200px] py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg">
                    <button
                      type="button"
                      onClick={handleResetAll}
                      className="w-full px-4 py-2.5 text-left text-sm font-medium text-neutral-900 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      Reset whole roster
                    </button>
                    {rosteredEmployees.length > 0 && (
                      <>
                        <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />
                        <div className="px-3 py-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                          Reset for person
                        </div>
                        {rosteredEmployees.map((e) => (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => handleResetPerson(e.id)}
                            className="w-full px-4 py-2 text-left text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            {e.firstName} {e.lastName}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
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
        <div className="flex-1 min-h-0 rounded-lg card-wireframe relative overflow-y-auto overflow-x-hidden">
          <div className="grid min-h-full w-full" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((wd, i) => (
              <div
                key={wd}
                className={`shrink-0 py-4 px-4 text-center text-[11px] font-semibold uppercase tracking-[0.08em] border-b flex items-center justify-center ${
                  i >= 5
                    ? "text-neutral-400 dark:text-neutral-500 bg-neutral-50/80 dark:bg-neutral-800/30 border-neutral-200 dark:border-neutral-700"
                    : "text-neutral-600 dark:text-neutral-400 bg-gradient-to-b from-neutral-50 to-neutral-100/50 dark:from-neutral-800/60 dark:to-neutral-800/30 border-neutral-200 dark:border-neutral-700"
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
                    className="min-h-[100px] bg-neutral-50/40 dark:bg-neutral-800/10 border-b border-r border-neutral-200 dark:border-neutral-700"
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
                  className={`flex flex-col min-h-0 border-b border-r border-neutral-200 dark:border-neutral-700 last:border-r-0 transition-colors ${
                    isToday
                      ? "bg-neutral-50/50 dark:bg-neutral-950/30"
                      : isWeekend
                        ? "bg-neutral-50/30 dark:bg-neutral-800/10"
                        : "bg-white dark:bg-neutral-900"
                  }`}
                >
                  <div className="shrink-0 py-2.5 px-3 text-center">
                    <span
                      className={`inline-flex items-center justify-center w-9 h-9 rounded-sm text-sm font-semibold transition-all ${
                        isToday
                          ? "bg-neutral-600 text-neutral-100 shadow-lg shadow-neutral-500/25 dark:shadow-neutral-500/20 ring-2 ring-neutral-400/30"
                          : "text-neutral-600 dark:text-neutral-300 bg-neutral-100/80 dark:bg-neutral-700/50"
                      }`}
                    >
                      {format(day, "d")}
                    </span>
                    <div className={`text-[10px] font-medium mt-1 ${isToday ? "text-neutral-600 dark:text-neutral-400" : "text-neutral-400 dark:text-neutral-500"}`}>
                      {format(day, "MMM")}
                    </div>
                  </div>
                  <div
                    onClick={() => { setSelectedDayForShift(day); setShowForm(true); }}
                    className="flex-1 px-3 py-2.5 space-y-2 overflow-y-auto min-h-0 cursor-pointer group"
                  >
                    {dayShifts.length === 0 ? (
                      <div className="flex-1 min-h-[60px] flex items-center justify-center rounded-md border-2 border-dashed border-neutral-300 dark:border-neutral-600 group-hover:border-neutral-500 dark:group-hover:border-neutral-400 group-hover:bg-neutral-50/30 dark:group-hover:bg-neutral-950/20 transition-all duration-200">
                        <span className="text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-500 dark:group-hover:text-neutral-400 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
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
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveShift(s);
                          }}
                          className={`px-3 py-2 rounded-sm text-xs font-medium shrink-0 transition-all duration-200 hover:scale-[1.02] cursor-pointer group/guard ${
                            deletingShiftId === s.id
                              ? "opacity-60 pointer-events-none"
                              : "hover:ring-2 hover:ring-rose-500/50 dark:hover:ring-rose-400/50"
                          } ${
                            s.post.shiftType === "night"
                              ? "bg-gradient-to-br from-neutral-500/15 to-neutral-600/10 dark:from-neutral-500/20 dark:to-neutral-600/10 text-neutral-800 dark:text-neutral-200 border border-black dark:border-white"
                              : "bg-gradient-to-br from-neutral-500/15 to-orange-500/10 dark:from-neutral-500/20 dark:to-orange-600/10 text-neutral-900 dark:text-neutral-100 border border-black dark:border-white"
                          }`}
                          title="Click to remove from roster"
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
            <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-neutral-900 pointer-events-none rounded-sm">
              <div className="text-center px-8">
                <div className="w-20 h-20 mx-auto mb-4 rounded-sm bg-gradient-to-br from-neutral-100 to-neutral-50 dark:from-neutral-800 dark:to-neutral-800/50 flex items-center justify-center ring-1 ring-neutral-200/50 dark:ring-neutral-700/50">
                  <svg className="w-10 h-10 text-neutral-400 dark:text-neutral-500" fill="none" stroke="currentColor" strokeWidth={1.25} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-neutral-600 dark:text-neutral-400 font-semibold">No shifts scheduled</p>
                <p className="text-sm text-neutral-400 dark:text-neutral-500 mt-1">Click on a day to add a shift</p>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-8 mt-4 pl-1">
          <span className="flex items-center gap-2.5 text-sm text-neutral-600 dark:text-neutral-400">
            <span className="w-4 h-4 rounded-lg bg-gradient-to-br from-neutral-400/30 to-orange-500/20 dark:from-neutral-500/30 dark:to-orange-600/20 border border-black dark:border-white" />
            <span className="font-medium">Day shift</span>
          </span>
          <span className="flex items-center gap-2.5 text-sm text-neutral-600 dark:text-neutral-400">
            <span className="w-4 h-4 rounded-lg bg-gradient-to-br from-neutral-400/30 to-neutral-600/20 dark:from-neutral-500/30 dark:to-neutral-600/20 border border-black dark:border-white" />
            <span className="font-medium">Night shift</span>
          </span>
        </div>
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
      className="card-wireframe p-4"
    >
      <h3 className="font-medium mb-4 text-neutral-900 dark:text-neutral-100">New Shift</h3>
      {error && (
        <div className="mb-4 p-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-sm">
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
