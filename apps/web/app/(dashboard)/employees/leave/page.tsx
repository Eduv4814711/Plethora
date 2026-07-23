"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { fetchEmployeePickerOptions, type GuardPickerOption } from "@/lib/roster-api";
import { DateInput } from "@/components/date-input";
import { GuardSearchPicker } from "@/components/guard-search-picker";
import { hasCapability } from "@/lib/permissions";
import {
  leaveOccurrenceCount,
  prepareLeaveAdjustmentResolution,
  type LeaveAdjustmentResolutionDecision,
} from "@/lib/leave-management-utils";

type Tab = "queue" | "records" | "balances" | "calendar" | "adjustments" | "policies" | "reports" | "audit" | "add";
type IconName = "inbox" | "records" | "balance" | "calendar" | "adjust" | "policy" | "report" | "audit" | "plus" | "arrow" | "warning" | "check" | "file" | "people" | "clock" | "search" | "close";
type Employee = { id: string; firstName: string; lastName: string; employeeNumber: string; group?: { name: string } | null };
type LeaveType = { id: string; code: string; name: string; description?: string; payrollTreatment: string; durationMode: string; requiresDocument: boolean };
type LeaveDocument = {
  id: string;
  documentType: string;
  reviewStatus: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};
type LeaveApplication = {
  id: string;
  startDate: string;
  endDate: string;
  calculatedMinutes: number;
  paidMinutes: number;
  unpaidMinutes: number;
  status: string;
  source: string;
  reason?: string | null;
  decisionReason?: string | null;
  createdAt: string;
  version: number;
  employee: Employee;
  leaveType: LeaveType;
  documents: LeaveDocument[];
  occurrences?: Array<{ id: string }>;
  _count?: { occurrences: number };
};
type LeavePreview = {
  calendarDays: number;
  calculatedMinutes: number;
  paidMinutes: number;
  unpaidMinutes: number;
  warnings: string[];
  conflicts: Array<{ id: string; status: string }>;
  policyConfirmed: boolean;
  documentRequired: boolean;
  balanceImpact: { currentMinutes: number; reservedMinutes: number; projectedMinutes: number };
  staffingImpact: { shiftsAffected: number; siteIds: string[]; unrosteredCalendarDays: number };
};
type Balance = {
  employeeId: string;
  leaveTypeId: string;
  accrued: number;
  reserved: number;
  taken: number;
  adjustments: number;
  available: number;
  employee?: Employee;
  leaveType?: LeaveType;
};
type LeaveAdjustment = {
  id: string;
  minutes: number;
  reason: string;
  status: string;
  createdAt: string;
  payrollImpact?: Record<string, unknown> | null;
  employee: Employee;
  leaveType: LeaveType;
  application?: Pick<LeaveApplication, "id" | "status" | "startDate" | "endDate" | "version"> | null;
  requestedBy?: { id: string; name: string };
};
type PolicyVersion = {
  id: string;
  version: number;
  reviewStatus: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  sourceAuthority: string;
  legalReference?: string | null;
  entitlementMinutes?: number | null;
  accrualMethod: string;
  accrualRateMinutes?: number | string | null;
  cycleMonths: number;
  carryOverLimitMinutes?: number | null;
  expiryMonths?: number | null;
  maxConsecutiveDays?: number | null;
  negativeBalanceAllowed: boolean;
  configurationReady: boolean;
  configurationIssues: string[];
  leaveType: LeaveType & { requiresBalance: boolean };
};
type Policy = { id: string; name: string; category: string; description?: string; versions: PolicyVersion[]; assignments: unknown[] };
type PolicyEditorSelection = { policyId: string; policyName: string; version: PolicyVersion };
type PolicyConfigurationPayload = {
  leaveTypeCode: string;
  effectiveFrom: string;
  sourceAuthority: string;
  legalReference?: string;
  entitlementMinutes?: number;
  accrualMethod: string;
  accrualRateMinutes?: number;
  cycleMonths: number;
  carryOverLimitMinutes: null;
  expiryMonths: null;
  noticeDays: null;
  maxConsecutiveDays?: number;
  negativeBalanceAllowed: boolean;
  autoConvertToUnpaid: boolean;
};
type AccrualRunResult = {
  asOf: string;
  posted: Array<{ employeeId: string; leaveTypeCode: string; minutes: number }>;
  skipped: Array<{ policyVersionId: string; employeeId?: string; reason: string }>;
};
type AuditEvent = { id: string; eventType: string; occurredAt: string; reason?: string; employee?: Pick<Employee, "firstName" | "lastName">; user?: { name: string } };
type ReportBreakdown = Record<string, { applications: number; paidMinutes: number; unpaidMinutes: number }>;
type LeaveReport = {
  total: number;
  pending: number;
  approved: number;
  payrollProcessed: number;
  liabilityEstimate: number;
  byType: ReportBreakdown;
  byTeam: ReportBreakdown;
  negativeBalances: unknown[];
  highBalances: unknown[];
  unpaid: unknown[];
  retrospective: unknown[];
};

const today = format(new Date(), "yyyy-MM-dd");
const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
const monthEnd = format(endOfMonth(new Date()), "yyyy-MM-dd");
const pendingStatuses = ["PENDING_HR", "SUBMITTED"];
const actionStatuses = ["PENDING_HR", "ADJUSTMENT_REQUIRED", "CANCELLATION_REQUESTED"];
const tabs: Array<{ key: Tab; label: string; shortLabel: string; icon: IconName }> = [
  { key: "queue", label: "Approval queue", shortLabel: "Queue", icon: "inbox" },
  { key: "records", label: "Leave records", shortLabel: "Records", icon: "records" },
  { key: "balances", label: "Balances", shortLabel: "Balances", icon: "balance" },
  { key: "calendar", label: "Leave calendar", shortLabel: "Calendar", icon: "calendar" },
  { key: "reports", label: "Reports", shortLabel: "Reports", icon: "report" },
  { key: "policies", label: "Policies", shortLabel: "Policies", icon: "policy" },
  { key: "adjustments", label: "Adjustments", shortLabel: "Adjust", icon: "adjust" },
  { key: "audit", label: "Audit history", shortLabel: "Audit", icon: "audit" },
];

function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const object = value as Record<string, unknown>;
  if (typeof object.message === "string" && object.message.trim()) return object.message;
  if (object.message && typeof object.message === "object") {
    for (const messages of Object.values(object.message as Record<string, unknown>)) {
      if (Array.isArray(messages) && typeof messages[0] === "string") return messages[0];
    }
  }
  return typeof object.error === "string" ? object.error : fallback;
}

function hours(minutes: number): string {
  const absolute = Math.abs(minutes);
  const formatted = `${(absolute / 60).toFixed(absolute % 60 ? 1 : 0)}h`;
  return minutes < 0 ? `-${formatted}` : formatted;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(value || 0);
}

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dateLabel(value: string, pattern = "d MMM yyyy"): string {
  return format(parseISO(value.slice(0, 10)), pattern);
}

function period(start: string, end: string): string {
  return start.slice(0, 10) === end.slice(0, 10) ? dateLabel(start) : `${dateLabel(start)} - ${dateLabel(end)}`;
}

function employeeName(employee?: Employee): string {
  return employee ? `${employee.firstName} ${employee.lastName}` : "Unknown employee";
}

function initials(employee?: Employee): string {
  return employee ? `${employee.firstName[0] ?? ""}${employee.lastName[0] ?? ""}`.toUpperCase() : "?";
}

function friendly(value: string): string {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: string): string {
  if (["APPROVED", "IMPORTED_APPROVED", "PAYROLL_PROCESSED", "ACTIVE", "VERIFIED"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["REJECTED", "CANCELLED", "ADJUSTMENT_REQUIRED"].includes(status)) return "border-red-200 bg-red-50 text-red-700";
  if (["DRAFT", "WITHDRAWN", "EXPIRED"].includes(status)) return "border-neutral-200 bg-neutral-100 text-neutral-600";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function LeaveManagementPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(
    user &&
      (hasCapability(user, "/employees/leave", "create") ||
        hasCapability(user, "/payroll", "create"))
  );
  const canEdit = Boolean(
    user &&
      (hasCapability(user, "/employees/leave", "edit") ||
        hasCapability(user, "/payroll", "edit"))
  );
  const canApprove = Boolean(
    user &&
      (hasCapability(user, "/employees/leave", "approve") ||
        hasCapability(user, "/payroll", "approve"))
  );
  const canExport = Boolean(
    user &&
      (hasCapability(user, "/employees/leave", "export") ||
        hasCapability(user, "/payroll", "export"))
  );
  const [tab, setTab] = useState<Tab>("queue");
  const [employees, setEmployees] = useState<GuardPickerOption[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [applications, setApplications] = useState<LeaveApplication[]>([]);
  const [summaryApplications, setSummaryApplications] = useState<LeaveApplication[]>([]);
  const [pendingAdjustments, setPendingAdjustments] = useState<LeaveAdjustment[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [report, setReport] = useState<LeaveReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("PENDING_HR");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [range, setRange] = useState({ start: monthStart, end: monthEnd });
  const [partialLeave, setPartialLeave] = useState(false);
  const [form, setForm] = useState({ employeeId: "", leaveTypeCode: "annual", startDate: today, endDate: today, hoursPerDay: "", reason: "", retrospectiveReason: "" });
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [document, setDocument] = useState<File | null>(null);
  const [adjustment, setAdjustment] = useState({ employeeId: "", leaveTypeCode: "annual", hours: "", reason: "" });
  const [adjustmentDialog, setAdjustmentDialog] = useState<{ adjustment: LeaveAdjustment; decision: LeaveAdjustmentResolutionDecision } | null>(null);
  const [adjustmentResolution, setAdjustmentResolution] = useState({ reason: "", payrollReference: "" });
  const [actionDialog, setActionDialog] = useState<{ kind: "reject" | "cancel"; application: LeaveApplication } | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [policyEditor, setPolicyEditor] = useState<PolicyEditorSelection | null>(null);
  const [accrualRunResult, setAccrualRunResult] = useState<AccrualRunResult | null>(null);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    if (!token) throw new Error("Not signed in");
    const response = await authFetch(path, token, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorMessage(body, `Request failed (${response.status})`));
    return body;
  }, [token]);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    const body = await request("/leave/applications?limit=250");
    setSummaryApplications(body.data ?? []);
  }, [token, request]);

  const loadBase = useCallback(async () => {
    if (!token) return;
    const [employeeRows, typeBody, policyBody] = await Promise.all([
      fetchEmployeePickerOptions(token, { statuses: ["active", "training", "hired", "reliever"] }),
      request("/leave/types"),
      request("/leave/policies"),
      loadSummary(),
    ]);
    setEmployees(employeeRows);
    setTypes(typeBody.data ?? []);
    setPolicies(policyBody.data ?? []);
  }, [token, request, loadSummary]);

  const loadTab = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      if (tab === "queue" || tab === "records") {
        const query = new URLSearchParams();
        if (tab === "queue") query.set("status", status);
        if (employeeFilter) query.set("employeeId", employeeFilter);
        if (tab === "records") {
          query.set("start", range.start);
          query.set("end", range.end);
        }
        const body = await request(`/leave/applications?${query}`);
        setApplications(body.data ?? []);
      } else if (tab === "balances") {
        const query = employeeFilter ? `?employeeId=${encodeURIComponent(employeeFilter)}` : "";
        setBalances((await request(`/leave/balances${query}`)).data ?? []);
      } else if (tab === "calendar") {
        setApplications((await request(`/leave/calendar?start=${range.start}&end=${range.end}`)).data ?? []);
      } else if (tab === "policies") {
        setPolicies((await request("/leave/policies")).data ?? []);
      } else if (tab === "reports") {
        setReport(await request(`/leave/reports?start=${range.start}&end=${range.end}`));
      } else if (tab === "adjustments") {
        setPendingAdjustments((await request("/leave/adjustments?status=PENDING")).data ?? []);
      } else if (tab === "audit") {
        setAudit((await request("/leave/audit?limit=250")).data ?? []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load leave data");
    } finally {
      setLoading(false);
    }
  }, [token, tab, status, employeeFilter, range.start, range.end, request]);

  useEffect(() => {
    loadBase().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load leave configuration"));
  }, [loadBase]);
  useEffect(() => { loadTab(); }, [loadTab]);

  const leaveType = useMemo(() => types.find((type) => type.code === form.leaveTypeCode), [types, form.leaveTypeCode]);
  const summary = useMemo(() => ({
    pending: summaryApplications.filter((app) => pendingStatuses.includes(app.status)).length,
    upcoming: summaryApplications.filter((app) => ["APPROVED", "IMPORTED_APPROVED"].includes(app.status) && app.endDate.slice(0, 10) >= today).length,
    evidence: summaryApplications.filter((app) => app.leaveType.requiresDocument && !app.documents.some((doc) => doc.reviewStatus === "VERIFIED") && !["REJECTED", "CANCELLED", "WITHDRAWN"].includes(app.status)).length,
    attention: summaryApplications.filter((app) => ["ADJUSTMENT_REQUIRED", "CANCELLATION_REQUESTED"].includes(app.status)).length,
  }), [summaryApplications]);
  const currentPolicyIssues = useMemo(() => {
    const issues: string[] = [];
    for (const policy of policies) {
      if (policy.category !== "STATUTORY_BASELINE" && policy.assignments.length === 0) continue;
      const byType = new Map<string, PolicyVersion>();
      for (const version of policy.versions) {
        const starts = version.effectiveFrom.slice(0, 10) <= today;
        const hasNotEnded = !version.effectiveTo || version.effectiveTo.slice(0, 10) >= today;
        if (!starts || !hasNotEnded) continue;
        const current = byType.get(version.leaveType.code);
        if (!current
          || current.effectiveFrom < version.effectiveFrom
          || (current.effectiveFrom === version.effectiveFrom && current.version < version.version)) {
          byType.set(version.leaveType.code, version);
        }
      }
      for (const type of types) {
        const version = byType.get(type.code);
        if (!version) issues.push(`${policy.id}:${type.code}:missing`);
        else if (version.reviewStatus !== "ACTIVE" || !version.configurationReady) issues.push(version.id);
      }
    }
    return issues;
  }, [policies, types]);

  function resetPreview() { setPreview(null); }

  async function previewApplication() {
    setBusy("preview");
    setError(null);
    try {
      const body = await request("/leave/preview", {
        method: "POST",
        body: JSON.stringify({
          employeeId: form.employeeId,
          leaveTypeCode: form.leaveTypeCode,
          startDate: form.startDate,
          endDate: form.endDate,
          ...(partialLeave && form.hoursPerDay ? { requestedMinutesPerDay: Math.round(Number(form.hoursPerDay) * 60) } : {}),
        }),
      });
      setPreview(body);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  }

  async function createApplication(event: React.FormEvent) {
    event.preventDefault();
    if (!canCreate) return;
    setBusy("create");
    setError(null);
    try {
      const created = await request("/leave/applications", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          employeeId: form.employeeId,
          leaveTypeCode: form.leaveTypeCode,
          startDate: form.startDate,
          endDate: form.endDate,
          reason: form.reason || undefined,
          retrospectiveReason: form.retrospectiveReason || undefined,
          ...(partialLeave && form.hoursPerDay ? { requestedMinutesPerDay: Math.round(Number(form.hoursPerDay) * 60) } : {}),
          submit: true,
        }),
      });
      if (document) {
        const upload = new FormData();
        upload.append("file", document);
        upload.append("documentType", "supporting_document");
        await request(`/leave/applications/${created.id}/documents`, { method: "POST", body: upload });
      }
      setForm({ employeeId: "", leaveTypeCode: "annual", startDate: today, endDate: today, hoursPerDay: "", reason: "", retrospectiveReason: "" });
      setPartialLeave(false);
      setDocument(null);
      setPreview(null);
      setStatus("PENDING_HR");
      setTab("queue");
      await loadSummary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create leave application");
    } finally {
      setBusy(null);
    }
  }

  async function decide(application: LeaveApplication, decision: "approve" | "reject", reason?: string) {
    if (!canApprove) return;
    setBusy(application.id);
    setError(null);
    try {
      await request(`/leave/applications/${application.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, reason: reason || undefined, expectedVersion: application.version }),
      });
      setActionDialog(null);
      setActionReason("");
      await Promise.all([loadTab(), loadSummary()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Decision failed");
    } finally {
      setBusy(null);
    }
  }

  async function verifyDocument(id: string) {
    if (!canApprove) return;
    setBusy(id);
    setError(null);
    try {
      await request(`/leave/documents/${id}/verify`, { method: "POST", body: JSON.stringify({ decision: "verify", note: "Verified by HR" }) });
      await Promise.all([loadTab(), loadSummary()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Document verification failed");
    } finally {
      setBusy(null);
    }
  }

  async function reviewDocument(leaveDocument: LeaveDocument) {
    if (!token || !canExport) {
      setError("Not signed in");
      return;
    }

    const reviewTab = window.open("about:blank", "_blank");
    if (reviewTab) {
      reviewTab.opener = null;
      reviewTab.document.title = `Loading ${leaveDocument.fileName}`;
      reviewTab.document.body.textContent = "Loading secure leave document...";
    }

    setBusy(leaveDocument.id);
    setError(null);
    try {
      const response = await authFetch(`/leave/documents/${leaveDocument.id}/download`, token);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(errorMessage(body, `Document download failed (${response.status})`));
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (reviewTab && !reviewTab.closed) {
        reviewTab.location.replace(objectUrl);
      } else {
        const link = window.document.createElement("a");
        link.href = objectUrl;
        link.download = leaveDocument.fileName || "leave-document";
        window.document.body.appendChild(link);
        link.click();
        link.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60 * 1000);
    } catch (cause) {
      if (reviewTab && !reviewTab.closed) reviewTab.close();
      setError(cause instanceof Error ? cause.message : "Document review failed");
    } finally {
      setBusy(null);
    }
  }

  async function cancelApplication(application: LeaveApplication, reason: string) {
    if (!canEdit) return;
    setBusy(application.id);
    setError(null);
    try {
      await request(`/leave/applications/${application.id}/cancel`, { method: "POST", body: JSON.stringify({ reason, expectedVersion: application.version }) });
      setActionDialog(null);
      setActionReason("");
      await Promise.all([loadTab(), loadSummary()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cancellation failed");
    } finally {
      setBusy(null);
    }
  }

  async function postAdjustment(event: React.FormEvent) {
    event.preventDefault();
    if (!canCreate) return;
    setBusy("adjustment");
    setError(null);
    try {
      await request("/leave/adjustments", { method: "POST", body: JSON.stringify({ employeeId: adjustment.employeeId, leaveTypeCode: adjustment.leaveTypeCode, minutes: Math.round(Number(adjustment.hours) * 60), reason: adjustment.reason }) });
      setAdjustment({ employeeId: "", leaveTypeCode: "annual", hours: "", reason: "" });
      setTab("balances");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Adjustment failed");
    } finally {
      setBusy(null);
    }
  }

  function openAdjustmentResolution(adjustmentRow: LeaveAdjustment, decision: LeaveAdjustmentResolutionDecision) {
    setError(null);
    setAdjustmentResolution({ reason: "", payrollReference: "" });
    setAdjustmentDialog({ adjustment: adjustmentRow, decision });
  }

  function closeAdjustmentResolution() {
    setAdjustmentDialog(null);
    setAdjustmentResolution({ reason: "", payrollReference: "" });
  }

  async function resolvePendingAdjustment() {
    if (!adjustmentDialog || !canApprove) return;
    const prepared = prepareLeaveAdjustmentResolution({
      decision: adjustmentDialog.decision,
      reason: adjustmentResolution.reason,
      payrollReference: adjustmentResolution.payrollReference,
    });
    if (!prepared.valid) {
      setError(prepared.error);
      return;
    }

    const busyKey = `adjustment-resolution:${adjustmentDialog.adjustment.id}`;
    setBusy(busyKey);
    setError(null);
    try {
      await request(`/leave/adjustments/${adjustmentDialog.adjustment.id}/resolve`, {
        method: "POST",
        body: JSON.stringify(prepared.payload),
      });
      closeAdjustmentResolution();
      await Promise.all([loadTab(), loadSummary()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Adjustment resolution failed");
    } finally {
      setBusy(null);
    }
  }

  async function confirmPolicy(versionId: string) {
    if (!canApprove) return;
    setBusy(versionId);
    setError(null);
    try {
      await request(`/leave/policies/versions/${versionId}/confirm`, { method: "POST" });
      await loadTab();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Policy confirmation failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveAndConfirmPolicy(selection: PolicyEditorSelection, payload: PolicyConfigurationPayload) {
    const canConfigure = selection.version.reviewStatus === "PENDING_HR_LEGAL_CONFIRMATION" ? canEdit : canCreate;
    if (!canConfigure || !canApprove) return;
    const busyKey = `policy-config:${selection.version.id}`;
    setBusy(busyKey);
    setError(null);
    try {
      const configured = selection.version.reviewStatus === "PENDING_HR_LEGAL_CONFIRMATION"
        ? await request(`/leave/policies/versions/${selection.version.id}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        : await request(`/leave/policies/${selection.policyId}/versions`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
      await request(`/leave/policies/versions/${configured.id}/confirm`, { method: "POST" });
      setPolicyEditor(null);
      setAccrualRunResult(null);
      await loadTab();
      const refreshed = await request("/leave/policies");
      setPolicies(refreshed.data ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Policy configuration failed");
    } finally {
      setBusy(null);
    }
  }

  async function runCurrentAccruals() {
    if (!canApprove) return;
    if (currentPolicyIssues.length > 0) {
      setError("Configure and confirm every current leave policy before posting accruals.");
      return;
    }
    if (!window.confirm(`Post the ${format(parseISO(today), "MMMM yyyy")} accrual once for every eligible employee? Repeating the run is safe and will not post duplicates.`)) return;
    setBusy("accrual-run");
    setError(null);
    setAccrualRunResult(null);
    try {
      const result = await request("/leave/accruals/run", {
        method: "POST",
        body: JSON.stringify({ asOf: today }),
      });
      setAccrualRunResult(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Accrual posting failed");
    } finally {
      setBusy(null);
    }
  }

  const visibleTabs = tabs;

  return (
    <div className="mx-auto max-w-[1500px] animate-fade-in pb-12">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <Link href="/employees" className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm transition hover:border-neutral-300 hover:text-black" aria-label="Back to team">
            <Icon name="arrow" />
          </Link>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Team workspace</p>
            <h1 className="text-3xl font-bold tracking-tight text-neutral-950">Leave management</h1>
            <p className="mt-1 max-w-2xl text-sm text-neutral-600">Review requests, protect staffing, and keep leave balances and payroll aligned.</p>
          </div>
        </div>
        {canCreate && (
          <button onClick={() => setTab("add")} className="btn-primary inline-flex items-center justify-center gap-2 shadow-sm">
            <Icon name="plus" className="h-4 w-4" /> New leave request
          </button>
        )}
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Leave overview">
        <SummaryCard icon="inbox" label="Awaiting decision" value={summary.pending} hint="Submitted to HR" tone="amber" onClick={() => { setStatus("PENDING_HR"); setTab("queue"); }} />
        <SummaryCard icon="calendar" label="Upcoming leave" value={summary.upcoming} hint="Approved and scheduled" tone="emerald" onClick={() => setTab("calendar")} />
        <SummaryCard icon="file" label="Evidence needed" value={summary.evidence} hint="Missing verification" tone="blue" onClick={() => { setStatus("PENDING_HR"); setTab("queue"); }} />
        <SummaryCard icon="warning" label="Needs attention" value={summary.attention} hint="Cancellation or adjustment" tone="red" onClick={() => { setStatus("ADJUSTMENT_REQUIRED"); setTab("queue"); }} />
      </section>

      {currentPolicyIssues.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          <span className="mt-0.5 rounded-full bg-amber-100 p-1.5"><Icon name="warning" className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{currentPolicyIssues.length} leave policy rule{currentPolicyIssues.length === 1 ? "" : "s"} need configuration or confirmation</p>
            <p className="mt-0.5 text-xs leading-5 text-amber-800">Payroll approval remains protected until every balance-controlled policy has an executable entitlement and accrual formula.</p>
          </div>
          <button onClick={() => setTab("policies")} className="hidden shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-amber-100 sm:block">Review policies</button>
        </div>
      )}

      <nav className="mb-6 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1.5 shadow-sm" aria-label="Leave sections">
        <div className="flex min-w-max gap-1">
          {visibleTabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              aria-current={tab === item.key ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-medium transition ${tab === item.key ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"}`}
            >
              <Icon name={item.icon} className="h-4 w-4" />
              <span className="hidden lg:inline">{item.label}</span>
              <span className="lg:hidden">{item.shortLabel}</span>
              {item.key === "queue" && summary.pending > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === item.key ? "bg-white text-neutral-900" : "bg-orange-100 text-orange-700"}`}>{summary.pending}</span>}
            </button>
          ))}
        </div>
      </nav>

      {error && (
        <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
          <span className="mt-0.5 rounded-full bg-red-100 p-1"><Icon name="warning" className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">We could not complete that action</p><p className="mt-0.5 break-words text-sm text-red-700">{error}</p></div>
          <button onClick={() => setError(null)} aria-label="Dismiss error" className="rounded p-1 hover:bg-red-100"><Icon name="close" className="h-4 w-4" /></button>
        </div>
      )}

      {tab === "queue" && (
        <SectionShell title="Approval queue" description="Review one request at a time with roster, payroll, and evidence context.">
          <div className="mb-5 flex flex-col gap-3 border-b border-neutral-200 pb-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Queue status">
              {actionStatuses.map((value) => (
                <button key={value} onClick={() => setStatus(value)} className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${status === value ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"}`}>
                  {friendly(value)}
                </button>
              ))}
            </div>
            <div className="w-full xl:w-72"><EmployeeSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} allLabel="All employees" /></div>
          </div>
          {loading ? <LoadingCards /> : applications.length ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {applications.map((application) => (
                <ApprovalCard
                  key={application.id}
                  application={application}
                  busy={busy}
                  canEdit={canEdit}
                  canApprove={canApprove}
                  canExport={canExport}
                  onApprove={(app) => decide(app, "approve")}
                  onReject={(app) => { setActionReason(""); setActionDialog({ kind: "reject", application: app }); }}
                  onCancel={(app) => { setActionReason(""); setActionDialog({ kind: "cancel", application: app }); }}
                  onResolveAdjustment={() => setTab("adjustments")}
                  onReview={reviewDocument}
                  onVerify={verifyDocument}
                />
              ))}
            </div>
          ) : <EmptyState icon="inbox" title="Queue cleared" text="There are no requests matching this status and employee filter." action={canCreate ? { label: "Create a leave request", onClick: () => setTab("add") } : undefined} />}
        </SectionShell>
      )}

      {tab === "records" && (
        <SectionShell title="Leave records" description="Search the authoritative application history for this period.">
          <FilterBar range={range} setRange={setRange} onRefresh={loadTab}>
            <EmployeeSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} allLabel="All employees" />
          </FilterBar>
          {loading ? <LoadingTable /> : <ApplicationTable applications={applications} busy={busy} canEdit={canEdit} canApprove={canApprove} canExport={canExport} onCancel={(app) => { setActionReason(""); setActionDialog({ kind: "cancel", application: app }); }} onReview={reviewDocument} onVerify={verifyDocument} />}
        </SectionShell>
      )}

      {tab === "calendar" && (
        <SectionShell title="Leave calendar" description="See approved and pending leave alongside the affected team and roster hours.">
          <FilterBar range={range} setRange={setRange} onRefresh={loadTab} />
          {loading ? <LoadingCards /> : applications.length ? (
            <div className="space-y-3">
              {applications.map((app) => <CalendarRow key={app.id} application={app} />)}
            </div>
          ) : <EmptyState icon="calendar" title="No leave in this period" text="Try a wider date range or create a new leave request." />}
        </SectionShell>
      )}

      {tab === "balances" && (
        <SectionShell title="Leave balances" description="Available hours include approved ledger entries and exclude active reservations.">
          <div className="mb-5 max-w-sm"><EmployeeSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} allLabel="All employees" /></div>
          {loading ? <LoadingTable /> : balances.length ? <BalanceTable balances={balances} /> : <EmptyState icon="balance" title="No balances yet" text="Capture approved opening balances before relying on entitlement calculations." action={canCreate ? { label: "Add an opening balance", onClick: () => setTab("adjustments") } : undefined} />}
        </SectionShell>
      )}

      {tab === "add" && canCreate && (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <form onSubmit={createApplication} className="card-wireframe overflow-hidden">
            <div className="border-b border-neutral-200 px-5 py-5 sm:px-7">
              <div className="flex items-center gap-3"><span className="rounded-xl bg-orange-100 p-2 text-orange-700"><Icon name="plus" /></span><div><h2 className="text-xl font-bold">New leave request</h2><p className="text-sm text-neutral-500">Complete the details, preview the impact, then submit to HR.</p></div></div>
            </div>
            <div className="space-y-7 p-5 sm:p-7">
              <FormSection number="1" title="Employee and leave type">
                <Field label="Employee" required><GuardSearchPicker guards={employees} value={form.employeeId} onChange={(employeeId) => { setForm((old) => ({ ...old, employeeId: employeeId ?? "" })); resetPreview(); }} placeholder="Search by name or employee number" /></Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <EmployeeLeaveType types={types} value={form.leaveTypeCode} onChange={(leaveTypeCode) => { setForm((old) => ({ ...old, leaveTypeCode })); resetPreview(); }} />
                  <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs leading-5 text-neutral-600">
                    {leaveType ? <><strong className="block text-neutral-900">{friendly(leaveType.payrollTreatment)}</strong>{leaveType.description || `${friendly(leaveType.durationMode)} calculation`}</> : "Select a leave type to see its treatment."}
                  </div>
                </div>
              </FormSection>

              <FormSection number="2" title="Dates and duration">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Start date" required><DateInput value={form.startDate} onChange={(startDate) => { setForm((old) => ({ ...old, startDate, endDate: old.endDate < startDate ? startDate : old.endDate })); resetPreview(); }} className="input-modern mt-1 w-full" /></Field>
                  <Field label="End date" required><DateInput value={form.endDate} onChange={(endDate) => { setForm((old) => ({ ...old, endDate })); resetPreview(); }} className="input-modern mt-1 w-full" /></Field>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => { setForm((old) => ({ ...old, endDate: old.startDate })); resetPreview(); }} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50">Single day</button>
                  <button type="button" onClick={() => { setForm((old) => ({ ...old, endDate: format(addDays(parseISO(old.startDate), 4), "yyyy-MM-dd") })); resetPreview(); }} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50">5 calendar days</button>
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 p-4 hover:bg-neutral-50">
                  <input type="checkbox" checked={partialLeave} onChange={(event) => { setPartialLeave(event.target.checked); setForm((old) => ({ ...old, hoursPerDay: event.target.checked ? old.hoursPerDay || "4" : "" })); resetPreview(); }} className="mt-1 h-4 w-4 accent-orange-600" />
                  <span className="flex-1"><span className="block text-sm font-semibold">Partial shift or partial day</span><span className="block text-xs text-neutral-500">Use this when the employee is only unavailable for part of each scheduled shift.</span></span>
                </label>
                {partialLeave && <Field label="Hours of leave per affected shift" required><input required type="number" min="0.25" max="24" step="0.25" value={form.hoursPerDay} onChange={(event) => { setForm((old) => ({ ...old, hoursPerDay: event.target.value })); resetPreview(); }} className="input-modern mt-1" /></Field>}
              </FormSection>

              <FormSection number="3" title="Reason and evidence">
                <Field label="Reason or note" hint="Optional internal context for the approver"><textarea value={form.reason} onChange={(event) => setForm((old) => ({ ...old, reason: event.target.value }))} className="input-modern mt-1 min-h-24 resize-y" placeholder="Add any context HR should know" /></Field>
                {form.startDate < today && <Field label="Reason for retrospective capture" required hint="Required because the leave starts in the past"><textarea required value={form.retrospectiveReason} onChange={(event) => setForm((old) => ({ ...old, retrospectiveReason: event.target.value }))} className="input-modern mt-1 min-h-24 resize-y" placeholder="Explain why this request is being captured retrospectively" /></Field>}
                <Field label="Supporting evidence" hint={leaveType?.requiresDocument ? "This leave type requires verified evidence before approval." : "PDF, JPG, PNG or WebP. Optional for this leave type."}>
                  <label className="mt-1 flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-4 transition hover:border-orange-400 hover:bg-orange-50/40">
                    <span className="rounded-lg bg-white p-2 text-neutral-600 shadow-sm"><Icon name="file" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{document?.name ?? "Choose a supporting document"}</span><span className="text-xs text-neutral-500">{document ? `${Math.ceil(document.size / 1024)} KB selected` : "Browse from this device"}</span></span>
                    <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setDocument(event.target.files?.[0] ?? null)} className="sr-only" />
                  </label>
                </Field>
              </FormSection>
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-neutral-200 bg-neutral-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">
              <button type="button" onClick={() => setTab("queue")} className="btn-ghost">Cancel</button>
              <button type="button" disabled={!form.employeeId || busy === "preview"} onClick={previewApplication} className="btn-secondary inline-flex items-center justify-center gap-2"><Icon name="search" className="h-4 w-4" />{busy === "preview" ? "Calculating..." : "Preview impact"}</button>
              <button type="submit" disabled={!form.employeeId || busy === "create"} className="btn-primary inline-flex items-center justify-center gap-2"><Icon name="check" className="h-4 w-4" />{busy === "create" ? "Submitting..." : "Submit request"}</button>
            </div>
          </form>
          <aside className="card-wireframe overflow-hidden xl:sticky xl:top-5">
            <div className="border-b border-neutral-200 px-5 py-4"><h3 className="font-bold">Impact summary</h3><p className="text-xs text-neutral-500">Calculated from the employee's roster and policy.</p></div>
            {preview ? <PreviewCard preview={preview} /> : <div className="flex min-h-72 flex-col items-center justify-center px-6 py-10 text-center"><span className="mb-3 rounded-full bg-neutral-100 p-3 text-neutral-500"><Icon name="search" /></span><p className="font-semibold">Preview before submitting</p><p className="mt-1 text-sm leading-6 text-neutral-500">Select an employee and dates, then preview to check balance, paid hours, roster impact, evidence, and conflicts.</p></div>}
          </aside>
        </div>
      )}

      {tab === "adjustments" && (
        <SectionShell title="Leave adjustments" description="Resolve paid-payroll cancellation corrections and post approved balance entries with a complete audit trail.">
          <div className="space-y-8">
            <section aria-labelledby="payroll-adjustment-heading">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 id="payroll-adjustment-heading" className="font-bold text-neutral-950">External payroll correction queue</h3>
                    {!loading && pendingAdjustments.length > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">{pendingAdjustments.length}</span>}
                  </div>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">These cancellations involve leave already posted to a paid payroll. Confirm only after the correction has been completed in the external payroll system.</p>
                </div>
                <button type="button" onClick={loadTab} disabled={loading} className="btn-secondary self-start px-3 py-2 text-sm sm:self-auto">{loading ? "Refreshing..." : "Refresh queue"}</button>
              </div>
              {loading ? <LoadingCards /> : pendingAdjustments.length ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {pendingAdjustments.map((row) => (
                    <PendingAdjustmentCard
                      key={row.id}
                      adjustment={row}
                      busy={busy === `adjustment-resolution:${row.id}`}
                      onConfirm={canApprove ? () => openAdjustmentResolution(row, "confirm_external_correction") : undefined}
                      onReject={canApprove ? () => openAdjustmentResolution(row, "reject") : undefined}
                    />
                  ))}
                </div>
              ) : <EmptyState icon="check" title="No payroll corrections waiting" text="There are no unresolved paid-payroll leave adjustments." />}
            </section>

            <section className="border-t border-neutral-200 pt-8" aria-labelledby="balance-adjustment-heading">
              <div className="mb-4">
                <h3 id="balance-adjustment-heading" className="font-bold text-neutral-950">Opening balance or ledger correction</h3>
                <p className="mt-1 text-sm text-neutral-500">Post an approved balance entry without editing an employee balance directly.</p>
              </div>
              {canCreate && <form onSubmit={postAdjustment} className="max-w-2xl space-y-5 rounded-xl border border-neutral-200 bg-neutral-50 p-5">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800"><strong>Use carefully.</strong> Positive hours add balance; negative hours reduce it. Every change creates an immutable ledger entry and audit event.</div>
                <Field label="Employee" required><GuardSearchPicker guards={employees} value={adjustment.employeeId} onChange={(employeeId) => setAdjustment((old) => ({ ...old, employeeId: employeeId ?? "" }))} placeholder="Search employee" /></Field>
                <div className="grid gap-4 sm:grid-cols-2"><EmployeeLeaveType types={types} value={adjustment.leaveTypeCode} onChange={(leaveTypeCode) => setAdjustment((old) => ({ ...old, leaveTypeCode }))} /><Field label="Adjustment hours" required><input required type="number" step="0.25" value={adjustment.hours} onChange={(event) => setAdjustment((old) => ({ ...old, hours: event.target.value }))} className="input-modern mt-1" placeholder="e.g. 12 or -4" /></Field></div>
                <Field label="Reason" required hint="Include the source of the approved opening balance or correction."><textarea required value={adjustment.reason} onChange={(event) => setAdjustment((old) => ({ ...old, reason: event.target.value }))} className="input-modern mt-1 min-h-24" /></Field>
                <button disabled={busy === "adjustment" || !adjustment.employeeId} className="btn-primary">{busy === "adjustment" ? "Posting..." : "Post adjustment"}</button>
              </form>}
            </section>
          </div>
        </SectionShell>
      )}

      {tab === "policies" && (
        <SectionShell title="Leave policies" description="Effective-dated rules preserve the policy used for every historical application.">
          {canApprove && (
            <div className="mb-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-neutral-900">Monthly accrual posting</p>
                  <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-600">Posts the current month once per eligible employee and leave type. Historical entitlement must be loaded as an HR-approved opening balance; repeated runs are idempotent.</p>
                </div>
                <button type="button" onClick={runCurrentAccruals} disabled={busy === "accrual-run" || currentPolicyIssues.length > 0} className="btn-secondary shrink-0">
                  {busy === "accrual-run" ? "Posting..." : `Post ${format(parseISO(today), "MMM yyyy")} accrual`}
                </button>
              </div>
              {currentPolicyIssues.length > 0 && <p className="mt-3 text-xs font-medium text-amber-700">Accrual posting is locked until all current policy formulas are executable and confirmed.</p>}
              {accrualRunResult && <p className={`mt-3 rounded-lg border p-3 text-sm ${accrualRunResult.skipped.length ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>Posted {accrualRunResult.posted.length} new ledger entr{accrualRunResult.posted.length === 1 ? "y" : "ies"}. Skipped {accrualRunResult.skipped.length}; details are recorded in Audit history.</p>}
            </div>
          )}
          {loading ? <LoadingCards /> : policies.length ? <div className="space-y-4">{policies.map((policy) => <PolicyCard key={policy.id} policy={policy} canCreate={canCreate} canEdit={canEdit} canApprove={canApprove} busy={busy} onConfirm={confirmPolicy} onConfigure={(version) => setPolicyEditor({ policyId: policy.id, policyName: policy.name, version })} />)}</div> : <EmptyState icon="policy" title="No policies configured" text="Default policy seeds are created when this section is loaded." />}
        </SectionShell>
      )}

      {tab === "reports" && (
        <SectionShell title="Leave reports" description="Monitor liability, unpaid leave, exceptions, and activity for the selected period.">
          <FilterBar range={range} setRange={setRange} onRefresh={loadTab} />
          {loading ? <LoadingCards /> : report ? <ReportView report={report} /> : <EmptyState icon="report" title="No report available" text="Choose a valid period and refresh the report." />}
        </SectionShell>
      )}

      {tab === "audit" && (
        <SectionShell title="Audit history" description="A chronological record of leave, balance, document, and policy actions.">
          {loading ? <LoadingTable /> : audit.length ? <div className="relative ml-3 border-l border-neutral-200 pl-6">{audit.map((event) => <AuditRow key={event.id} event={event} />)}</div> : <EmptyState icon="audit" title="No audit events yet" text="Leave actions will appear here as they occur." />}
        </SectionShell>
      )}

      {actionDialog && ((actionDialog.kind === "reject" && canApprove) || (actionDialog.kind === "cancel" && canEdit)) && (
        <ActionDialog
          kind={actionDialog.kind}
          application={actionDialog.application}
          reason={actionReason}
          onReasonChange={setActionReason}
          busy={busy === actionDialog.application.id}
          onClose={() => { setActionDialog(null); setActionReason(""); }}
          onSubmit={() => actionDialog.kind === "reject" ? decide(actionDialog.application, "reject", actionReason) : cancelApplication(actionDialog.application, actionReason)}
        />
      )}

      {adjustmentDialog && canApprove && (
        <AdjustmentResolutionDialog
          adjustment={adjustmentDialog.adjustment}
          decision={adjustmentDialog.decision}
          reason={adjustmentResolution.reason}
          payrollReference={adjustmentResolution.payrollReference}
          error={error}
          busy={busy === `adjustment-resolution:${adjustmentDialog.adjustment.id}`}
          onReasonChange={(reason) => setAdjustmentResolution((old) => ({ ...old, reason }))}
          onPayrollReferenceChange={(payrollReference) => setAdjustmentResolution((old) => ({ ...old, payrollReference }))}
          onClose={closeAdjustmentResolution}
          onSubmit={resolvePendingAdjustment}
        />
      )}

      {policyEditor && canApprove && (
        <PolicyConfigurationDialog
          selection={policyEditor}
          busy={busy === `policy-config:${policyEditor.version.id}`}
          onClose={() => setPolicyEditor(null)}
          onSubmit={(payload) => saveAndConfirmPolicy(policyEditor, payload)}
        />
      )}
    </div>
  );
}

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    inbox: <><path d="M4 4h16v13H4z"/><path d="M4 13h4l2 3h4l2-3h4"/></>,
    records: <><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    balance: <><path d="M3 7h18v12H3z"/><path d="M16 12h3M7 7V5h10v2"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    adjust: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></>,
    policy: <><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4M9 12h6M9 16h5"/></>,
    report: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    audit: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="m15 18-6-6 6-6"/>,
    warning: <><path d="M12 3 2.5 20h19z"/><path d="M12 9v4M12 17h.01"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    file: <><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2-6 6-6s6 2 6 6M16 5a3 3 0 0 1 0 6M17 14c3 .5 4 2.5 4 6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    close: <path d="M6 6l12 12M18 6 6 18"/>,
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function SummaryCard({ icon, label, value, hint, tone, onClick }: { icon: IconName; label: string; value: number; hint: string; tone: "amber" | "emerald" | "blue" | "red"; onClick: () => void }) {
  const toneClass = { amber: "bg-amber-50 text-amber-700", emerald: "bg-emerald-50 text-emerald-700", blue: "bg-blue-50 text-blue-700", red: "bg-red-50 text-red-700" }[tone];
  return <button onClick={onClick} className="group flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md"><span className={`rounded-xl p-2.5 ${toneClass}`}><Icon name={icon} /></span><span className="min-w-0 flex-1"><span className="block text-2xl font-bold text-neutral-950">{value}</span><span className="block text-sm font-semibold text-neutral-800">{label}</span><span className="block truncate text-xs text-neutral-500">{hint}</span></span><span className="text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-700"><Icon name="arrow" className="h-4 w-4 rotate-180" /></span></button>;
}

function SectionShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="card-wireframe overflow-hidden"><div className="border-b border-neutral-200 px-5 py-5 sm:px-6"><h2 className="text-lg font-bold text-neutral-950">{title}</h2><p className="mt-1 text-sm text-neutral-500">{description}</p></div><div className="p-4 sm:p-6">{children}</div></section>;
}

function Status({ value }: { value: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(value)}`}>{friendly(value)}</span>;
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="text-sm font-semibold text-neutral-800">{label}{required && <span className="ml-1 text-red-600">*</span>}</span>{hint && <span className="ml-2 text-xs font-normal text-neutral-500">{hint}</span>}{children}</label>;
}

function FormSection({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <section><div className="mb-4 flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white">{number}</span><h3 className="font-bold text-neutral-900">{title}</h3></div><div className="space-y-4 sm:pl-10">{children}</div></section>;
}

function FilterBar({ range, setRange, onRefresh, children }: { range: { start: string; end: string }; setRange: React.Dispatch<React.SetStateAction<{ start: string; end: string }>>; onRefresh: () => void; children?: React.ReactNode }) {
  return <div className="mb-5 flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 lg:flex-row lg:items-end"><div className="min-w-52 flex-1">{children}</div><div className="grid grid-cols-2 gap-2"><Field label="From"><DateInput value={range.start} onChange={(start) => setRange((old) => ({ ...old, start }))} className="input-modern mt-1" /></Field><Field label="To"><DateInput value={range.end} onChange={(end) => setRange((old) => ({ ...old, end }))} className="input-modern mt-1" /></Field></div><button className="btn-secondary h-[46px] shrink-0" onClick={onRefresh}>Refresh</button></div>;
}

function EmployeeSelect({ value, onChange, employees, allLabel }: { value: string; onChange: (value: string) => void; employees: GuardPickerOption[]; allLabel: string }) {
  return <label className="relative block"><span className="sr-only">Employee filter</span><select value={value} onChange={(event) => onChange(event.target.value)} className="input-modern pr-10"><option value="">{allLabel}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} ({employee.employeeNumber})</option>)}</select></label>;
}

function EmployeeLeaveType({ types, value, onChange }: { types: LeaveType[]; value: string; onChange: (value: string) => void }) {
  return <Field label="Leave type" required><select value={value} onChange={(event) => onChange(event.target.value)} className="input-modern mt-1">{types.map((type) => <option key={type.id} value={type.code}>{type.name}</option>)}</select></Field>;
}

function DocumentReviewActions({ leaveDocument, busy, canExport, canApprove, onReview, onVerify }: { leaveDocument: LeaveDocument; busy: string | null; canExport: boolean; canApprove: boolean; onReview: (leaveDocument: LeaveDocument) => void; onVerify: (id: string) => void }) {
  const isBusy = busy === leaveDocument.id;
  return <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5" title={`${leaveDocument.fileName} - ${leaveDocument.mimeType} - ${fileSizeLabel(leaveDocument.fileSize)}`}>
    <Status value={leaveDocument.reviewStatus} />
    <span className="max-w-40 truncate text-neutral-600">{leaveDocument.fileName}</span>
    {canExport && <button type="button" onClick={() => onReview(leaveDocument)} disabled={isBusy} className="font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 disabled:opacity-50">{isBusy ? "Opening..." : "Review file"}</button>}
    {canApprove && leaveDocument.reviewStatus === "PENDING_REVIEW" && <button type="button" onClick={() => onVerify(leaveDocument.id)} disabled={isBusy} className="font-semibold text-emerald-700 underline decoration-emerald-300 underline-offset-2 disabled:opacity-50">Verify</button>}
  </span>;
}

function ApprovalCard({ application: app, busy, canEdit, canApprove, canExport, onApprove, onReject, onCancel, onResolveAdjustment, onReview, onVerify }: { application: LeaveApplication; busy: string | null; canEdit: boolean; canApprove: boolean; canExport: boolean; onApprove: (app: LeaveApplication) => void; onReject: (app: LeaveApplication) => void; onCancel: (app: LeaveApplication) => void; onResolveAdjustment: () => void; onReview: (leaveDocument: LeaveDocument) => void; onVerify: (id: string) => void }) {
  const canDecide = pendingStatuses.includes(app.status);
  const canCancel = ["DRAFT", "SUBMITTED", "PENDING_HR", "APPROVED", "IMPORTED_APPROVED", "PAYROLL_PROCESSED", "CANCELLATION_REQUESTED"].includes(app.status);
  const needsAdjustment = app.status === "ADJUSTMENT_REQUIRED";
  const verified = app.documents.some((document) => document.reviewStatus === "VERIFIED");
  return <article className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:border-neutral-300 hover:shadow-md">
    <div className="p-5">
      <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white">{initials(app.employee)}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-neutral-950">{employeeName(app.employee)}</h3><p className="text-xs text-neutral-500">{app.employee.employeeNumber} {app.employee.group?.name ? `- ${app.employee.group.name}` : ""}</p></div><Status value={app.status} /></div></div></div>
      <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-neutral-50 p-4 sm:grid-cols-4"><CardFact label="Period" value={period(app.startDate, app.endDate)} /><CardFact label="Leave type" value={app.leaveType.name} /><CardFact label="Duration" value={hours(app.calculatedMinutes)} /><CardFact label="Payroll" value={app.unpaidMinutes > 0 ? `${hours(app.unpaidMinutes)} unpaid` : friendly(app.leaveType.payrollTreatment)} danger={app.unpaidMinutes > 0} /></div>
      {app.reason && <p className="mt-4 rounded-lg border-l-2 border-neutral-300 bg-neutral-50 px-3 py-2 text-sm italic text-neutral-600">{app.reason}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs"><span className="text-neutral-500">Evidence:</span>{app.documents.length ? app.documents.map((doc) => <DocumentReviewActions key={doc.id} leaveDocument={doc} busy={busy} canExport={canExport} canApprove={canApprove} onReview={onReview} onVerify={onVerify} />) : <span className={app.leaveType.requiresDocument ? "font-semibold text-red-600" : "text-neutral-500"}>{app.leaveType.requiresDocument ? "Required - not uploaded" : "Not required"}</span>}{verified && <span className="inline-flex items-center gap-1 text-emerald-700"><Icon name="check" className="h-3.5 w-3.5" /> Ready</span>}</div>
    </div>
    {((canEdit && canCancel) || (canApprove && (canDecide || needsAdjustment))) && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 bg-neutral-50 px-5 py-3">{canEdit && canCancel && <button onClick={() => onCancel(app)} disabled={busy === app.id} className="btn-ghost px-3 py-2 text-sm">{app.status === "CANCELLATION_REQUESTED" ? "Approve cancellation" : ["APPROVED", "IMPORTED_APPROVED", "PAYROLL_PROCESSED"].includes(app.status) ? "Cancel leave" : "Withdraw"}</button>}{canApprove && needsAdjustment && <button type="button" onClick={onResolveAdjustment} className="btn-primary px-3 py-2 text-sm">Resolve payroll correction</button>}{canApprove && canDecide && <><button onClick={() => onReject(app)} disabled={busy === app.id} className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50">Reject</button><button onClick={() => onApprove(app)} disabled={busy === app.id} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"><Icon name="check" className="h-4 w-4" />{busy === app.id ? "Working..." : "Approve"}</button></>}</div>}
  </article>;
}

function CardFact({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p><p className={`mt-1 text-sm font-semibold ${danger ? "text-red-700" : "text-neutral-900"}`}>{value}</p></div>;
}

function ApplicationTable({ applications, busy, canEdit, canApprove, canExport, onCancel, onReview, onVerify }: { applications: LeaveApplication[]; busy: string | null; canEdit: boolean; canApprove: boolean; canExport: boolean; onCancel: (app: LeaveApplication) => void; onReview: (leaveDocument: LeaveDocument) => void; onVerify: (id: string) => void }) {
  if (!applications.length) return <EmptyState icon="records" title="No records found" text="No leave applications match the selected employee and date range." />;
  return <div className="overflow-hidden rounded-xl border border-neutral-200"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500"><tr><Th>Employee</Th><Th>Dates</Th><Th>Leave</Th><Th>Duration</Th><Th>Evidence</Th><Th>Status</Th>{canEdit && <Th><span className="sr-only">Actions</span></Th>}</tr></thead><tbody className="divide-y divide-neutral-200">{applications.map((app) => <tr key={app.id} className="bg-white align-top hover:bg-neutral-50"><Td><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-bold">{initials(app.employee)}</span><div><strong className="block text-neutral-900">{employeeName(app.employee)}</strong><span className="text-xs text-neutral-500">{app.employee.employeeNumber}</span></div></div></Td><Td><strong className="font-medium">{period(app.startDate, app.endDate)}</strong><span className="mt-1 block text-xs text-neutral-500">Created {dateLabel(app.createdAt)}</span></Td><Td>{app.leaveType.name}<span className="mt-1 block text-xs text-neutral-500">{friendly(app.leaveType.payrollTreatment)}</span></Td><Td><strong>{hours(app.calculatedMinutes)}</strong>{app.unpaidMinutes > 0 && <span className="mt-1 block text-xs font-semibold text-red-600">{hours(app.unpaidMinutes)} unpaid</span>}</Td><Td>{app.documents.length ? app.documents.map((doc) => <div className="mb-1 flex items-center gap-1 text-xs" key={doc.id}><DocumentReviewActions leaveDocument={doc} busy={busy} canExport={canExport} canApprove={canApprove} onReview={onReview} onVerify={onVerify} /></div>) : <span className={app.leaveType.requiresDocument ? "font-semibold text-red-600" : "text-neutral-400"}>{app.leaveType.requiresDocument ? "Missing" : "None"}</span>}</Td><Td><Status value={app.status} />{app.decisionReason && <span className="mt-1 block max-w-52 text-xs text-neutral-500">{app.decisionReason}</span>}</Td>{canEdit && <Td><button onClick={() => onCancel(app)} disabled={busy === app.id || !["DRAFT", "SUBMITTED", "PENDING_HR", "APPROVED", "IMPORTED_APPROVED", "PAYROLL_PROCESSED", "CANCELLATION_REQUESTED"].includes(app.status)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 disabled:hidden">{app.status === "CANCELLATION_REQUESTED" ? "Approve cancellation" : "Cancel"}</button></Td>}</tr>)}</tbody></table></div></div>;
}

function Th({ children }: { children: React.ReactNode }) { return <th className="px-4 py-3 text-left font-semibold">{children}</th>; }
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <td className={`px-4 py-3.5 ${className}`}>{children}</td>; }

function BalanceTable({ balances }: { balances: Balance[] }) {
  return <div className="overflow-hidden rounded-xl border border-neutral-200"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500"><tr><Th>Employee</Th><Th>Leave type</Th><Th>Accrued / opening</Th><Th>Reserved</Th><Th>Taken</Th><Th>Adjustments</Th><Th>Available</Th></tr></thead><tbody className="divide-y divide-neutral-200">{balances.map((row) => <tr key={`${row.employeeId}-${row.leaveTypeId}`} className="bg-white hover:bg-neutral-50"><Td><strong>{employeeName(row.employee)}</strong><span className="block text-xs text-neutral-500">{row.employee?.employeeNumber}</span></Td><Td>{row.leaveType?.name ?? "Leave"}</Td><Td>{hours(row.accrued)}</Td><Td className="text-amber-700">{hours(row.reserved)}</Td><Td>{hours(row.taken)}</Td><Td>{hours(row.adjustments)}</Td><Td><span className={`inline-flex min-w-16 justify-center rounded-lg px-2.5 py-1.5 font-bold ${row.available < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{hours(row.available)}</span></Td></tr>)}</tbody></table></div></div>;
}

function CalendarRow({ application: app }: { application: LeaveApplication }) {
  const occurrenceCount = leaveOccurrenceCount(app);
  return <article className="grid items-center gap-4 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-[84px_minmax(0,1fr)_auto]"><div className="rounded-xl bg-neutral-950 px-3 py-2 text-center text-white"><span className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-300">{dateLabel(app.startDate, "MMM")}</span><span className="block text-2xl font-bold leading-none">{dateLabel(app.startDate, "d")}</span>{app.startDate.slice(0, 10) !== app.endDate.slice(0, 10) && <span className="mt-1 block text-[10px]">to {dateLabel(app.endDate, "d MMM")}</span>}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{employeeName(app.employee)}</h3><Status value={app.status} /></div><p className="mt-1 text-sm text-neutral-600">{app.leaveType.name} - {hours(app.calculatedMinutes)}</p><p className="text-xs text-neutral-500">{app.employee.group?.name ?? "No team assigned"} - {friendly(app.leaveType.payrollTreatment)}</p></div><div className="hidden text-right sm:block"><p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Roster impact</p><p className="mt-1 font-bold">{occurrenceCount} shift{occurrenceCount === 1 ? "" : "s"}</p></div></article>;
}

function PreviewCard({ preview }: { preview: LeavePreview }) {
  return <div className="p-5"><div className="grid grid-cols-2 gap-3"><PreviewMetric label="Calculated" value={hours(preview.calculatedMinutes)} /><PreviewMetric label="Paid" value={hours(preview.paidMinutes)} tone="success" /><PreviewMetric label="Unpaid" value={hours(preview.unpaidMinutes)} tone={preview.unpaidMinutes > 0 ? "danger" : "default"} /><PreviewMetric label="Roster shifts" value={String(preview.staffingImpact.shiftsAffected)} /></div><div className="my-5 h-px bg-neutral-200"/><div className="space-y-4 text-sm"><div><p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Balance after request</p><div className="mt-2 flex items-center gap-2"><span className="rounded-lg bg-neutral-100 px-2.5 py-1.5 font-semibold">{hours(preview.balanceImpact.currentMinutes)}</span><Icon name="arrow" className="h-4 w-4 rotate-180 text-neutral-400"/><span className={`rounded-lg px-2.5 py-1.5 font-bold ${preview.balanceImpact.projectedMinutes < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{hours(preview.balanceImpact.projectedMinutes)}</span></div></div><ImpactCheck ok={preview.policyConfirmed} text={preview.policyConfirmed ? "Policy version confirmed" : "Policy awaiting HR/legal confirmation"} /><ImpactCheck ok={!preview.documentRequired} text={preview.documentRequired ? "Verified evidence required" : "No mandatory evidence"} /><ImpactCheck ok={!preview.conflicts.length} text={preview.conflicts.length ? `${preview.conflicts.length} overlapping application(s)` : "No leave conflicts"} /></div>{preview.warnings.length > 0 && <div className="mt-5 space-y-2">{preview.warnings.map((warning) => <p key={warning} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-5 text-amber-800">{warning}</p>)}</div>}</div>;
}

function PreviewMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "danger" }) {
  const toneClass = tone === "success" ? "text-emerald-700" : tone === "danger" ? "text-red-700" : "text-neutral-950";
  return <div className="rounded-xl bg-neutral-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p><p className={`mt-1 text-xl font-bold ${toneClass}`}>{value}</p></div>;
}

function ImpactCheck({ ok, text }: { ok: boolean; text: string }) { return <div className={`flex items-center gap-2 ${ok ? "text-emerald-700" : "text-amber-700"}`}><span className={`rounded-full p-1 ${ok ? "bg-emerald-50" : "bg-amber-50"}`}><Icon name={ok ? "check" : "warning"} className="h-3.5 w-3.5"/></span><span>{text}</span></div>; }

function PolicyCard({ policy, canCreate, canEdit, canApprove, busy, onConfirm, onConfigure }: { policy: Policy; canCreate: boolean; canEdit: boolean; canApprove: boolean; busy: string | null; onConfirm: (id: string) => void; onConfigure: (version: PolicyVersion) => void }) {
  return (
    <article className="rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-5 py-4"><h3 className="font-bold">{policy.name}</h3><p className="mt-1 text-sm text-neutral-500">{policy.description}</p></div>
      <div className="divide-y divide-neutral-200">
        {policy.versions.map((version) => {
          const configuring = busy === `policy-config:${version.id}`;
          const canConfigure = canApprove && (
            version.reviewStatus === "PENDING_HR_LEGAL_CONFIRMATION" ? canEdit : canCreate
          );
          return (
            <div key={version.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><strong>{version.leaveType.name}</strong><Status value={version.reviewStatus} />{!version.configurationReady && <Status value="CONFIGURATION_REQUIRED" />}</div>
                <p className="mt-1 text-xs text-neutral-500">Version {version.version} · effective {dateLabel(version.effectiveFrom)}{version.effectiveTo ? ` to ${dateLabel(version.effectiveTo)}` : " onward"} · {version.sourceAuthority}</p>
                <p className="mt-1 text-xs text-neutral-600">{friendly(version.accrualMethod)}{version.entitlementMinutes ? ` · ${hours(version.entitlementMinutes)} per ${version.cycleMonths}-month cycle` : ""}{version.accrualRateMinutes ? ` · ${hours(Number(version.accrualRateMinutes))} monthly` : ""}</p>
                {version.legalReference && <p className="mt-1 text-xs text-neutral-500">{version.legalReference}</p>}
                {version.configurationIssues.length > 0 && <ul className="mt-2 space-y-1 text-xs text-red-700">{version.configurationIssues.map((issue) => <li key={issue}>• {issue}</li>)}</ul>}
              </div>
              {(canConfigure || canApprove) && (
                <div className="flex shrink-0 gap-2">
                  {!version.configurationReady && canConfigure ? <button disabled={configuring} onClick={() => onConfigure(version)} className="btn-secondary px-3 py-2 text-sm">{configuring ? "Saving..." : "Configure rules"}</button>
                    : version.reviewStatus === "PENDING_HR_LEGAL_CONFIRMATION" && canApprove ? <button disabled={busy === version.id} onClick={() => onConfirm(version.id)} className="btn-secondary px-3 py-2 text-sm">{busy === version.id ? "Confirming..." : "Confirm after review"}</button>
                    : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function PolicyConfigurationDialog({ selection, busy, onClose, onSubmit }: { selection: PolicyEditorSelection; busy: boolean; onClose: () => void; onSubmit: (payload: PolicyConfigurationPayload) => void }) {
  const { version } = selection;
  const requiresBalance = version.leaveType.requiresBalance;
  const supportedMethod = ["EVEN_MONTHLY", "MONTHLY_FIXED", "ANNUAL_GRANT"].includes(version.accrualMethod) ? version.accrualMethod : "EVEN_MONTHLY";
  const [effectiveFrom, setEffectiveFrom] = useState(version.reviewStatus === "ACTIVE" ? today : version.effectiveFrom.slice(0, 10));
  const [sourceAuthority, setSourceAuthority] = useState(version.sourceAuthority);
  const [legalReference, setLegalReference] = useState(version.legalReference ?? "");
  const [accrualMethod, setAccrualMethod] = useState(requiresBalance ? supportedMethod : "NONE");
  const [entitlementHours, setEntitlementHours] = useState(version.entitlementMinutes ? String(version.entitlementMinutes / 60) : "");
  const [monthlyHours, setMonthlyHours] = useState(version.accrualRateMinutes ? String(Number(version.accrualRateMinutes) / 60) : "");
  const [cycleMonths, setCycleMonths] = useState(String(version.cycleMonths || 12));
  const [maxConsecutiveDays, setMaxConsecutiveDays] = useState(version.maxConsecutiveDays != null ? String(version.maxConsecutiveDays) : "");
  const [negativeBalanceAllowed, setNegativeBalanceAllowed] = useState(version.negativeBalanceAllowed);
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const cycle = Number(cycleMonths);
    const entitlement = Number(entitlementHours);
    const monthly = Number(monthlyHours);
    if (!sourceAuthority.trim()) return setLocalError("Enter the policy authority or approved company policy name.");
    if (requiresBalance && (!Number.isInteger(cycle) || cycle <= 0)) return setLocalError("Enter a positive whole-number cycle length.");
    if (requiresBalance && accrualMethod === "MONTHLY_FIXED" && (!Number.isFinite(monthly) || monthly <= 0)) return setLocalError("Enter a positive monthly accrual in hours.");
    if (requiresBalance && accrualMethod !== "MONTHLY_FIXED" && (!Number.isFinite(entitlement) || entitlement <= 0)) return setLocalError("Enter a positive entitlement in hours for the cycle.");
    setLocalError(null);
    onSubmit({
      leaveTypeCode: version.leaveType.code,
      effectiveFrom,
      sourceAuthority: sourceAuthority.trim(),
      legalReference: legalReference.trim() || undefined,
      entitlementMinutes: requiresBalance && accrualMethod !== "MONTHLY_FIXED" ? Math.round(entitlement * 60) : undefined,
      accrualMethod,
      accrualRateMinutes: requiresBalance && accrualMethod === "MONTHLY_FIXED" ? Math.round(monthly * 60) : undefined,
      cycleMonths: requiresBalance ? cycle : 0,
      carryOverLimitMinutes: null,
      expiryMonths: null,
      noticeDays: null,
      maxConsecutiveDays: maxConsecutiveDays ? Number(maxConsecutiveDays) : undefined,
      negativeBalanceAllowed,
      autoConvertToUnpaid: false,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="policy-config-title">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-200 bg-white shadow-2xl">
        <div className="border-b border-neutral-200 p-5"><h2 id="policy-config-title" className="text-lg font-bold">Configure and confirm {version.leaveType.name}</h2><p className="mt-1 text-sm text-neutral-500">{selection.policyName}. Confirm only values approved by HR or labour counsel.</p></div>
        <div className="space-y-5 p-5">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">This rule affects employee balances and payroll. Saving creates or updates an effective-dated version and confirms it in one audited action.</div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Effective from" required><DateInput value={effectiveFrom} onChange={setEffectiveFrom} className="input-modern mt-1 w-full" /></Field><Field label="Cycle length (months)" required={requiresBalance}><input disabled={!requiresBalance} required={requiresBalance} type="number" min="1" max="120" step="1" value={cycleMonths} onChange={(event) => setCycleMonths(event.target.value)} className="input-modern mt-1" /></Field></div>
          <Field label="Authority or approved policy" required><input required maxLength={250} value={sourceAuthority} onChange={(event) => setSourceAuthority(event.target.value)} className="input-modern mt-1" /></Field>
          <Field label="Legal or policy reference"><input maxLength={1000} value={legalReference} onChange={(event) => setLegalReference(event.target.value)} className="input-modern mt-1" /></Field>
          {requiresBalance ? <>
            <Field label="Accrual method" required><select value={accrualMethod} onChange={(event) => setAccrualMethod(event.target.value)} className="input-modern mt-1"><option value="EVEN_MONTHLY">Even monthly from cycle entitlement</option><option value="MONTHLY_FIXED">Fixed monthly hours</option><option value="ANNUAL_GRANT">Grant at employment-cycle anniversary</option></select></Field>
            {accrualMethod === "MONTHLY_FIXED" ? <Field label="Monthly accrual hours" required><input required type="number" min="0.01" step="0.01" value={monthlyHours} onChange={(event) => setMonthlyHours(event.target.value)} className="input-modern mt-1" /></Field> : <Field label="Entitlement hours per cycle" required><input required type="number" min="0.01" step="0.01" value={entitlementHours} onChange={(event) => setEntitlementHours(event.target.value)} className="input-modern mt-1" /></Field>}
            <Field label="Maximum consecutive days"><input type="number" min="1" step="1" value={maxConsecutiveDays} onChange={(event) => setMaxConsecutiveDays(event.target.value)} className="input-modern mt-1" /></Field>
            <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs leading-5 text-neutral-600">Carry-over and balance expiry are not silently automated. When the approved policy requires either, HR must post the cycle-close change as an audited balance adjustment.</p>
            <label className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3"><input type="checkbox" checked={negativeBalanceAllowed} onChange={(event) => setNegativeBalanceAllowed(event.target.checked)} className="mt-1 h-4 w-4 accent-orange-600" /><span><span className="block text-sm font-semibold">Allow a negative balance</span><span className="text-xs text-neutral-500">Leave approvals are blocked when insufficient unless this is explicitly enabled.</span></span></label>
          </> : <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">This leave type does not consume an entitlement balance. Its accrual method will be set to None.</p>}
          {localError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{localError}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-200 bg-neutral-50 p-4"><button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button><button type="submit" disabled={busy} className="btn-primary">{busy ? "Saving..." : "Save and confirm policy"}</button></div>
      </form>
    </div>
  );
}

function ReportView({ report }: { report: LeaveReport }) {
  return <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><ReportMetric label="Applications" value={String(report.total ?? 0)} /><ReportMetric label="Pending" value={String(report.pending ?? 0)} tone="amber" /><ReportMetric label="Approved" value={String(report.approved ?? 0)} tone="emerald" /><ReportMetric label="Payroll posted" value={String(report.payrollProcessed ?? 0)} /><ReportMetric label="Leave liability" value={money(report.liabilityEstimate)} tone="blue" /></div><div className="grid gap-5 xl:grid-cols-2"><BreakdownTable title="By leave type" rows={report.byType} /><BreakdownTable title="By team" rows={report.byTeam} /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SmallMetric label="Negative balances" value={report.negativeBalances?.length ?? 0} danger /><SmallMetric label="High balances" value={report.highBalances?.length ?? 0} /><SmallMetric label="Unpaid applications" value={report.unpaid?.length ?? 0} /><SmallMetric label="Retrospective changes" value={report.retrospective?.length ?? 0} /></div></div>;
}

function ReportMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "amber" | "emerald" | "blue" }) { const color = { default: "text-neutral-950", amber: "text-amber-700", emerald: "text-emerald-700", blue: "text-blue-700" }[tone]; return <div className="rounded-xl border border-neutral-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</p><p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p></div>; }
function SmallMetric({ label, value, danger }: { label: string; value: number; danger?: boolean }) { return <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 p-4"><span className="text-sm text-neutral-600">{label}</span><strong className={danger && value > 0 ? "text-red-700" : "text-neutral-950"}>{value}</strong></div>; }

function BreakdownTable({ title, rows }: { title: string; rows: ReportBreakdown }) {
  const entries = Object.entries(rows ?? {});
  return <div className="overflow-hidden rounded-xl border border-neutral-200"><div className="border-b border-neutral-200 bg-neutral-50 px-4 py-3"><h3 className="font-bold">{title}</h3></div>{entries.length ? <div className="divide-y divide-neutral-200">{entries.map(([name, row]) => <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-sm"><span className="truncate font-semibold">{friendly(name)}</span><span className="text-neutral-500">{row.applications} request{row.applications === 1 ? "" : "s"}</span><span className={row.unpaidMinutes > 0 ? "font-semibold text-red-700" : "text-neutral-500"}>{row.unpaidMinutes > 0 ? `${hours(row.unpaidMinutes)} unpaid` : `${hours(row.paidMinutes)} paid`}</span></div>)}</div> : <p className="p-6 text-center text-sm text-neutral-500">No activity in this period.</p>}</div>;
}

function AuditRow({ event }: { event: AuditEvent }) { return <article className="relative pb-6"><span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-neutral-400 ring-1 ring-neutral-300"/><div className="flex flex-col justify-between gap-2 sm:flex-row"><div><h3 className="text-sm font-bold">{friendly(event.eventType)}</h3><p className="mt-1 text-sm text-neutral-500">{event.employee ? `${event.employee.firstName} ${event.employee.lastName}` : "Company policy"}{event.reason ? ` - ${event.reason}` : ""}</p></div><div className="shrink-0 text-xs text-neutral-500 sm:text-right"><p>{dateLabel(event.occurredAt, "d MMM yyyy, HH:mm")}</p><p>{event.user?.name ?? "System"}</p></div></div></article>; }

function PendingAdjustmentCard({ adjustment, busy, onConfirm, onReject }: { adjustment: LeaveAdjustment; busy: boolean; onConfirm?: () => void; onReject?: () => void }) {
  const app = adjustment.application;
  return (
    <article className="overflow-hidden rounded-xl border border-red-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-red-100 bg-red-50/70 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-700">{initials(adjustment.employee)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h4 className="font-bold text-neutral-950">{employeeName(adjustment.employee)}</h4><Status value={adjustment.status} /></div>
          <p className="mt-0.5 text-xs text-neutral-600">{adjustment.employee.employeeNumber} · {adjustment.leaveType.name}</p>
        </div>
        <span className="shrink-0 text-lg font-bold text-red-700">{hours(adjustment.minutes)}</span>
      </div>
      <div className="space-y-4 p-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Leave period</dt><dd className="mt-1 font-semibold text-neutral-900">{app ? period(app.startDate, app.endDate) : "Linked leave unavailable"}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Requested</dt><dd className="mt-1 text-neutral-700">{dateLabel(adjustment.createdAt, "d MMM yyyy, HH:mm")}{adjustment.requestedBy?.name ? ` by ${adjustment.requestedBy.name}` : ""}</dd></div>
        </dl>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Cancellation reason</p>
          <p className="mt-1 text-sm leading-6 text-neutral-700">{adjustment.reason}</p>
        </div>
      </div>
      {(onConfirm || onReject) && <div className="flex flex-col-reverse gap-2 border-t border-neutral-200 bg-neutral-50 p-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={onReject} disabled={busy || !app} className="btn-secondary">Reject correction</button>
        <button type="button" onClick={onConfirm} disabled={busy || !app} className="btn-primary">{busy ? "Saving..." : "Confirm external correction"}</button>
      </div>}
    </article>
  );
}

function AdjustmentResolutionDialog({ adjustment, decision, reason, payrollReference, error, busy, onReasonChange, onPayrollReferenceChange, onClose, onSubmit }: {
  adjustment: LeaveAdjustment;
  decision: LeaveAdjustmentResolutionDecision;
  reason: string;
  payrollReference: string;
  error: string | null;
  busy: boolean;
  onReasonChange: (value: string) => void;
  onPayrollReferenceChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const confirmsCorrection = decision === "confirm_external_correction";
  const prepared = prepareLeaveAdjustmentResolution({ decision, reason, payrollReference });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="adjustment-resolution-title" aria-describedby="adjustment-resolution-description">
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className="w-full max-w-lg overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-neutral-200 p-5">
          <span className={`rounded-xl p-2 ${confirmsCorrection ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}><Icon name={confirmsCorrection ? "warning" : "close"} /></span>
          <div>
            <h2 id="adjustment-resolution-title" className="text-lg font-bold">{confirmsCorrection ? "Confirm external payroll correction" : "Reject payroll correction"}</h2>
            <p className="mt-1 text-sm text-neutral-500">{employeeName(adjustment.employee)} · {adjustment.application ? period(adjustment.application.startDate, adjustment.application.endDate) : adjustment.leaveType.name}</p>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <div id="adjustment-resolution-description" className={`rounded-lg border p-3 text-sm leading-6 ${confirmsCorrection ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-200 bg-blue-50 text-blue-900"}`}>
            {confirmsCorrection
              ? "This does not change the external payroll. Confirm only after that correction is complete; Plethora will record the reference, reverse its internal leave and payroll postings, and cancel the leave."
              : "Rejecting this correction restores the leave application to its prior final status. It does not cancel the leave or change payroll."}
          </div>
          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          {confirmsCorrection && (
            <Field label="External payroll reference" required hint="Use the correction, case, or transaction identifier.">
              <input autoFocus required maxLength={250} autoComplete="off" value={payrollReference} onChange={(event) => onPayrollReferenceChange(event.target.value)} className="input-modern mt-2" placeholder="e.g. PAY-CORR-2026-071" />
            </Field>
          )}
          <Field label={confirmsCorrection ? "Resolution note" : "Reason for rejection"} required hint="This is recorded in the leave audit history.">
            <textarea autoFocus={!confirmsCorrection} required maxLength={2000} value={reason} onChange={(event) => onReasonChange(event.target.value)} className="input-modern mt-2 min-h-28 resize-y" placeholder={confirmsCorrection ? "Describe the completed payroll correction" : "Explain why this correction request should not proceed"} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-200 bg-neutral-50 p-4">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Keep pending</button>
          <button type="submit" disabled={busy || !prepared.valid} className={confirmsCorrection ? "btn-primary" : "btn-destructive"}>{busy ? "Saving..." : confirmsCorrection ? "Confirm completed correction" : "Reject correction"}</button>
        </div>
      </form>
    </div>
  );
}

function ActionDialog({ kind, application, reason, onReasonChange, busy, onClose, onSubmit }: { kind: "reject" | "cancel"; application: LeaveApplication; reason: string; onReasonChange: (value: string) => void; busy: boolean; onClose: () => void; onSubmit: () => void }) {
  const isReject = kind === "reject";
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="leave-action-title"><div className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl"><div className="flex items-start gap-3 border-b border-neutral-200 p-5"><span className={`rounded-xl p-2 ${isReject ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}><Icon name={isReject ? "close" : "warning"} /></span><div><h2 id="leave-action-title" className="text-lg font-bold">{isReject ? "Reject leave request" : "Cancel or withdraw leave"}</h2><p className="mt-1 text-sm text-neutral-500">{employeeName(application.employee)} - {period(application.startDate, application.endDate)}</p></div></div><div className="p-5"><Field label={isReject ? "Reason for rejection" : "Reason for cancellation"} required hint="This will be recorded in the audit history."><textarea autoFocus value={reason} onChange={(event) => onReasonChange(event.target.value)} className="input-modern mt-2 min-h-28 resize-y" placeholder={isReject ? "Explain what the applicant needs to correct" : "Explain why this leave is being cancelled or withdrawn"} /></Field></div><div className="flex justify-end gap-2 border-t border-neutral-200 bg-neutral-50 p-4"><button onClick={onClose} disabled={busy} className="btn-ghost">Keep request</button><button onClick={onSubmit} disabled={busy || !reason.trim()} className={isReject ? "btn-destructive" : "btn-primary"}>{busy ? "Saving..." : isReject ? "Reject request" : "Confirm cancellation"}</button></div></div></div>;
}

function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text: string; action?: { label: string; onClick: () => void } }) { return <div className="flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50/70 px-6 py-10 text-center"><span className="mb-3 rounded-full bg-white p-3 text-neutral-500 shadow-sm"><Icon name={icon} /></span><h3 className="font-bold text-neutral-900">{title}</h3><p className="mt-1 max-w-md text-sm leading-6 text-neutral-500">{text}</p>{action && <button onClick={action.onClick} className="btn-secondary mt-4 px-4 py-2 text-sm">{action.label}</button>}</div>; }
function LoadingCards() { return <div className="grid gap-4 xl:grid-cols-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-52 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />)}</div>; }
function LoadingTable() { return <div className="space-y-2 rounded-xl border border-neutral-200 p-4">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="h-12 animate-pulse rounded-lg bg-neutral-100" />)}</div>; }
