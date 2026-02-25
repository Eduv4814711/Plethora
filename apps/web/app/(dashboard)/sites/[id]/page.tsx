"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { format, addDays, addWeeks, addMonths, startOfWeek, startOfMonth, isSameDay, isWithinInterval, parseISO } from "date-fns";

const SERVICE_TYPE_LABELS: Record<string, string> = {
  guarding: "Guarding",
  access_control: "Access Control",
  patrols: "Patrols",
  close_protection: "Close Protection",
  reaction: "Reaction / Response",
  control_room: "Control Room",
  monitoring: "Monitoring",
  other: "Other",
};

const SHIFT_LABELS: Record<string, string> = {
  day: "Day Shift (06:00 – 18:00)",
  night: "Night Shift (18:00 – 06:00)",
};

const SHIFT_STATUS_COLORS: Record<string, string> = {
  created: "bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300",
  assigned: "border border-black dark:border-white bg-neutral-100 dark:bg-neutral-700/50 text-neutral-800 dark:text-neutral-200",
  active: "border border-black dark:border-white bg-neutral-200 dark:bg-neutral-600/50 text-neutral-900 dark:text-neutral-100",
  completed: "bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400",
  verified: "border border-black dark:border-white bg-neutral-200 dark:bg-neutral-600/50 text-neutral-900 dark:text-neutral-100",
};

interface PostAssignedGuard {
  id: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    status: string;
    phone: string | null;
  };
}

interface Post {
  id: string;
  name: string;
  shiftType: string | null;
  assignedGuards: PostAssignedGuard[];
}

interface Site {
  id: string;
  name: string;
  location: string | null;
  physicalAddress: string | null;
  contactPersonName: string | null;
  contactPersonPhone: string | null;
  serviceType: string | null;
  posts: Post[];
  assignedGuards: { employee: { id: string; firstName: string; lastName: string; status: string; phone: string | null } }[];
}

interface Guard {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  phone: string | null;
}

interface Shift {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  employee: { id: string; firstName: string; lastName: string };
  post: { id: string; name: string; shiftType: string | null };
}

export default function SiteDetailPage() {
  const params = useParams();
  const { token, user } = useAuth();
  const siteId = params.id as string;
  const [site, setSite] = useState<Site | null>(null);
  const [loading, setLoading] = useState(true);
  const [availableGuards, setAvailableGuards] = useState<Guard[]>([]);
  const [showAddPost, setShowAddPost] = useState(false);
  const [draggedGuard, setDraggedGuard] = useState<{ guard: Guard; source: "pool" | string } | null>(null);
  const [dragOverPost, setDragOverPost] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [dateRange, setDateRange] = useState<"week" | "month">("week");
  const [viewOffset, setViewOffset] = useState(0);
  const [showAddShift, setShowAddShift] = useState(false);
  const [selectedDayForShift, setSelectedDayForShift] = useState<Date | null>(null);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [deletingShift, setDeletingShift] = useState<Shift | null>(null);
  const [employeesForShifts, setEmployeesForShifts] = useState<Guard[]>([]);
  const canManage = ["admin", "operations_manager", "hr_payroll", "supervisor", "controller"].includes((user as { role?: string })?.role ?? "");

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
    if (!token || !siteId) return;
    const { startDate, endDate } = getDateRangeParams();
    Promise.all([
      authFetch(`/sites/${siteId}`, token).then((r) => r.json()),
      authFetch("/employees?limit=200", token).then((r) => r.json()),
      authFetch(`/shifts?siteId=${siteId}&startDate=${startDate}&endDate=${endDate}`, token).then((r) => r.json()),
    ]).then(([siteData, empData, shiftsRes]) => {
      setSite(siteData);
      const guards = (empData.data || []).filter(
        (e: Guard & { employeeType?: string }) =>
          e.employeeType === "security" && ["active", "training", "hired"].includes(e.status)
      );
      setAvailableGuards(guards);
      setEmployeesForShifts(guards);
      setShifts(shiftsRes.data || []);
    });
  };

  const refreshShifts = () => {
    if (!token || !siteId) return;
    const { startDate, endDate } = getDateRangeParams();
    authFetch(`/shifts?siteId=${siteId}&startDate=${startDate}&endDate=${endDate}`, token)
      .then((r) => r.json())
      .then((d) => setShifts(d.data || []));
  };

  useEffect(() => {
    if (!token || !siteId) return;
    refresh();
    setLoading(false);
  }, [token, siteId]);

  useEffect(() => {
    if (token && siteId && !loading) refreshShifts();
  }, [token, siteId, dateRange, viewOffset]);

  const getGuardsInPost = (postId: string): Guard[] => {
    const post = site?.posts.find((p) => p.id === postId);
    return post?.assignedGuards?.map((a) => a.employee) ?? [];
  };

  const getUnassignedGuards = (): Guard[] => {
    const assignedIds = new Set(
      site?.posts.flatMap((p) => p.assignedGuards?.map((a) => a.employee.id) ?? []) ?? []
    );
    return availableGuards.filter((g) => !assignedIds.has(g.id));
  };

  const handleDragStart = (guard: Guard, source: "pool" | string) => {
    setDraggedGuard({ guard, source });
  };

  const handleDragEnd = () => {
    setDraggedGuard(null);
    setDragOverPost(null);
  };

  const handleDragOver = (e: React.DragEvent, postId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverPost(postId);
  };

  const handleDragLeave = () => {
    setDragOverPost(null);
  };

  const handleDrop = async (e: React.DragEvent, postId: string) => {
    e.preventDefault();
    setDragOverPost(null);
    if (!draggedGuard || !token) return;

    const { guard, source } = draggedGuard;
    setDraggedGuard(null);

    if (source === postId) return;

    if (source !== "pool") {
      await authFetch(`/sites/${siteId}/posts/${source}/guards/${guard.id}`, token, { method: "DELETE" });
    }

    const res = await authFetch(`/sites/${siteId}/posts/${postId}/guards`, token, {
      method: "POST",
      body: JSON.stringify({ employeeId: guard.id }),
    });

    if (res.ok) refresh();
  };

  const handleRemoveFromPost = async (postId: string, employeeId: string) => {
    if (!token) return;
    await authFetch(`/sites/${siteId}/posts/${postId}/guards/${employeeId}`, token, { method: "DELETE" });
    refresh();
  };

  if (loading || !site) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-10 bg-neutral-200 dark:bg-neutral-700 rounded w-64" />
        <div className="h-96 bg-neutral-200 dark:bg-neutral-700 rounded-sm" />
      </div>
    );
  }

  const unassignedGuards = getUnassignedGuards();

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/sites"
            className="p-2 rounded-sm border border-black dark:border-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <svg className="w-5 h-5 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">{site.name}</h1>
            <p className="text-neutral-500 dark:text-neutral-400 mt-0.5 text-sm">
              Manage posts and assign guards — drag guards into posts
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {deleteError && (
            <div className="p-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm">
              {deleteError}
              <button onClick={() => setDeleteError(null)} className="ml-2 underline">Dismiss</button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Posts</h2>
            {canManage && (
              <button
                onClick={() => setShowAddPost(!showAddPost)}
                className="btn-primary flex items-center gap-2 text-sm py-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {showAddPost ? "Cancel" : "Add Post"}
              </button>
            )}
          </div>

          {showAddPost && canManage && (
            <AddPostForm siteId={siteId} token={token!} onSuccess={() => { setShowAddPost(false); refresh(); }} />
          )}

          <div className="space-y-5">
            {site.posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                siteId={siteId}
                token={token!}
                guards={getGuardsInPost(post.id)}
                isDragOver={dragOverPost === post.id}
                canManage={canManage}
                onDragOver={(e) => handleDragOver(e, post.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, post.id)}
                onRemoveGuard={(empId) => handleRemoveFromPost(post.id, empId)}
                onDragStart={(guard) => handleDragStart(guard, post.id)}
                onDragEnd={handleDragEnd}
                onDelete={refresh}
                onError={(msg) => setDeleteError(msg || null)}
              />
            ))}
          </div>

          {site.posts.length === 0 && (
            <div className="text-center py-12 rounded-sm border-2 border-dashed border-black dark:border-white bg-neutral-50/50 dark:bg-neutral-900/30">
              <p className="font-medium text-neutral-600 dark:text-neutral-400">No posts yet</p>
              <p className="text-sm text-neutral-500 mt-1">Add a Day or Night shift post to get started</p>
              {canManage && (
                <button onClick={() => setShowAddPost(true)} className="mt-4 btn-primary">Add Post</button>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="sticky top-6 p-5 bg-white dark:bg-neutral-900 rounded-sm border border-black dark:border-white ">
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wider mb-3">
              Available Guards
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
              Drag guards into posts to assign them
            </p>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {unassignedGuards.map((g) => (
                <GuardChip
                  key={g.id}
                  guard={g}
                  draggable={canManage}
                  onDragStart={() => handleDragStart(g, "pool")}
                  onDragEnd={handleDragEnd}
                  isDragging={draggedGuard?.guard.id === g.id}
                />
              ))}
              {unassignedGuards.length === 0 && (
                <p className="text-sm text-neutral-500 py-4">All guards assigned</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Scheduled Shifts</h2>
            {calendarDays.length > 0 && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
                {dateRange === "week"
                  ? `${format(calendarDays[0], "d MMM")} – ${format(calendarDays[calendarDays.length - 1], "d MMM yyyy")}`
                  : format(calendarDays[0], "MMMM yyyy")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-0.5 rounded-sm border border-black dark:border-white p-1 bg-neutral-50/50 dark:bg-neutral-800/30">
              <button
                type="button"
                onClick={() => setViewOffset((o) => o - 1)}
                className="p-2 rounded-sm hover:bg-white dark:hover:bg-neutral-700 transition-colors"
                aria-label="Previous"
              >
                <svg className="w-4 h-4 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setViewOffset(0)}
                className="px-3 py-2 text-sm font-medium rounded-sm hover:bg-white dark:hover:bg-neutral-700 transition-colors text-neutral-700 dark:text-neutral-300"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setViewOffset((o) => o + 1)}
                className="p-2 rounded-sm hover:bg-white dark:hover:bg-neutral-700 transition-colors"
                aria-label="Next"
              >
                <svg className="w-4 h-4 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <select
              value={dateRange}
              onChange={(e) => { setDateRange(e.target.value as "week" | "month"); setViewOffset(0); }}
              className="input-modern w-auto min-w-[7rem] py-2.5 px-3 text-sm rounded-sm"
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
            {canManage && site.posts.length > 0 && (
              <button
                onClick={() => { setSelectedDayForShift(null); setShowAddShift(!showAddShift); }}
                className="btn-primary flex items-center gap-2 text-sm shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {showAddShift ? "Cancel" : "Add Shift"}
              </button>
            )}
          </div>
        </div>

        {showAddShift && canManage && site.posts.length > 0 && (
          <SiteShiftForm
            token={token!}
            posts={site.posts}
            employees={employeesForShifts}
            defaultDate={selectedDayForShift ?? undefined}
            onSuccess={() => {
              setShowAddShift(false);
              setSelectedDayForShift(null);
              refreshShifts();
            }}
          />
        )}

        <div className="rounded-sm overflow-hidden bg-white dark:bg-neutral-900 relative border border-black dark:border-white shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08),0_8px_16px_-8px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.3)]">
          <div className="grid min-h-[400px] w-full" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((wd, i) => (
              <div
                key={wd}
                className={`shrink-0 py-3.5 px-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] border-b ${
                  i >= 5
                    ? "text-neutral-400 dark:text-neutral-500 bg-neutral-50/80 dark:bg-neutral-800/30 border-black dark:border-white"
                    : "text-neutral-600 dark:text-neutral-400 bg-gradient-to-b from-neutral-50 to-neutral-100/50 dark:from-neutral-800/60 dark:to-neutral-800/30 border-black dark:border-white"
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
                    className="min-h-[100px] bg-neutral-50/40 dark:bg-neutral-800/10 border-b border-r border-black dark:border-white"
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
                  className={`flex flex-col min-h-0 border-b border-r border-black dark:border-white transition-colors ${
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
                    onClick={canManage ? () => { setSelectedDayForShift(day); setShowAddShift(true); } : undefined}
                    className={`flex-1 px-3 py-2.5 space-y-2 overflow-y-auto min-h-0 max-h-[200px] ${canManage ? "cursor-pointer group" : ""}`}
                  >
                    {dayShifts.length === 0 && canManage ? (
                      <div className="flex-1 min-h-[60px] flex items-center justify-center rounded-sm border-2 border-dashed border-black dark:border-white/60 group-hover:border-black dark:group-hover:border-white group-hover:bg-neutral-50/30 dark:group-hover:bg-neutral-950/20 transition-all duration-200">
                        <span className="text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-500 dark:group-hover:text-neutral-400 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Add shift
                        </span>
                      </div>
                    ) : dayShifts.length === 0 ? (
                      <div className="flex-1 min-h-[60px]" />
                    ) : (
                      dayShifts.map((s) => (
                        <div
                          key={s.id}
                          onClick={(e) => e.stopPropagation()}
                          className={`px-3 py-2 rounded-sm text-xs font-medium shrink-0 transition-all duration-200 hover:scale-[1.02] ${
                            s.post.shiftType === "night"
                              ? "bg-gradient-to-br from-neutral-500/15 to-neutral-600/10 dark:from-neutral-500/20 dark:to-neutral-600/10 text-neutral-800 dark:text-neutral-200 border border-black dark:border-white "
                              : "bg-gradient-to-br from-neutral-500/15 to-orange-500/10 dark:from-neutral-500/20 dark:to-orange-600/10 text-neutral-900 dark:text-neutral-100 border border-black dark:border-white "
                          }`}
                        >
                          <span className="truncate block">{s.employee.firstName} {s.employee.lastName}</span>
                          {canManage && (s.status === "created" || s.status === "assigned") && (
                            <div className="flex gap-1.5 mt-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setEditingShift(s); }}
                                className="text-[10px] text-neutral-600 dark:text-neutral-400 hover:underline font-medium"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setDeletingShift(s); }}
                                className="text-[10px] text-red-600 dark:text-red-400 hover:underline font-medium"
                              >
                                Delete
                              </button>
                            </div>
                          )}
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
            <span className="w-4 h-4 rounded-lg bg-gradient-to-br from-neutral-400/30 to-orange-500/20 dark:from-neutral-500/30 dark:to-orange-600/20 border border-black dark:border-white " />
            <span className="font-medium">Day shift</span>
          </span>
          <span className="flex items-center gap-2.5 text-sm text-neutral-600 dark:text-neutral-400">
            <span className="w-4 h-4 rounded-lg bg-gradient-to-br from-neutral-400/30 to-neutral-600/20 dark:from-neutral-500/30 dark:to-neutral-600/20 border border-black dark:border-white " />
            <span className="font-medium">Night shift</span>
          </span>
        </div>
      </div>

      {editingShift && (
        <EditShiftModal
          shift={editingShift}
          token={token!}
          posts={site.posts}
          employees={employeesForShifts}
          onClose={() => setEditingShift(null)}
          onSuccess={() => {
            setEditingShift(null);
            refreshShifts();
          }}
        />
      )}

      {deletingShift && (
        <DeleteShiftModal
          shift={deletingShift}
          token={token!}
          onClose={() => setDeletingShift(null)}
          onSuccess={() => {
            setDeletingShift(null);
            refreshShifts();
          }}
        />
      )}

      <div className="p-4 rounded-sm bg-neutral-50 dark:bg-neutral-800/50 border border-black dark:border-white">
        <h4 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Site info</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {(site.physicalAddress || site.location) && (
            <p className="text-neutral-600 dark:text-neutral-400">
              <span className="font-medium">Address:</span> {site.physicalAddress || site.location}
            </p>
          )}
          {(site.contactPersonName || site.contactPersonPhone) && (
            <p className="text-neutral-600 dark:text-neutral-400">
              <span className="font-medium">Contact:</span> {site.contactPersonName}
              {site.contactPersonPhone && ` • ${site.contactPersonPhone}`}
            </p>
          )}
          {site.serviceType && (
            <p className="text-neutral-600 dark:text-neutral-400">
              <span className="font-medium">Service:</span> {SERVICE_TYPE_LABELS[site.serviceType] || site.serviceType}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PostCard({
  post,
  siteId,
  token,
  guards,
  isDragOver,
  canManage,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemoveGuard,
  onDragStart,
  onDragEnd,
  onDelete,
  onError,
}: {
  post: Post;
  siteId: string;
  token: string;
  guards: Guard[];
  isDragOver: boolean;
  canManage: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onRemoveGuard: (empId: string) => void;
  onDragStart: (guard: Guard) => void;
  onDragEnd: () => void;
  onDelete: () => void;
  onError?: (msg: string | null) => void;
}) {
  const shiftLabel = post.shiftType ? SHIFT_LABELS[post.shiftType] : "Shift";

  return (
    <div
      onDragOver={canManage ? onDragOver : undefined}
      onDragLeave={canManage ? onDragLeave : undefined}
      onDrop={canManage ? onDrop : undefined}
      className={`p-5 rounded-sm border-2 transition-all duration-200 ${
        isDragOver
          ? "border-black dark:border-white bg-neutral-50/50 dark:bg-neutral-950/30"
          : "border-black dark:border-white bg-white dark:bg-neutral-900"
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-sm flex items-center justify-center shrink-0 ${
          post.shiftType === "day"
            ? "bg-neutral-100 dark:bg-neutral-900/30"
            : "bg-neutral-800 dark:bg-neutral-700"
        }`}>
          {post.shiftType === "day" ? (
            <svg className="w-5 h-5 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </div>
        <div>
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{post.name}</h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{shiftLabel}</p>
        </div>
        </div>
        {canManage && (
          <button
            onClick={async () => {
              if (!confirm("Delete this post?")) return;
              onError?.(null);
              try {
                const res = await authFetch(`/sites/${siteId}/posts/${post.id}`, token, { method: "DELETE" });
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  onError?.(data.message || data.error || "Failed to delete post");
                  return;
                }
                onDelete();
              } catch {
                onError?.("Failed to delete post");
              }
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-neutral-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            title="Delete post"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        )}
      </div>

      <div className="min-h-[80px] rounded-sm bg-neutral-50 dark:bg-neutral-800/50 border border-dashed border-black dark:border-white p-3">
        {guards.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-4">
            {canManage ? "Drag guards here" : "No guards assigned"}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {guards.map((g) => (
              <GuardChip
                key={g.id}
                guard={g}
                draggable={canManage}
                onDragStart={() => onDragStart(g)}
                onDragEnd={onDragEnd}
                onRemove={canManage ? () => onRemoveGuard(g.id) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GuardChip({
  guard,
  draggable,
  onDragStart,
  onDragEnd,
  onRemove,
  isDragging,
}: {
  guard: Guard;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onRemove?: () => void;
  isDragging?: boolean;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        if (draggable) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", guard.id);
          onDragStart();
        }
      }}
      onDragEnd={onDragEnd}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-sm text-sm font-medium bg-white dark:bg-neutral-800 border border-black dark:border-white  cursor-grab active:cursor-grabbing select-none ${
        isDragging ? "opacity-50 scale-95" : "hover:shadow-md hover:border-black dark:hover:border-white"
      } ${draggable ? "" : "cursor-default"}`}
    >
      <span className="w-2 h-2 rounded-full bg-neutral-500" />
      <span className="text-neutral-700 dark:text-neutral-300">
        {guard.firstName} {guard.lastName}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-1 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-neutral-400 hover:text-red-600 transition-colors"
          title="Remove"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

function AddPostForm({
  siteId,
  token,
  onSuccess,
}: {
  siteId: string;
  token: string;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [shiftType, setShiftType] = useState<"day" | "night">("day");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await authFetch(`/sites/${siteId}/posts`, token, {
        method: "POST",
        body: JSON.stringify({ name, shiftType }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to create post");
      }
      setName("");
      setShiftType("day");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-5 bg-white dark:bg-neutral-900 rounded-sm border border-black dark:border-white">
      <h4 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-4">New Post</h4>
      {error && (
        <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <input
          placeholder="Post name (e.g. Main Gate)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="input-modern"
        />
        <select
          value={shiftType}
          onChange={(e) => setShiftType(e.target.value as "day" | "night")}
          className="input-modern"
        >
          <option value="day">Day Shift (06:00 – 18:00)</option>
          <option value="night">Night Shift (18:00 – 06:00)</option>
        </select>
      </div>
      <div className="mt-4 flex gap-3">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Creating..." : "Create Post"}
        </button>
      </div>
    </form>
  );
}

function SiteShiftForm({
  token,
  posts,
  employees,
  defaultDate,
  onSuccess,
}: {
  token: string;
  posts: Post[];
  employees: Guard[];
  defaultDate?: Date;
  onSuccess: () => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [postId, setPostId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const formatForDatetimeLocal = (d: Date) => {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handlePostChange = (selectedPostId: string) => {
    setPostId(selectedPostId);
    if (!selectedPostId) {
      setStartTime("");
      setEndTime("");
      return;
    }
    const post = posts.find((p) => p.id === selectedPostId);
    if (!post?.shiftType) return;

    const refDate = defaultDate ?? new Date();
    const baseDate = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());

    if (post.shiftType === "day") {
      const start = new Date(baseDate);
      start.setHours(6, 0, 0, 0);
      const end = new Date(baseDate);
      end.setHours(18, 0, 0, 0);
      setStartTime(formatForDatetimeLocal(start));
      setEndTime(formatForDatetimeLocal(end));
    } else if (post.shiftType === "night") {
      const start = new Date(baseDate);
      start.setHours(18, 0, 0, 0);
      const end = new Date(baseDate);
      end.setDate(end.getDate() + 1);
      end.setHours(6, 0, 0, 0);
      setStartTime(formatForDatetimeLocal(start));
      setEndTime(formatForDatetimeLocal(end));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
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
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to create shift");
      }
      setEmployeeId("");
      setPostId("");
      setStartTime("");
      setEndTime("");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create shift");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-5 bg-white dark:bg-neutral-900 rounded-sm border border-black dark:border-white">
      <h4 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-4">New Shift</h4>
      {error && (
        <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Employee</label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            required
            className="input-modern"
          >
            <option value="">Select employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.firstName} {e.lastName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Post</label>
          <select
            value={postId}
            onChange={(e) => handlePostChange(e.target.value)}
            required
            className="input-modern"
          >
            <option value="">Select post</option>
            {posts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.shiftType ? `(${SHIFT_LABELS[p.shiftType]})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Start time</label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
            className="input-modern"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">End time</label>
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            required
            className="input-modern"
          />
        </div>
      </div>
      <div className="mt-4">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Creating..." : "Create Shift"}
        </button>
      </div>
    </form>
  );
}

function EditShiftModal({
  shift,
  token,
  posts,
  employees,
  onClose,
  onSuccess,
}: {
  shift: Shift;
  token: string;
  posts: Post[];
  employees: Guard[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(shift.employee.id);
  const [postId, setPostId] = useState(shift.post.id);
  const [startTime, setStartTime] = useState(
    new Date(shift.startTime).toISOString().slice(0, 16)
  );
  const [endTime, setEndTime] = useState(
    new Date(shift.endTime).toISOString().slice(0, 16)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await authFetch(`/shifts/${shift.id}`, token, {
        method: "PUT",
        body: JSON.stringify({
          employeeId,
          postId,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to update shift");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update shift");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-neutral-900 rounded-sm shadow-2xl w-full max-w-md border border-black dark:border-white">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-4">Edit Shift</h3>
          {error && (
            <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Employee</label>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                required
                className="input-modern"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Post</label>
              <select
                value={postId}
                onChange={(e) => setPostId(e.target.value)}
                required
                className="input-modern"
              >
                {posts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.shiftType ? `(${SHIFT_LABELS[p.shiftType]})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Start time</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="input-modern"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">End time</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="input-modern"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 font-medium rounded-sm border border-black dark:border-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="flex-1 btn-primary">
                {submitting ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function DeleteShiftModal({
  shift,
  token,
  onClose,
  onSuccess,
}: {
  shift: Shift;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    setError("");
    setDeleting(true);
    try {
      const res = await authFetch(`/shifts/${shift.id}`, token, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to delete shift");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-neutral-900 rounded-sm shadow-2xl w-full max-w-md border border-black dark:border-white">
        <div className="p-6">
          <div className="w-12 h-12 rounded-sm bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Delete Shift</h3>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            Are you sure you want to delete the shift for{" "}
            <strong>
              {shift.employee.firstName} {shift.employee.lastName}
            </strong>{" "}
            at {shift.post.name}? This action cannot be undone.
          </p>
          {error && (
            <div className="mt-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm">
              {error}
            </div>
          )}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 font-medium rounded-sm border border-black dark:border-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 py-2.5 font-semibold rounded-sm bg-red-600 hover:bg-red-700 text-neutral-100 transition-colors disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
