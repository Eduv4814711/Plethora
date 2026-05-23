"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { format, addDays, startOfMonth, endOfMonth, isSameDay, parseISO, startOfDay } from "date-fns";

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
import { RosterPlanPreview, type RosterPlan } from "./RosterPlanPreview";
import { ShiftRosterSheet } from "./ShiftRosterSheet";
import { buildShiftSheetRows, type ShiftSheetRow } from "@/lib/shift-sheet-matrix";
import { DateInput } from "@/components/date-input";
import { generateGuardRosterPDF, generateShiftRosterSheetPDF } from "@/lib/roster-pdf";
import {
  meetsSiteDualShiftRosterRules,
  meetsSiteShiftGenderRule,
  siteHasRestrictiveShiftGenderRules,
} from "@/lib/site-shift-gender-rules";

const DASHBOARD_MAIN_ID = "dashboard-main";

async function parseApiJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    const hint =
      text.trimStart().startsWith("<") ? " (server returned HTML, not JSON)" : "";
    throw new Error(
      `Invalid response from server (${res.status})${hint}. Ensure the API is running and try again.`
    );
  }
}

function getRosteringModalContainer(): Element {
  return document.getElementById(DASHBOARD_MAIN_ID) ?? document.body;
}

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
  post: { id: string; name: string; shiftType: string | null; site: { id: string; name: string } };
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  status?: string;
  employeeType?: string;
  gender?: string | null;
  phone?: string | null;
}

interface Post {
  id: string;
  name: string;
  shiftType?: string | null;
}

interface SiteAssignedGuard {
  id: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    status: string;
    phone: string | null;
    gender?: string | null;
    employeeType?: string;
  };
}

interface Site {
  id: string;
  name: string;
  posts: Post[];
  assignedGuards?: SiteAssignedGuard[];
  rosterSiteRules?: string | null;
  rosterSheetNotes?: string | null;
  rosterDayShiftGender?: string | null;
  rosterNightShiftGender?: string | null;
  rosterDayShiftGuardsRequired?: number;
  rosterNightShiftGuardsRequired?: number;
}

const statusColors: Record<string, string> = {
  created: "border-2 border-neutral-200 bg-wireframe-accent text-black",
  assigned: "border-2 border-neutral-200 bg-neutral-100 text-black",
  active: "border-2 border-neutral-200 bg-white text-black",
  completed: "border-2 border-neutral-200 bg-neutral-100 text-black",
  verified: "border-2 border-neutral-200 bg-white text-black",
};

export default function RosteringPage() {
  const { token, user } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedDayForShift, setSelectedDayForShift] = useState<Date | null>(null);
  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const thisMonthEnd = endOfMonth(now);
  const [periodStart, setPeriodStart] = useState(() => format(thisMonthStart, "yyyy-MM-dd"));
  const [periodEnd, setPeriodEnd] = useState(() => format(thisMonthEnd, "yyyy-MM-dd"));
  const [showPeriodModal, setShowPeriodModal] = useState(false);
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
  const [guardSearch, setGuardSearch] = useState("");
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [shiftContextMenu, setShiftContextMenu] = useState<{
    shift: Shift;
    x: number;
    y: number;
  } | null>(null);

  const isDualPattern = pattern === "3_on_3_off" || pattern === "custom_builder";
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [deletingShiftId, setDeletingShiftId] = useState<string | null>(null);
  const [showResetMenu, setShowResetMenu] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showPdfMenu, setShowPdfMenu] = useState(false);
  const [showPdfPeriodModal, setShowPdfPeriodModal] = useState(false);
  const [pdfAction, setPdfAction] = useState<"preview" | "download">("preview");
  const [pdfEmployeeId, setPdfEmployeeId] = useState<string | undefined>(undefined);
  const [pdfPeriodStart, setPdfPeriodStart] = useState("");
  const [pdfPeriodEnd, setPdfPeriodEnd] = useState("");
  const [pdfPeriodError, setPdfPeriodError] = useState<string | null>(null);
  const [rosterView, setRosterView] = useState<"calendar" | "sheet">("calendar");
  const [rosterPlan, setRosterPlan] = useState<RosterPlan | null>(null);
  const [showRosterPlanModal, setShowRosterPlanModal] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [applyingPlan, setApplyingPlan] = useState(false);
  const [rosterPlanApplyError, setRosterPlanApplyError] = useState<string | null>(null);
  const [staggerGuards, setStaggerGuards] = useState(true);

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
    if (!confirm(`Reset all rostered shifts for ${name} in this period only?`)) return;
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
      const res = await authFetch("/shifts/reset", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
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
    if (!confirm("Reset the entire roster for this period only? This will remove all created/assigned shifts in the visible period.")) return;
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
      const res = await authFetch("/shifts/reset", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
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

  const openPdfPeriodModal = (action: "preview" | "download", employeeId?: string) => {
    setPdfAction(action);
    setPdfEmployeeId(employeeId);
    setPdfPeriodStart(periodStart);
    setPdfPeriodEnd(periodEnd);
    setPdfPeriodError(null);
    setShowPdfMenu(false);
    setShowPdfPeriodModal(true);
  };

  const handlePdfConfirm = async () => {
    if (!token || !pdfPeriodStart || !pdfPeriodEnd) return;
    setPdfPeriodError(null);
    const start = startOfDay(parseISO(pdfPeriodStart));
    const end = new Date(parseISO(pdfPeriodEnd));
    end.setHours(23, 59, 59, 999);
    if (end < start) return;
    const startDate = start.toISOString();
    const endDate = end.toISOString();

    if (!pdfEmployeeId && !selectedSiteId) {
      setPdfPeriodError("Select a site in Step 1 to export the shift sheet PDF.");
      return;
    }

    let periodShifts: Shift[];
    let pdfEmployees: Employee[] = employees;

    if (pdfEmployeeId) {
      const shiftsRes = await authFetch(`/shifts?startDate=${startDate}&endDate=${endDate}&limit=5000`, token);
      const shiftsData = await shiftsRes.json();
      periodShifts = shiftsData.data || [];
    } else {
      const [shiftsRes, empRes] = await Promise.all([
        authFetch(`/shifts?startDate=${startDate}&endDate=${endDate}&limit=5000`, token),
        authFetch("/employees?limit=100", token),
      ]);
      const shiftsData = await shiftsRes.json();
      periodShifts = shiftsData.data || [];
      if (empRes.ok) {
        const empData = await empRes.json();
        pdfEmployees = empData.data || [];
      }
    }

    const pdfCalendarDays: Date[] = [];
    let d = new Date(start);
    while (d <= end) {
      pdfCalendarDays.push(new Date(d));
      d = addDays(d, 1);
    }
    const periodLabel =
      pdfCalendarDays.length > 0
        ? format(pdfCalendarDays[0], "d MMM") + " – " + format(pdfCalendarDays[pdfCalendarDays.length - 1], "d MMM yyyy")
        : pdfPeriodStart;
    const generatedBy = user?.name ?? undefined;

    const siteName = selectedSiteId ? sites.find((s) => s.id === selectedSiteId)?.name ?? "Site" : "";

    const siteForPdf = sites.find((s) => s.id === selectedSiteId);

    const makeFullRosterBlob = () => {
      const rows = buildShiftSheetRows({
        shifts: periodShifts,
        calendarDays: pdfCalendarDays,
        siteId: selectedSiteId,
        employees: pdfEmployees,
      });
      return generateShiftRosterSheetPDF({
        siteName,
        periodLabel,
        days: pdfCalendarDays,
        rows,
        generatedBy,
        rosterSiteRules: siteForPdf?.rosterSiteRules,
        rosterSheetNotes: siteForPdf?.rosterSheetNotes,
        rosterDayShiftGender: siteForPdf?.rosterDayShiftGender,
        rosterNightShiftGender: siteForPdf?.rosterNightShiftGender,
        rosterDayShiftGuardsRequired: siteForPdf?.rosterDayShiftGuardsRequired,
        rosterNightShiftGuardsRequired: siteForPdf?.rosterNightShiftGuardsRequired,
      });
    };

    if (pdfAction === "preview") {
      const blob = pdfEmployeeId
        ? generateGuardRosterPDF(
            periodShifts.filter((s) => s.employee.id === pdfEmployeeId),
            getGuardName(pdfEmployeeId),
            periodLabel,
            generatedBy
          )
        : makeFullRosterBlob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (!win) {
        const a = document.createElement("a");
        a.href = url;
        a.download = pdfEmployeeId
          ? `roster-${safeFilename(getGuardName(pdfEmployeeId))}-${safeFilename(periodLabel)}.pdf`
          : `shift-roster-${safeFilename(siteName)}-${safeFilename(periodLabel)}.pdf`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      const filename = pdfEmployeeId
        ? `roster-${safeFilename(getGuardName(pdfEmployeeId))}-${safeFilename(periodLabel)}.pdf`
        : `shift-roster-${safeFilename(siteName)}-${safeFilename(periodLabel)}.pdf`;
      const blob = pdfEmployeeId
        ? generateGuardRosterPDF(
            periodShifts.filter((s) => s.employee.id === pdfEmployeeId),
            getGuardName(pdfEmployeeId),
            periodLabel,
            generatedBy
          )
        : makeFullRosterBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
    setShowPdfPeriodModal(false);
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
    const start = startOfDay(parseISO(periodStart));
    const end = new Date(parseISO(periodEnd));
    end.setHours(23, 59, 59, 999);
    return { startDate: format(start, "yyyy-MM-dd"), endDate: format(end, "yyyy-MM-dd") };
  };

  const setPeriodToMonth = (date: Date) => {
    const start = startOfMonth(date);
    const end = endOfMonth(date);
    setPeriodStart(format(start, "yyyy-MM-dd"));
    setPeriodEnd(format(end, "yyyy-MM-dd"));
  };

  const getMonthRangeForReset = () => getDateRangeParams();

  const { calendarDays, displayCells } = useMemo(() => {
    const start = startOfDay(parseISO(periodStart));
    const end = new Date(parseISO(periodEnd));
    end.setHours(23, 59, 59, 999);
    const days: Date[] = [];
    let d = new Date(start);
    while (d <= end) {
      days.push(new Date(d));
      d = addDays(d, 1);
    }
    const firstDay = days[0]?.getDay() ?? 1;
    const startPad = (firstDay - 1 + 7) % 7;
    const endPad = (7 - ((startPad + days.length) % 7)) % 7;
    const cells: (Date | null)[] = [
      ...Array(startPad).fill(null),
      ...days,
      ...Array(endPad).fill(null),
    ];
    return { calendarDays: days, displayCells: cells };
  }, [periodStart, periodEnd]);

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

  const sheetRows = useMemo((): ShiftSheetRow[] => {
    if (!selectedSiteId) return [];
    return buildShiftSheetRows({
      shifts,
      calendarDays,
      siteId: selectedSiteId,
      employees,
    });
  }, [selectedSiteId, shifts, calendarDays, employees]);

  const siteAssignedGuards = useMemo((): Employee[] => {
    if (!selectedSiteId) return [];
    const site = sites.find((s) => s.id === selectedSiteId);
    if (!site?.assignedGuards?.length) return [];
    return site.assignedGuards
      .map((a) => {
        const fromList = employees.find((e) => e.id === a.employee.id);
        return {
          id: a.employee.id,
          firstName: a.employee.firstName,
          lastName: a.employee.lastName,
          status: a.employee.status,
          gender: a.employee.gender ?? fromList?.gender,
          employeeType: a.employee.employeeType ?? fromList?.employeeType,
          phone: a.employee.phone ?? fromList?.phone,
        };
      })
      .filter(
        (e) =>
          (e.employeeType ?? "security") === "security" &&
          ["active", "training", "hired", "reliever"].includes(e.status ?? "")
      );
  }, [selectedSiteId, sites, employees]);

  const rosteredOnSiteCount = useMemo(() => {
    if (!selectedSiteId) return rosteredEmployees.length;
    const ids = new Set(
      shifts.filter((s) => s.post.site.id === selectedSiteId).map((s) => s.employee.id)
    );
    return ids.size;
  }, [selectedSiteId, shifts, rosteredEmployees.length]);

  const filteredAvailableGuards = useMemo(() => {
    const term = guardSearch.trim().toLowerCase();
    if (!term) return siteAssignedGuards;
    return siteAssignedGuards.filter((g) => {
      const fullName = `${g.firstName} ${g.lastName}`.toLowerCase();
      return (
        fullName.includes(term) ||
        g.firstName.toLowerCase().includes(term) ||
        g.lastName.toLowerCase().includes(term)
      );
    });
  }, [siteAssignedGuards, guardSearch]);

  const postsForSelectedSite = useMemo(() => {
    if (!selectedSiteId) return [];
    const site = sites.find((s) => s.id === selectedSiteId);
    return site?.posts ?? [];
  }, [sites, selectedSiteId]);

  const selectedSite = useMemo(
    () => (selectedSiteId ? sites.find((s) => s.id === selectedSiteId) : undefined),
    [sites, selectedSiteId]
  );

  /** Shift kinds actually used by the dual-pattern bulk flow (site drop). */
  const siteDualPatternShiftKinds = useMemo((): ("day" | "night")[] | null => {
    if (!isDualPattern) return null;
    if (pattern === "3_on_3_off") return ["day", "night"];
    if (pattern === "custom_builder") {
      const kinds = new Set<"day" | "night">();
      for (const b of customBlocks) {
        if (b.type === "day") kinds.add("day");
        if (b.type === "night") kinds.add("night");
      }
      return [...kinds];
    }
    return null;
  }, [isDualPattern, pattern, customBlocks]);

  useEffect(() => {
    if (calendarDays.length === 0) {
      setSelectedDayKey(null);
      return;
    }
    const dayKeys = new Set(calendarDays.map((d) => format(d, "yyyy-MM-dd")));
    if (selectedDayKey && dayKeys.has(selectedDayKey)) return;
    const todayKey = format(new Date(), "yyyy-MM-dd");
    setSelectedDayKey(dayKeys.has(todayKey) ? todayKey : format(calendarDays[0], "yyyy-MM-dd"));
  }, [calendarDays, selectedDayKey]);

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

  const canGenerateRosterPlan =
    !!selectedSiteId &&
    isDualPattern &&
    siteAssignedGuards.length > 0 &&
    !!periodStart &&
    !!periodEnd &&
    parseISO(periodEnd) >= parseISO(periodStart);

  const handleGenerateRosterPlan = async () => {
    if (!token || !selectedSiteId || !isDualPattern) return;
    setGeneratingPlan(true);
    setBulkError(null);
    setRosterPlanApplyError(null);
    const { startDate, endDate } = getDateRangeParams();
    const body: Record<string, unknown> = {
      siteId: selectedSiteId,
      startDate: startDate.slice(0, 10),
      endDate: endDate.slice(0, 10),
      pattern,
    };
    if (pattern === "custom_builder") body.customBlocks = customBlocks;
    body.options = { staggerGuards };
    try {
      const res = await authFetch("/shifts/roster/preview", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await parseApiJsonResponse(res);
      if (!res.ok) {
        throw new Error(
          String(data.message || data.error || "Failed to generate roster plan")
        );
      }
      setRosterPlan(data as RosterPlan);
      setShowRosterPlanModal(true);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed to generate roster plan");
    } finally {
      setGeneratingPlan(false);
    }
  };

  const handleApplyRosterPlan = async () => {
    if (!token || !rosterPlan) return;
    setApplyingPlan(true);
    setRosterPlanApplyError(null);
    try {
      const res = await authFetch("/shifts/roster/apply", token, {
        method: "POST",
        body: JSON.stringify({
          plan: rosterPlan,
          options: { replaceExisting: true },
        }),
      });
      const data = await parseApiJsonResponse(res);
      if (!res.ok) {
        throw new Error(String(data.message || data.error || "Failed to apply roster plan"));
      }
      setShowRosterPlanModal(false);
      setRosterPlan(null);
      await refresh();
      const deleted = Number(data.deleted ?? 0);
      const created = Number(data.created ?? 0);
      const skipped = Number(data.skipped ?? 0);
      const applyErrors = Array.isArray(data.errors) ? (data.errors as string[]) : [];
      const msg =
        deleted > 0
          ? `Replaced ${deleted} shift(s) and created ${created}.`
          : `Created ${created} shift(s).`;
      setBulkError(msg);
      setTimeout(() => setBulkError(null), 5000);
      if (applyErrors.length) {
        setBulkError(`${msg} ${skipped} skipped: ${applyErrors.slice(0, 2).join("; ")}`);
      }
    } catch (err) {
      setRosterPlanApplyError(err instanceof Error ? err.message : "Failed to apply roster plan");
    } finally {
      setApplyingPlan(false);
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
      authFetch(`/shifts?startDate=${startDate}&endDate=${endDate}&limit=5000`, token).then((r) => r.json()),
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
  }, [token, periodStart, periodEnd]);

  useEffect(() => {
    if (!shiftContextMenu) return;
    const close = () => setShiftContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [shiftContextMenu]);

  if (loading) {
    return (
      <div className="animate-pulse mx-auto w-full max-w-[1760px] h-[calc(100dvh-7.5rem)] rounded-[28px] bg-gradient-to-b from-neutral-50 via-white to-orange-50/30 dark:from-neutral-900 dark:via-neutral-950 dark:to-neutral-900 p-3">
        <div className="h-full grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-4">
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/70 p-4 space-y-3">
            <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-32" />
            <div className="h-10 bg-neutral-200 dark:bg-neutral-700 rounded-lg" />
            <div className="h-10 bg-neutral-200 dark:bg-neutral-700 rounded-lg" />
            <div className="h-32 bg-neutral-200 dark:bg-neutral-700 rounded-xl" />
          </div>
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/70 p-4 space-y-4">
            <div className="h-12 bg-neutral-200 dark:bg-neutral-700 rounded-xl" />
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-20 bg-neutral-200 dark:bg-neutral-700 rounded-xl" />
              ))}
            </div>
            <div className="flex-1 min-h-[400px] bg-neutral-200 dark:bg-neutral-700 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  const periodLabel =
    calendarDays.length > 0
      ? calendarDays.length === 1
        ? format(calendarDays[0], "d MMM yyyy")
        : format(calendarDays[0], "d MMM") + " – " + format(calendarDays[calendarDays.length - 1], "d MMM yyyy")
      : "";
  const calendarWeeks = Array.from(
    { length: Math.max(1, Math.ceil(displayCells.length / 7)) },
    (_, index) => displayCells.slice(index * 7, index * 7 + 7)
  );
  const selectedSiteName = selectedSiteId
    ? sites.find((s) => s.id === selectedSiteId)?.name ?? "Unknown site"
    : "All sites";
  const totalPostsForSummary = selectedSiteId
    ? postsForSelectedSite.length
    : sites.reduce((sum, site) => sum + site.posts.length, 0);
  const totalShiftsForSummary = shifts.length;
  const dayShiftCount = shifts.filter((s) => (s.post.shiftType ?? "day") === "day").length;
  const nightShiftCount = shifts.filter((s) => s.post.shiftType === "night").length;
  const expectedShiftSlots = totalPostsForSummary * calendarDays.length;
  const openShiftCount = Math.max(expectedShiftSlots - totalShiftsForSummary, 0);
  const coveragePercent =
    expectedShiftSlots > 0
      ? Math.min(100, Math.round((totalShiftsForSummary / expectedShiftSlots) * 100))
      : 0;

  return (
    <div className="mx-auto flex h-[calc(100dvh-7.5rem)] min-h-[620px] w-full max-w-[1760px] flex-col xl:flex-row gap-5 rounded-[28px] bg-gradient-to-b from-neutral-50/85 via-white to-orange-50/35 dark:from-neutral-900 dark:via-neutral-950 dark:to-neutral-900 p-2 xl:p-3 print:min-h-0 print:h-auto print:max-w-none print:rounded-none print:bg-white print:p-4 print:gap-0">
      <aside className="print:hidden xl:w-[18.75rem] w-full xl:h-full min-h-0 max-h-[48vh] xl:max-h-none shrink-0 flex flex-col overflow-hidden rounded-2xl border border-neutral-200/90 dark:border-neutral-700 bg-white/95 dark:bg-neutral-900/80 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.35)]">
        <div
          className="flex-1 min-h-0 overflow-y-scroll overflow-x-hidden overscroll-y-contain touch-pan-y [scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:theme(colors.neutral.400)_transparent] dark:[scrollbar-color:theme(colors.neutral.600)_transparent]"
          role="region"
          aria-label="Roster controls and guard list"
        >
          <div className="p-4 space-y-3 border-b border-neutral-200/80 dark:border-neutral-700 bg-gradient-to-b from-white to-neutral-50/70 dark:from-neutral-900 dark:to-neutral-900/80">
          <div className="rounded-xl border border-neutral-200/90 dark:border-neutral-700 bg-white dark:bg-neutral-900/70 p-3.5 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400 mb-1">
              Roster Period
            </p>
            <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{periodLabel || "—"}</p>
            <button
              type="button"
              onClick={() => setShowPeriodModal(true)}
              className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 underline"
            >
              Change period
            </button>
          </div>

          <div className="rounded-xl border border-neutral-200/90 dark:border-neutral-700 bg-white dark:bg-neutral-900/70 p-3.5 space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-600 dark:text-neutral-300">
              Step 1: Select Site
            </h3>
            <select
              value={selectedSiteId}
              onChange={(e) => setSelectedSiteId(e.target.value)}
              className="input-modern py-2.5 text-sm w-full"
            >
              <option value="">Select site</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-neutral-200/90 dark:border-neutral-700 bg-white dark:bg-neutral-900/70 p-3.5 space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-600 dark:text-neutral-300">
              Step 2: Choose Pattern
            </h3>
            <select
              value={pattern}
              onChange={(e) => setPattern(e.target.value as BulkPattern)}
              className="input-modern py-2.5 text-sm w-full"
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
              <CustomPatternBuilder
                blocks={customBlocks}
                onChange={setCustomBlocks}
                periodStart={periodStart}
                periodEnd={periodEnd}
              />
            )}
          </div>

          {isDualPattern && selectedSiteId && (
            <div className="rounded-xl border border-orange-200/90 dark:border-orange-800/50 bg-orange-50/50 dark:bg-orange-950/20 p-3.5 space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-700 dark:text-neutral-200">
                Step 4: Generate Roster
              </h3>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-snug">
                Generate a coverage-first roster plan for all guards on this site, preview diagnostics, then apply in one step.
              </p>
              <label className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={staggerGuards}
                  onChange={(e) => setStaggerGuards(e.target.checked)}
                  className="rounded border-neutral-300 dark:border-neutral-600"
                />
                Stagger guard cycles (spread phases across the full pattern, e.g. 0 / 3 / 6 days for 3D3N3O)
              </label>
              <button
                type="button"
                onClick={handleGenerateRosterPlan}
                disabled={!canGenerateRosterPlan || generatingPlan}
                className="w-full btn-primary py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generatingPlan ? "Generating…" : "Generate coverage-first roster plan"}
              </button>
              {!canGenerateRosterPlan && siteAssignedGuards.length === 0 && (
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
                  Assign guards to this site in{" "}
                  <Link href="/sites" className="text-orange-700 dark:text-orange-300 underline">
                    Sites
                  </Link>{" "}
                  first.
                </p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-neutral-200/90 dark:border-neutral-700 bg-neutral-50/90 dark:bg-neutral-800/70 p-3.5 space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-600 dark:text-neutral-300">
              Quick Summary
            </h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">Selected site</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-100 text-right">{selectedSiteName}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">Pattern</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-100">{PATTERN_LABELS[pattern]}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">Guards on site</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-100">
                  {selectedSiteId ? siteAssignedGuards.length : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">Rostered this period</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-100">
                  {selectedSiteId ? rosteredOnSiteCount : rosteredEmployees.length}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">Total shifts</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-100">{totalShiftsForSummary}</span>
              </div>
            </div>
          </div>
          </div>
          <div className="p-4 space-y-4 bg-neutral-50/40 dark:bg-neutral-900/30">
          {selectedSiteId ? (
            <>
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-600 dark:text-neutral-300 mb-2">
                  Step 3: Assign Guard
                </h3>
                {isDualPattern && (
                  <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mb-2 leading-snug">
                    Or use Step 4 to roster all site guards at once. Drag-and-drop below still works for one guard.
                  </p>
                )}
              </div>
              {isDualPattern ? (
                <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900/50 p-3">
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
                    Drag a guard onto this site to auto-fill the selected period for that guard only.
                  </p>
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
                    className={`min-h-[56px] rounded-lg border-2 border-dashed flex items-center justify-center text-sm font-medium transition-colors ${
                      dragOverSiteId === selectedSiteId
                        ? "border-orange-400 dark:border-orange-300 bg-orange-50/70 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300"
                        : "border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400 bg-neutral-50/70 dark:bg-neutral-800/40"
                    }`}
                  >
                    {sites.find((s) => s.id === selectedSiteId)?.name ?? "Site"}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900/50 p-3">
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
                    Drag a guard onto a post to auto-fill the selected period.
                  </p>
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
                        className={`min-h-[46px] px-3 py-2 rounded-lg border-2 border-dashed flex items-center justify-center text-sm font-medium transition-colors ${
                          dragOverPostId === post.id
                            ? "border-orange-400 dark:border-orange-300 bg-orange-50/70 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300"
                            : "border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400 bg-neutral-50/70 dark:bg-neutral-800/40"
                        }`}
                      >
                        {post.name} {post.shiftType ? `(${post.shiftType})` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-neutral-200/90 dark:border-neutral-700 bg-white dark:bg-neutral-900/60 p-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-600 dark:text-neutral-300 mb-2">
                  Site Guards
                </h4>
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mb-2 leading-snug">
                  Only guards assigned to this site in Sites appear here.
                </p>
                {isDualPattern && selectedSite && siteHasRestrictiveShiftGenderRules(selectedSite) && (
                  <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mb-2 leading-snug">
                    {pattern === "custom_builder" ? (
                      <>
                        Custom patterns only roster the shift types in your blocks (e.g. day only). Guards must match
                        this site&apos;s staffing rules for those types only; set M/F on the employee profile where a
                        rule applies.
                      </>
                    ) : (
                      <>
                        This pattern uses day and night posts. Guards must fit this site&apos;s day and night staffing
                        rules; set M/F on the employee profile where rules apply.
                      </>
                    )}
                  </p>
                )}
                <input
                  type="text"
                  value={guardSearch}
                  onChange={(e) => setGuardSearch(e.target.value)}
                  placeholder="Search guards..."
                  className="input-modern py-2 text-sm w-full mb-2"
                  aria-label="Search available guards"
                />
                <div className="space-y-1.5 overflow-y-auto pr-1 max-h-[min(280px,40vh)] sm:max-h-[min(320px,35vh)] [scrollbar-width:thin] [scrollbar-color:theme(colors.neutral.400)_transparent] dark:[scrollbar-color:theme(colors.neutral.600)_transparent]">
                  {filteredAvailableGuards.map((g) => {
                    const dualDragOk =
                      !isDualPattern ||
                      !selectedSite ||
                      (pattern === "custom_builder"
                        ? (siteDualPatternShiftKinds ?? []).every((kind) =>
                            meetsSiteShiftGenderRule(g.gender, selectedSite, kind)
                          )
                        : meetsSiteDualShiftRosterRules(g.gender, selectedSite));
                    return (
                    <div
                      key={g.id}
                      draggable={dualDragOk}
                      onDragStart={(e) => {
                        if (!dualDragOk) {
                          e.preventDefault();
                          return;
                        }
                        setDraggedGuard(g);
                        e.dataTransfer.setData("guardId", g.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDraggedGuard(null)}
                      title={
                        dualDragOk
                          ? undefined
                          : pattern === "custom_builder"
                            ? "Does not match this site's staffing rules for the shift types in your custom pattern. Update the guard's gender (M/F) or the site's shift staffing settings."
                            : "Does not match this site's day and night staffing rules. Update the guard's gender (M/F) or the site's shift staffing settings."
                      }
                      className={`px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-sm transition-colors ${
                        dualDragOk
                          ? `cursor-grab active:cursor-grabbing ${
                              draggedGuard?.id === g.id
                                ? "opacity-50"
                                : "bg-neutral-50 dark:bg-neutral-800/50 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            }`
                          : "opacity-55 cursor-not-allowed bg-neutral-100/80 dark:bg-neutral-800/30"
                      }`}
                    >
                      {g.firstName} {g.lastName}
                    </div>
                    );
                  })}
                  {filteredAvailableGuards.length === 0 && (
                    <p className="text-xs text-neutral-500 py-2">
                      {guardSearch.trim() ? (
                        "No guards match your search"
                      ) : siteAssignedGuards.length === 0 ? (
                        <>
                          No guards assigned to this site.{" "}
                          <Link
                            href="/sites"
                            className="text-orange-700 dark:text-orange-300 underline hover:no-underline"
                          >
                            Assign guards in Sites
                          </Link>
                        </>
                      ) : (
                        "No guards available"
                      )}
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="py-10 text-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 bg-white/70 dark:bg-neutral-900/40">
              <p className="text-sm text-neutral-600 dark:text-neutral-400 font-medium">
                Select a site in Step 1 to assign guards.
              </p>
            </div>
          )}
          </div>
          {bulkError && (
            <div className="mx-4 mb-4 rounded-lg border border-red-200 dark:border-red-800/60 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-xs">
              {bulkError}
            </div>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 rounded-3xl border border-neutral-200/90 dark:border-neutral-700 bg-white/85 dark:bg-neutral-900/75 shadow-[0_12px_34px_-20px_rgba(15,23,42,0.38)] overflow-hidden print:rounded-none print:border-0 print:shadow-none print:bg-white">
      <div className="print:hidden sticky top-0 z-30 shrink-0 px-6 py-4 border-b border-neutral-200/80 dark:border-neutral-700 bg-gradient-to-b from-white/95 to-neutral-50/85 dark:from-neutral-900/95 dark:to-neutral-900/85 backdrop-blur">
        <div className="grid gap-4 xl:grid-cols-[minmax(220px,1fr)_auto_minmax(420px,1fr)] xl:items-center">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-[1.75rem] leading-none font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">
                {rosterView === "sheet" ? "Shift sheet" : "Roster Calendar"}
              </h1>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                {rosterView === "sheet" ? "Staff × day matrix for the selected site" : "Security workforce scheduling view"}
              </p>
            </div>
            <div
              className="flex h-11 shrink-0 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden bg-white dark:bg-neutral-900"
              role="group"
              aria-label="Roster view"
            >
              <button
                type="button"
                onClick={() => setRosterView("calendar")}
                className={`px-3.5 text-sm font-semibold transition-colors ${
                  rosterView === "calendar"
                    ? "bg-orange-500 text-black"
                    : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                Calendar
              </button>
              <button
                type="button"
                onClick={() => setRosterView("sheet")}
                className={`px-3.5 text-sm font-semibold border-l border-neutral-200 dark:border-neutral-700 transition-colors ${
                  rosterView === "sheet"
                    ? "bg-orange-500 text-black"
                    : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                Shift sheet
              </button>
            </div>
          </div>
          <div className="hidden xl:flex justify-center" />
          <div className="flex w-full flex-col gap-2.5 xl:items-end">
            <div className="flex flex-wrap items-center gap-2.5 xl:flex-nowrap xl:justify-end">
              <button
                type="button"
                onClick={() => setShowPeriodModal(true)}
                className="h-11 px-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm font-semibold text-neutral-800 dark:text-neutral-200 hover:border-neutral-300 dark:hover:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2 xl:hidden"
                title="Choose time period to roster"
              >
                <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Period</span>
                <span>{periodLabel || "Select period"}</span>
              </button>
              <div className="flex items-center h-11 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    const start = parseISO(periodStart);
                    const end = parseISO(periodEnd);
                    const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
                    const newStart = addDays(start, -days);
                    const newEnd = addDays(end, -days);
                    setPeriodStart(format(newStart, "yyyy-MM-dd"));
                    setPeriodEnd(format(newEnd, "yyyy-MM-dd"));
                  }}
                  className="h-full px-3 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-neutral-600 dark:text-neutral-400"
                  aria-label="Previous period"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodToMonth(new Date())}
                  className="h-full px-4 text-sm font-medium border-x border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-neutral-700 dark:text-neutral-300"
                >
                  This month
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodToMonth(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1))}
                  className="h-full px-3 text-sm font-medium border-r border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-neutral-700 dark:text-neutral-300"
                >
                  Next month
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const start = parseISO(periodStart);
                    const end = parseISO(periodEnd);
                    const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
                    const newStart = addDays(start, days);
                    const newEnd = addDays(end, days);
                    setPeriodStart(format(newStart, "yyyy-MM-dd"));
                    setPeriodEnd(format(newEnd, "yyyy-MM-dd"));
                  }}
                  className="h-full px-3 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-neutral-600 dark:text-neutral-400"
                  aria-label="Next period"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              <button
                onClick={() => { setSelectedDayForShift(null); setShowForm(!showForm); }}
                className="h-11 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors flex items-center gap-2 shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {showForm ? "Cancel" : "Add Shift"}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 xl:flex-nowrap xl:justify-end">
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => { setShowResetMenu(false); setShowPdfMenu((v) => !v); }}
                  className="h-11 px-3 text-sm font-semibold rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 dark:focus:ring-offset-neutral-900 flex flex-wrap items-center gap-2"
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
                      <p className="px-3 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
                        Shift sheet PDF for the site selected in Step 1 (required).
                      </p>
                      <button
                        type="button"
                        onClick={() => openPdfPeriodModal("preview")}
                        className="w-full px-4 py-2 text-left text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => openPdfPeriodModal("download")}
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
                                onClick={() => openPdfPeriodModal("preview", e.id)}
                                className="flex-1 px-4 py-2 text-left text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                              >
                                Preview
                              </button>
                              <button
                                type="button"
                                onClick={() => openPdfPeriodModal("download", e.id)}
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
                  className="h-11 px-4 text-sm font-semibold rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
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
              <button
                type="button"
                onClick={() => setShowPeriodModal(true)}
                className="hidden h-11 w-[230px] px-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm font-semibold text-neutral-800 dark:text-neutral-200 hover:border-neutral-300 dark:hover:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors xl:flex items-center gap-2"
                title="Choose time period to roster"
              >
                <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Period</span>
                <span>{periodLabel || "Select period"}</span>
              </button>
            </div>
          </div>
        </div>

        {showPeriodModal &&
          createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="card-wireframe w-full max-w-sm shadow-xl">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
                  Choose roster period
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
                  Select the start and end dates for the period you want to roster. All rostering happens within this period.
                </p>
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                      Start date
                    </label>
                    <DateInput
                      value={periodStart}
                      onChange={setPeriodStart}
                      className="input-modern w-full"
                      showToday
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                      End date
                    </label>
                    <DateInput
                      value={periodEnd}
                      onChange={setPeriodEnd}
                      className="input-modern w-full"
                      showToday
                    />
                  </div>
                </div>
                <div className="flex gap-2 mb-4">
                  <button
                    type="button"
                    onClick={() => setPeriodToMonth(new Date())}
                    className="flex-1 py-2 text-sm font-medium rounded-md border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    This month
                  </button>
                  <button
                    type="button"
                    onClick={() => setPeriodToMonth(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1))}
                    className="flex-1 py-2 text-sm font-medium rounded-md border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    Next month
                  </button>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowPeriodModal(false)}
                    className="flex-1 btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (parseISO(periodEnd) >= parseISO(periodStart)) setShowPeriodModal(false);
                    }}
                    disabled={!periodStart || !periodEnd || parseISO(periodEnd) < parseISO(periodStart)}
                    className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>,
          getRosteringModalContainer()
        )}

        {showPdfPeriodModal &&
          createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="card-wireframe w-full max-w-sm shadow-xl">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
                  Choose time period for PDF
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
                  Select the start and end dates for the roster schedule. Periods can span across months.
                </p>
                {!pdfEmployeeId && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4 -mt-2">
                    Full roster exports the <span className="font-semibold text-neutral-600 dark:text-neutral-300">shift sheet</span> (staff × days) for the{" "}
                    <span className="font-semibold text-neutral-600 dark:text-neutral-300">currently selected site</span> in Step 1.
                  </p>
                )}
                {pdfPeriodError && (
                  <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                    {pdfPeriodError}
                  </div>
                )}
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                      Start date
                    </label>
                    <DateInput
                      value={pdfPeriodStart}
                      onChange={(v) => {
                        setPdfPeriodError(null);
                        setPdfPeriodStart(v);
                      }}
                      className="input-modern w-full"
                      showToday
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">
                      End date
                    </label>
                    <DateInput
                      value={pdfPeriodEnd}
                      onChange={(v) => {
                        setPdfPeriodError(null);
                        setPdfPeriodEnd(v);
                      }}
                      className="input-modern w-full"
                      showToday
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPdfPeriodError(null);
                      setShowPdfPeriodModal(false);
                    }}
                    className="flex-1 btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handlePdfConfirm}
                    disabled={!pdfPeriodStart || !pdfPeriodEnd || parseISO(pdfPeriodEnd) < parseISO(pdfPeriodStart)}
                    className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {pdfAction === "preview" ? "Preview" : "Download"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          getRosteringModalContainer()
        )}

        {showRosterPlanModal &&
          rosterPlan &&
          createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <div className="card-wireframe w-full max-w-2xl shadow-xl overflow-hidden">
                <RosterPlanPreview
                  plan={rosterPlan}
                  siteName={selectedSite?.name ?? "Site"}
                  periodLabel={periodLabel}
                  guards={siteAssignedGuards}
                  posts={postsForSelectedSite}
                  onCancel={() => {
                    if (!applyingPlan) {
                      setShowRosterPlanModal(false);
                      setRosterPlan(null);
                      setRosterPlanApplyError(null);
                    }
                  }}
                  onApply={handleApplyRosterPlan}
                  applying={applyingPlan}
                  applyError={rosterPlanApplyError}
                />
              </div>
            </div>,
            getRosteringModalContainer()
          )}

        {showForm && (
          <div className="mt-4">
            <ShiftForm
              token={token!}
              employees={employees}
              sites={sites}
              defaultDate={selectedDayForShift ?? parseISO(periodStart)}
              onSuccess={() => {
                setShowForm(false);
                setSelectedDayForShift(null);
                refresh();
              }}
            />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 px-6 pb-6 flex flex-col overflow-hidden print:px-4 print:pb-4">
        <div className="print:hidden grid grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
          <RosterKpiCard
            label="Guards Scheduled"
            value={rosteredEmployees.length}
            tone="neutral"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21a8 8 0 0116 0" />
              </svg>
            }
          />
          <RosterKpiCard
            label="Day Shifts"
            value={dayShiftCount}
            tone="day"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2v2m0 16v2m8-10h2M2 12h2m12.95 6.95l1.414 1.414M4.636 4.636L6.05 6.05m0 11.9l-1.414 1.414m12.728-12.728l1.414-1.414M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            }
          />
          <RosterKpiCard
            label="Night Shifts"
            value={nightShiftCount}
            tone="night"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            }
          />
          <RosterKpiCard
            label="Open Shifts"
            value={openShiftCount}
            tone="neutral"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            }
          />
          <RosterKpiCard
            label="Coverage"
            value={expectedShiftSlots > 0 ? `${coveragePercent}%` : "—"}
            tone="coverage"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-5m3 5V7m3 10v-3m3 7H6a2 2 0 01-2-2V5a2 2 0 012-2h8.586a1 1 0 01.707.293l4.414 4.414A1 1 0 0120 8.414V19a2 2 0 01-2 2z" />
              </svg>
            }
            emphasize
          />
        </div>
        {rosterView === "calendar" ? (
        <div className="flex-1 min-h-0 rounded-2xl border border-neutral-200/90 dark:border-neutral-700 relative overflow-hidden bg-neutral-100/45 dark:bg-neutral-900/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_8px_30px_-20px_rgba(15,23,42,0.35)]">
          <div className="sticky top-0 z-20 border-b border-neutral-200/80 dark:border-neutral-700 bg-white/90 dark:bg-neutral-900/90 backdrop-blur">
            <div className="grid grid-cols-7 gap-2 px-3 py-2.5">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((wd, i) => (
                <div
                  key={wd}
                  className={`rounded-lg py-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] ${
                    i >= 5
                      ? "text-neutral-500 dark:text-neutral-400 bg-neutral-100/80 dark:bg-neutral-800/60"
                      : "text-neutral-700 dark:text-neutral-300 bg-white dark:bg-neutral-800/40"
                  }`}
                >
                  {wd}
                </div>
              ))}
            </div>
          </div>
          <div key={`${periodStart}-${periodEnd}`} className="h-[calc(100%-64px)] px-3 pb-3 pt-2 animate-fade-in">
            <div className="h-full flex flex-col gap-2">
              {calendarWeeks.map((week, weekIndex) => (
                <div
                  key={`week-${weekIndex}`}
                  className={`grid grid-cols-7 gap-2 flex-1 min-h-0 rounded-xl p-1 ${
                    weekIndex % 2 === 0
                      ? "bg-white/55 dark:bg-neutral-900/25"
                      : "bg-neutral-50/65 dark:bg-neutral-900/40"
                  }`}
                >
                  {week.map((day, dayIdx) => {
                    if (!day) {
                      return (
                        <div
                          key={`empty-${weekIndex}-${dayIdx}`}
                          className="min-h-0 rounded-xl border border-dashed border-neutral-200 dark:border-neutral-700 bg-neutral-50/80 dark:bg-neutral-900/35"
                        />
                      );
                    }
                    const key = format(day, "yyyy-MM-dd");
                    const dayShifts = shiftsByDay.get(key) ?? [];
                    const isToday = isSameDay(day, new Date());
                    const isSelected = selectedDayKey === key;
                    const isWeekend = day.getDay() === 0 || day.getDay() === 6;

                    return (
                      <div
                        key={key}
                        className={`group/day min-h-0 rounded-xl border p-2.5 flex flex-col transition-all duration-200 ${
                          isSelected
                            ? "border-orange-300 dark:border-orange-500 ring-2 ring-orange-200/60 dark:ring-orange-500/40 bg-white dark:bg-neutral-900/80 shadow-sm"
                            : isToday
                              ? "border-orange-200 dark:border-orange-700 bg-orange-50/70 dark:bg-orange-900/20"
                              : isWeekend
                                ? "border-neutral-200 dark:border-neutral-700 bg-neutral-50/85 dark:bg-neutral-900/55 hover:border-neutral-300 dark:hover:border-neutral-600"
                                : "border-neutral-200 dark:border-neutral-700 bg-white/90 dark:bg-neutral-900/65 hover:border-neutral-300 dark:hover:border-neutral-600"
                        }`}
                        onClick={() => setSelectedDayKey(key)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div
                            className={`inline-flex items-center gap-2 rounded-lg px-2 py-1 ${
                              isToday
                                ? "bg-orange-100 dark:bg-orange-900/40 text-orange-900 dark:text-orange-200"
                                : "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                            }`}
                          >
                            <span className="text-sm font-semibold leading-none">{format(day, "d")}</span>
                            <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                              {format(day, "MMM")}
                            </span>
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400">
                            {dayShifts.length}
                          </span>
                        </div>

                        <div className="mt-2 flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
                          {dayShifts.length === 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDayKey(key);
                                setSelectedDayForShift(day);
                                setShowForm(true);
                              }}
                              className="w-full h-full min-h-[86px] rounded-lg border border-dashed border-neutral-300 dark:border-neutral-600 bg-white/60 dark:bg-neutral-900/40 text-neutral-500 dark:text-neutral-400 hover:border-orange-300 dark:hover:border-orange-500/60 hover:text-orange-700 dark:hover:text-orange-300 transition-colors flex flex-col items-center justify-center gap-1.5"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                              <span className="text-[11px] font-medium">Drop shift here</span>
                            </button>
                          ) : (
                            dayShifts.map((s) => {
                              const isNightShift = s.post.shiftType === "night";
                              const shiftTone = isNightShift
                                ? "bg-slate-100/95 dark:bg-slate-900/45 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                                : "bg-orange-50/95 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800/60 text-orange-900 dark:text-orange-200";
                              const shiftLabel = isNightShift ? "Night shift" : "Day shift";
                              const timeLabel = `${format(parseISO(s.startTime), "HH:mm")}–${format(parseISO(s.endTime), "HH:mm")}`;

                              return (
                                <div
                                  key={s.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveShift(s);
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setSelectedDayKey(key);
                                    setShiftContextMenu({ shift: s, x: e.clientX, y: e.clientY });
                                  }}
                                  className={`group/shift rounded-xl border px-2.5 py-2 text-[11px] cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                                    deletingShiftId === s.id
                                      ? "opacity-60 pointer-events-none"
                                      : "hover:border-rose-300 dark:hover:border-rose-500/60"
                                  } ${shiftTone}`}
                                  title={`${s.employee.firstName} ${s.employee.lastName} • ${shiftLabel} • ${timeLabel}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="font-semibold truncate">
                                      {s.employee.firstName} {s.employee.lastName}
                                    </p>
                                    <span className="text-[10px] opacity-0 group-hover/shift:opacity-100 transition-opacity text-rose-500 dark:text-rose-300">
                                      remove
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[10px] opacity-90">
                                    {shiftLabel} · {timeLabel}
                                  </p>
                                </div>
                              );
                            })
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDayKey(key);
                            setSelectedDayForShift(day);
                            setShowForm(true);
                          }}
                          className="mt-2 h-7 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-600 text-[11px] text-neutral-500 dark:text-neutral-400 hover:border-orange-300 dark:hover:border-orange-500/60 hover:text-orange-700 dark:hover:text-orange-300 transition-colors opacity-0 group-hover/day:opacity-100"
                        >
                          + Add shift
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          {shifts.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/90 dark:bg-neutral-900/90 pointer-events-none rounded-sm">
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
        ) : selectedSiteId ? (
          <div className="flex-1 min-h-0 overflow-auto rounded-2xl border border-neutral-200/90 dark:border-neutral-700 bg-neutral-50/80 dark:bg-neutral-900/50 p-3 md:p-4">
            <ShiftRosterSheet
              siteName={sites.find((s) => s.id === selectedSiteId)?.name ?? "Site"}
              periodLabel={periodLabel || "—"}
              days={calendarDays}
              rows={sheetRows}
              sites={sites.map((s) => ({ id: s.id, name: s.name }))}
              selectedSiteId={selectedSiteId}
              onSiteTabChange={setSelectedSiteId}
              rosterSiteRules={sites.find((s) => s.id === selectedSiteId)?.rosterSiteRules}
              rosterSheetNotes={sites.find((s) => s.id === selectedSiteId)?.rosterSheetNotes}
              rosterDayShiftGender={sites.find((s) => s.id === selectedSiteId)?.rosterDayShiftGender}
              rosterNightShiftGender={sites.find((s) => s.id === selectedSiteId)?.rosterNightShiftGender}
              rosterDayShiftGuardsRequired={
                sites.find((s) => s.id === selectedSiteId)?.rosterDayShiftGuardsRequired
              }
              rosterNightShiftGuardsRequired={
                sites.find((s) => s.id === selectedSiteId)?.rosterNightShiftGuardsRequired
              }
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-600 bg-white/70 dark:bg-neutral-900/40 px-6 py-16 text-center">
            <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">Select a site to view the shift sheet</p>
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400 max-w-sm">
              Choose a site in Step 1 in the sidebar. The sheet lists guards and D / N / O codes for each day in the roster period.
            </p>
          </div>
        )}
        {rosterView === "calendar" && (
        <div className="print:hidden flex items-center flex-wrap gap-6 mt-3 pl-1">
          <span className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
            <span className="w-3.5 h-3.5 rounded-md bg-orange-100 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800/60" />
            <span className="font-medium">Day shift</span>
          </span>
          <span className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
            <span className="w-3.5 h-3.5 rounded-md bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700" />
            <span className="font-medium">Night shift</span>
          </span>
          <span className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
            <span className="w-3.5 h-3.5 rounded-md border border-dashed border-neutral-400 dark:border-neutral-500 bg-white/80 dark:bg-neutral-900/60" />
            <span className="font-medium">Open slot</span>
          </span>
        </div>
        )}
        {shiftContextMenu && (
          <div
            className="fixed z-50 w-48 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl p-1"
            style={{ left: shiftContextMenu.x, top: shiftContextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200"
              onClick={async () => {
                const day = parseISO(shiftContextMenu.shift.startTime);
                setSelectedDayKey(format(day, "yyyy-MM-dd"));
                setSelectedDayForShift(day);
                setShowForm(true);
                setShiftContextMenu(null);
              }}
            >
              Add another shift this day
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/25 text-rose-600 dark:text-rose-300"
              onClick={async () => {
                const shift = shiftContextMenu.shift;
                setShiftContextMenu(null);
                await handleRemoveShift(shift);
              }}
            >
              Remove shift
            </button>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function RosterKpiCard({
  label,
  value,
  icon,
  tone,
  emphasize = false,
}: {
  label: string;
  value: string | number;
  icon: JSX.Element;
  tone: "neutral" | "day" | "night" | "coverage";
  emphasize?: boolean;
}) {
  const toneMap: Record<"neutral" | "day" | "night" | "coverage", string> = {
    neutral:
      "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/70 text-neutral-700 dark:text-neutral-300",
    day:
      "border-orange-200 dark:border-orange-900/50 bg-orange-50/80 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300",
    night:
      "border-slate-200 dark:border-slate-700 bg-slate-50/85 dark:bg-slate-900/30 text-slate-700 dark:text-slate-300",
    coverage:
      "border-orange-300/80 dark:border-orange-800/70 bg-gradient-to-br from-orange-50 to-white dark:from-orange-900/25 dark:to-neutral-900 text-orange-700 dark:text-orange-300",
  };

  return (
    <div
      className={`h-full rounded-xl border px-3.5 py-3 shadow-sm transition-shadow hover:shadow-md ${
        toneMap[tone]
      } ${emphasize ? "ring-1 ring-orange-200/70 dark:ring-orange-700/50" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.12em] font-semibold opacity-90">{label}</p>
        <span className="w-7 h-7 rounded-lg bg-white/80 dark:bg-neutral-900/70 border border-current/20 flex items-center justify-center">
          {icon}
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold leading-none text-neutral-900 dark:text-neutral-100">{value}</p>
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
          <option value="">Select team member</option>
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
