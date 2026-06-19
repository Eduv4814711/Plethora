"use client";

import { useEffect, useState, useMemo, type ReactElement } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useAuth } from "@/lib/auth-context";
import { authFetch, fetchCurrentPayPeriod, fetchPayPeriods, type PayPeriodOption } from "@/lib/api";
import { PayPeriodSelect } from "@/components/pay-period-select";
import { format, addDays, startOfMonth, endOfMonth, parseISO, startOfDay } from "date-fns";

import { RosterPlanPreview, type RosterPlan } from "./RosterPlanPreview";
import { ShiftRosterSheet } from "./ShiftRosterSheet";
import { buildShiftSheetRows, mergeSheetEmployeeLookup, type ShiftSheetRow } from "@/lib/shift-sheet-matrix";
import { DateInput } from "@/components/date-input";
import { generateGuardRosterPDF, generateShiftRosterSheetPDF } from "@/lib/roster-pdf";
import { buildSiteRosterReadinessHints } from "@/lib/roster-readiness-hints";
import { useConfirmDialog } from "@/components/ui";

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

interface Shift {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  employee: { id: string; firstName: string; lastName: string; gender?: string | null; phone?: string | null };
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
  assignedGuards?: { employee: { id: string; firstName?: string; lastName?: string } }[];
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

const SHIFT_PAGE_SIZE = 1000;

async function fetchAllShifts(
  token: string,
  params: { startDate: string; endDate: string; employeeId?: string; siteId?: string }
): Promise<Shift[]> {
  const all: Shift[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (all.length < total) {
    const q = new URLSearchParams({
      startDate: params.startDate,
      endDate: params.endDate,
      limit: String(SHIFT_PAGE_SIZE),
      offset: String(offset),
    });
    if (params.employeeId) q.set("employeeId", params.employeeId);
    if (params.siteId) q.set("siteId", params.siteId);

    const res = await authFetch(`/shifts?${q.toString()}`, token);
    const data = await parseApiJsonResponse(res);
    if (!res.ok) {
      throw new Error(String(data.message || data.error || "Failed to load shifts"));
    }

    const page = Array.isArray(data.data) ? (data.data as Shift[]) : [];
    all.push(...page);
    total = Number(data.total ?? all.length);
    const limit = Number(data.limit ?? SHIFT_PAGE_SIZE);
    if (page.length === 0 || all.length >= total) break;
    offset += limit;
  }

  return all;
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
  const { confirm, confirmDialog } = useConfirmDialog();
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
  const [periodKey, setPeriodKey] = useState("");
  const [rosterPeriodLabel, setRosterPeriodLabel] = useState("");
  const [payPeriodOptions, setPayPeriodOptions] = useState<PayPeriodOption[]>([]);
  const [draftPeriodKey, setDraftPeriodKey] = useState("");
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [showResetMenu, setShowResetMenu] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showPdfMenu, setShowPdfMenu] = useState(false);
  const [showPdfPeriodModal, setShowPdfPeriodModal] = useState(false);
  const [pdfAction, setPdfAction] = useState<"preview" | "download">("preview");
  const [pdfEmployeeId, setPdfEmployeeId] = useState<string | undefined>(undefined);
  const [pdfPeriodStart, setPdfPeriodStart] = useState("");
  const [pdfPeriodEnd, setPdfPeriodEnd] = useState("");
  const [pdfPeriodError, setPdfPeriodError] = useState<string | null>(null);
  const [rosterPlan, setRosterPlan] = useState<RosterPlan | null>(null);
  const [showRosterPlanModal, setShowRosterPlanModal] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [applyingPlan, setApplyingPlan] = useState(false);
  const [rosterPlanApplyError, setRosterPlanApplyError] = useState<string | null>(null);
  type AutomationRun = {
    id: string;
    siteId: string;
    siteName?: string;
    periodStart: string;
    periodEnd: string;
    status: string;
    coveragePercent: number | null;
    plan: RosterPlan | null;
    errorMessage: string | null;
    createdAt: string;
  };
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>([]);
  const [automationRun, setAutomationRun] = useState<AutomationRun | null>(null);
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  const [automationApplying, setAutomationApplying] = useState(false);
  const [automationApplyError, setAutomationApplyError] = useState<string | null>(null);
  const pendingAutomationCount = automationRuns.filter((r) => r.status === "pending_review").length;
  const applyPayPeriod = (period: PayPeriodOption) => {
    setPeriodKey(period.periodKey);
    setPeriodStart(period.periodStart);
    setPeriodEnd(period.periodEnd);
    setRosterPeriodLabel(period.rosterLabel);
  };

  const shiftPayPeriod = (direction: -1 | 1) => {
    if (!periodKey || payPeriodOptions.length === 0) return;
    const idx = payPeriodOptions.findIndex((p) => p.periodKey === periodKey);
    const next = payPeriodOptions[idx + direction];
    if (next) applyPayPeriod(next);
  };

  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetchCurrentPayPeriod(token),
      fetchPayPeriods(token, { before: 12, after: 6 }),
    ])
      .then(([current, periods]) => {
        setPayPeriodOptions(periods);
        if (!periodKey) applyPayPeriod(current);
      })
      .catch(console.error);
  }, [token]);

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
    const confirmed = await confirm({
      title: "Reset this guard's roster?",
      message: `This removes all rostered shifts for ${name} in the visible period only.`,
      confirmLabel: "Reset shifts",
    });
    if (!confirmed) return;
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
    const confirmed = await confirm({
      title: "Reset entire roster?",
      message: "This removes all created or assigned shifts in the visible period only.",
      confirmLabel: "Reset roster",
    });
    if (!confirmed) return;
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
      periodShifts = await fetchAllShifts(token, { startDate, endDate, employeeId: pdfEmployeeId });
    } else {
      const [pagedShifts, empRes] = await Promise.all([
        fetchAllShifts(token, { startDate, endDate, siteId: selectedSiteId }),
        authFetch("/employees?limit=100", token),
      ]);
      periodShifts = pagedShifts;
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
        employees: mergeSheetEmployeeLookup(pdfEmployees, siteForPdf?.assignedGuards),
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

  const openPeriodModal = () => {
    setDraftPeriodKey(periodKey);
    setShowPeriodModal(true);
  };

  const calendarDays = useMemo(() => {
    const start = startOfDay(parseISO(periodStart));
    const end = new Date(parseISO(periodEnd));
    end.setHours(23, 59, 59, 999);
    const days: Date[] = [];
    let d = new Date(start);
    while (d <= end) {
      days.push(new Date(d));
      d = addDays(d, 1);
    }
    return days;
  }, [periodStart, periodEnd]);

  const filteredShifts = useMemo(() => {
    if (!selectedSiteId) return shifts;
    return shifts.filter((s) => s.post.site.id === selectedSiteId);
  }, [shifts, selectedSiteId]);

  const sheetEmployeeLookup = useMemo(
    () =>
      mergeSheetEmployeeLookup(
        employees,
        selectedSiteId ? sites.find((s) => s.id === selectedSiteId)?.assignedGuards : undefined
      ),
    [employees, sites, selectedSiteId]
  );

  const sheetRows = useMemo((): ShiftSheetRow[] => {
    if (!selectedSiteId) return [];
    return buildShiftSheetRows({
      shifts: filteredShifts,
      calendarDays,
      siteId: selectedSiteId,
      employees: sheetEmployeeLookup,
    });
  }, [selectedSiteId, filteredShifts, calendarDays, sheetEmployeeLookup]);

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

  const postsForSelectedSite = useMemo(() => {
    if (!selectedSiteId) return [];
    const site = sites.find((s) => s.id === selectedSiteId);
    return site?.posts ?? [];
  }, [sites, selectedSiteId]);

  const selectedSite = useMemo(
    () => (selectedSiteId ? sites.find((s) => s.id === selectedSiteId) : undefined),
    [sites, selectedSiteId]
  );

  const rosterReadinessHints = useMemo(() => {
    if (!selectedSite) return [];
    return buildSiteRosterReadinessHints(selectedSite);
  }, [selectedSite]);

  const canGenerateRosterPlan =
    !!selectedSiteId &&
    siteAssignedGuards.length > 0 &&
    !!periodStart &&
    !!periodEnd &&
    parseISO(periodEnd) >= parseISO(periodStart);

  const handleGenerateRosterPlan = async () => {
    if (!token || !selectedSiteId) return;
    setGeneratingPlan(true);
    setBulkError(null);
    setRosterPlanApplyError(null);
    const { startDate, endDate } = getDateRangeParams();
    const body = {
      siteId: selectedSiteId,
      startDate: startDate.slice(0, 10),
      endDate: endDate.slice(0, 10),
    };
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

  const refreshAutomationRuns = () => {
    if (!token) return Promise.resolve();
    return authFetch("/shifts/roster/automation", token)
      .then((r) => r.json())
      .then((data) => setAutomationRuns(Array.isArray(data.data) ? data.data : []))
      .catch(console.error);
  };

  const openAutomationRun = (run: AutomationRun) => {
    if (!run.plan) return;
    setAutomationRun(run);
    setAutomationApplyError(null);
    setShowAutomationModal(true);
  };

  const handleApplyAutomationRun = async () => {
    if (!token || !automationRun) return;
    setAutomationApplying(true);
    setAutomationApplyError(null);
    try {
      const res = await authFetch(`/shifts/roster/automation/${automationRun.id}/apply`, token, {
        method: "POST",
      });
      const data = await parseApiJsonResponse(res);
      if (!res.ok) throw new Error(String(data.error || data.message || "Failed to apply"));
      setShowAutomationModal(false);
      setAutomationRun(null);
      await Promise.all([refresh(), refreshAutomationRuns()]);
      setBulkError(`Applied auto-roster plan (${Number(data.created ?? 0)} shift(s) created).`);
      setTimeout(() => setBulkError(null), 5000);
    } catch (err) {
      setAutomationApplyError(err instanceof Error ? err.message : "Failed to apply");
    } finally {
      setAutomationApplying(false);
    }
  };

  const handleDismissAutomationRun = async (runId: string) => {
    if (!token) return;
    const confirmed = await confirm({
      title: "Dismiss queued plan?",
      message: "This removes the plan from the review queue without applying shifts.",
      confirmLabel: "Dismiss",
    });
    if (!confirmed) return;
    try {
      const res = await authFetch(`/shifts/roster/automation/${runId}/dismiss`, token, {
        method: "POST",
      });
      const data = await parseApiJsonResponse(res);
      if (!res.ok) throw new Error(String(data.error || "Failed to dismiss"));
      if (automationRun?.id === runId) {
        setShowAutomationModal(false);
        setAutomationRun(null);
      }
      await refreshAutomationRuns();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed to dismiss");
    }
  };

  const refresh = () => {
    if (!token) return Promise.resolve();
    const { startDate, endDate } = getDateRangeParams();
    return Promise.all([
      fetchAllShifts(token, { startDate, endDate }),
      authFetch("/employees?limit=100", token).then((r) => r.json()),
      authFetch("/sites?limit=100", token).then((r) => r.json()),
    ])
      .then(([shiftsRes, empRes, sitesRes]) => {
        setShifts(shiftsRes);
        setEmployees(empRes.data || []);
        setSites(sitesRes.data || []);
      })
      .catch(console.error);
  };

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([refresh(), refreshAutomationRuns()]).finally(() => setLoading(false));
  }, [token, periodStart, periodEnd]);

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
    rosterPeriodLabel ||
    (calendarDays.length > 0
      ? calendarDays.length === 1
        ? format(calendarDays[0], "d MMM yyyy")
        : format(calendarDays[0], "d MMM") + " – " + format(calendarDays[calendarDays.length - 1], "d MMM yyyy")
      : "");
  const selectedSiteName = selectedSiteId
    ? sites.find((s) => s.id === selectedSiteId)?.name ?? "Unknown site"
    : "All sites";
  const totalPostsForSummary = selectedSiteId
    ? postsForSelectedSite.length
    : sites.reduce((sum, site) => sum + site.posts.length, 0);
  const dayStaffRequired = selectedSite
    ? (() => {
        const n = selectedSite.rosterDayShiftGuardsRequired;
        if (n == null) return 1;
        const v = Math.floor(Number(n));
        return Number.isFinite(v) ? Math.min(50, Math.max(0, v)) : 1;
      })()
    : 0;
  const nightStaffRequired = selectedSite
    ? (() => {
        const n = selectedSite.rosterNightShiftGuardsRequired;
        if (n == null) return 1;
        const v = Math.floor(Number(n));
        return Number.isFinite(v) ? Math.min(50, Math.max(0, v)) : 1;
      })()
    : 0;
  const totalShiftsForSummary = filteredShifts.length;
  const dayShiftCount = filteredShifts.filter((s) => (s.post.shiftType ?? "day") === "day").length;
  const nightShiftCount = filteredShifts.filter((s) => s.post.shiftType === "night").length;
  const expectedShiftSlots =
    selectedSiteId && selectedSite
      ? (dayStaffRequired + nightStaffRequired) * calendarDays.length
      : totalPostsForSummary * calendarDays.length;
  const openShiftCount = Math.max(expectedShiftSlots - totalShiftsForSummary, 0);
  const coveragePercent =
    expectedShiftSlots > 0
      ? Math.min(100, Math.round((totalShiftsForSummary / expectedShiftSlots) * 100))
      : 0;

  return (
    <div className="mx-auto flex h-[calc(100dvh-7.5rem)] min-h-[620px] w-full max-w-[1760px] flex-col xl:flex-row gap-5 rounded-[28px] bg-gradient-to-b from-neutral-50/85 via-white to-orange-50/35 dark:from-neutral-900 dark:via-neutral-950 dark:to-neutral-900 p-2 xl:p-3 print:min-h-0 print:h-auto print:max-w-none print:rounded-none print:bg-white print:p-4 print:gap-0">
      {confirmDialog}
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
            {rosterPeriodLabel && (
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">{periodStart} – {periodEnd}</p>
            )}
            <button
              type="button"
              onClick={openPeriodModal}
              className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 underline"
            >
              Change period
            </button>
          </div>

          {pendingAutomationCount > 0 && (
            <div className="rounded-xl border border-amber-300/90 dark:border-amber-700/60 bg-amber-50/80 dark:bg-amber-950/30 p-3.5 space-y-2">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                Auto-roster queue ({pendingAutomationCount} pending)
              </p>
              <ul className="space-y-1.5 max-h-40 overflow-y-auto text-xs">
                {automationRuns
                  .filter((r) => r.status === "pending_review")
                  .map((run) => (
                    <li
                      key={run.id}
                      className="flex items-start justify-between gap-2 rounded-lg border border-amber-200/80 dark:border-amber-800/50 bg-white/70 dark:bg-neutral-900/50 px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-neutral-800 dark:text-neutral-100 truncate">
                          {run.siteName ?? "Site"}
                        </p>
                        <p className="text-neutral-500 dark:text-neutral-400">
                          {run.periodStart} – {run.periodEnd}
                          {run.coveragePercent != null ? ` · ${run.coveragePercent}% coverage` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => openAutomationRun(run)}
                          className="text-[11px] font-medium text-orange-700 dark:text-orange-300 hover:underline"
                        >
                          Review
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDismissAutomationRun(run.id)}
                          className="text-[11px] text-neutral-500 hover:underline"
                        >
                          Dismiss
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          )}

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

          {selectedSiteId && (
            <div className="rounded-xl border border-orange-200/90 dark:border-orange-800/50 bg-orange-50/50 dark:bg-orange-950/20 p-3.5 space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-700 dark:text-neutral-200">
                Step 2: Generate Roster
              </h3>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-snug">
                Generate a fair monthly roster for all guards on this site from staffing requirements, then preview and apply.
              </p>
              {rosterReadinessHints.length > 0 && (
                <ul className="space-y-1 text-[11px] rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white/80 dark:bg-neutral-900/50 px-2.5 py-2">
                  {rosterReadinessHints.map((hint, i) => (
                    <li
                      key={`${hint.code}-${i}`}
                      className={
                        hint.level === "error"
                          ? "text-red-700 dark:text-red-300"
                          : hint.level === "warning"
                            ? "text-amber-800 dark:text-amber-200"
                            : "text-neutral-600 dark:text-neutral-400"
                      }
                    >
                      • {hint.message}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={handleGenerateRosterPlan}
                disabled={!canGenerateRosterPlan || generatingPlan}
                className="w-full btn-primary py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generatingPlan ? "Generating…" : "Generate fair monthly roster"}
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-[1.75rem] leading-none font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">
                Shift sheet
              </h1>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                Staff × day matrix for the selected site
              </p>
            </div>
          </div>
          <div className="hidden xl:flex justify-center" />
          <div className="flex w-full flex-col gap-2.5 xl:items-end">
            <div className="flex flex-wrap items-center gap-2.5 xl:flex-nowrap xl:justify-end">
              <button
                type="button"
                onClick={openPeriodModal}
                className="h-11 px-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm font-semibold text-neutral-800 dark:text-neutral-200 hover:border-neutral-300 dark:hover:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2 xl:hidden"
                title="Choose time period to roster"
              >
                <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Period</span>
                <span>{periodLabel || "Select period"}</span>
              </button>
              <div className="flex items-center h-11 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-hidden">
                <button
                  type="button"
                  onClick={() => shiftPayPeriod(-1)}
                  className="h-full px-3 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-neutral-600 dark:text-neutral-400"
                  aria-label="Previous period"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const current = payPeriodOptions.find((p) => p.isCurrent);
                    if (current) applyPayPeriod(current);
                  }}
                  className="h-full px-4 text-sm font-medium border-x border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-neutral-700 dark:text-neutral-300"
                >
                  Current period
                </button>
                <button
                  type="button"
                  onClick={() => shiftPayPeriod(1)}
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
                onClick={openPeriodModal}
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
                  Select the pay period you want to roster. Periods are labelled by the month in which they end.
                </p>
                <div className="space-y-4 mb-6">
                  {token && (
                    <PayPeriodSelect
                      token={token}
                      variant="roster"
                      value={draftPeriodKey}
                      onChange={(p) => setDraftPeriodKey(p.periodKey)}
                    />
                  )}
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
                      const picked = payPeriodOptions.find((p) => p.periodKey === draftPeriodKey);
                      if (picked) {
                        applyPayPeriod(picked);
                        setShowPeriodModal(false);
                      }
                    }}
                    disabled={!draftPeriodKey}
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
            <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm overscroll-y-contain">
              <div className="card-wireframe flex w-full max-w-2xl max-h-[min(90vh,880px)] flex-col overflow-hidden shadow-xl my-auto">
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

        {showAutomationModal &&
          automationRun?.plan &&
          createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm overscroll-y-contain">
              <div className="card-wireframe flex w-full max-w-2xl max-h-[min(90vh,880px)] flex-col overflow-hidden shadow-xl my-auto">
                <RosterPlanPreview
                  plan={automationRun.plan}
                  siteName={automationRun.siteName ?? "Site"}
                  periodLabel={`${automationRun.periodStart} – ${automationRun.periodEnd}`}
                  guards={
                    sites.find((s) => s.id === automationRun.siteId)?.assignedGuards?.map((a) => ({
                      id: a.employee.id,
                      firstName: a.employee.firstName,
                      lastName: a.employee.lastName,
                    })) ?? []
                  }
                  posts={sites.find((s) => s.id === automationRun.siteId)?.posts ?? []}
                  onCancel={() => {
                    if (!automationApplying) {
                      setShowAutomationModal(false);
                      setAutomationRun(null);
                      setAutomationApplyError(null);
                    }
                  }}
                  onApply={handleApplyAutomationRun}
                  applying={automationApplying}
                  applyError={automationApplyError}
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
        {selectedSiteId ? (
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
  icon: ReactElement;
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
