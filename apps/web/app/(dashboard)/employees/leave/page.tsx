"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { fetchEmployeePickerOptions, type GuardPickerOption } from "@/lib/roster-api";
import { DateInput } from "@/components/date-input";
import { GuardSearchPicker } from "@/components/guard-search-picker";
import { hasCapability } from "@/lib/permissions";

type Tab = "queue" | "approved" | "records" | "balances" | "calendar" | "adjustments" | "audit" | "add";
type IconName = "inbox" | "records" | "balance" | "calendar" | "adjust" | "audit" | "plus" | "arrow" | "warning" | "check" | "file" | "search" | "close";
type LeaveTypeCode = "ANNUAL" | "SICK" | "FAMILY_RESPONSIBILITY" | "PARENTAL" | "STUDY";
type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
type FamilyResponsibilityReason =
  | "CHILD_BIRTH"
  | "CHILD_SICK"
  | "SPOUSE_OR_LIFE_PARTNER_DEATH"
  | "PARENT_DEATH"
  | "ADOPTIVE_PARENT_DEATH"
  | "GRANDPARENT_DEATH"
  | "CHILD_DEATH"
  | "ADOPTED_CHILD_DEATH"
  | "GRANDCHILD_DEATH"
  | "SIBLING_DEATH";
type ParentalScenario = "SOLE_OR_ONLY_EMPLOYED_PARENT" | "SHARED_POOL";

type MedicalCertificate = {
  id: string;
  practitionerName: string;
  practitionerRegistrationNumber: string;
  consultationDate: string;
  bookedOffStartDate: string;
  bookedOffEndDate: string;
  fileReference: string;
  createdAt: string;
};

type LeaveEmployee = { id: string; firstName: string; lastName: string; employeeType: string };

type LeaveRequest = {
  id: string;
  employeeId: string;
  leaveType: LeaveTypeCode;
  startDate: string;
  endDate: string;
  unitsRequested: string | number;
  status: LeaveStatus;
  reason?: string | null;
  familyResponsibilityReason?: FamilyResponsibilityReason | null;
  parentalLeaveScenario?: ParentalScenario | null;
  workedPublicHoliday: boolean;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  employee: LeaveEmployee;
  medicalCertificate?: MedicalCertificate | null;
};

type LeaveBalance = {
  leaveType: LeaveTypeCode;
  cycleStart: string;
  cycleEnd: string;
  entitlementUnits: number;
  adjustmentUnits: number;
  takenUnits: number;
  availableUnits: number;
};

type LeavePreview = {
  leaveType: LeaveTypeCode;
  deductibleUnits: number;
  availableUnits: number | null;
  exceedsBalance: boolean;
  documentRequired: boolean;
  maxDaysForScenario: number | null;
};

type LeaveAdjustment = {
  id: string;
  employeeId: string;
  leaveType: LeaveTypeCode;
  units: string | number;
  reason: string;
  createdBy: string;
  createdAt: string;
};

type AuditLog = {
  id: string;
  employeeId?: string | null;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  createdAt: string;
};

const today = format(new Date(), "yyyy-MM-dd");
const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
const monthEnd = format(endOfMonth(new Date()), "yyyy-MM-dd");

const LEAVE_TYPE_OPTIONS: Array<{ code: LeaveTypeCode; label: string }> = [
  { code: "ANNUAL", label: "Annual" },
  { code: "SICK", label: "Sick" },
  { code: "FAMILY_RESPONSIBILITY", label: "Family responsibility" },
  { code: "PARENTAL", label: "Parental" },
  { code: "STUDY", label: "Study (security officers only)" },
];

const FAMILY_RESPONSIBILITY_REASONS: Array<{ code: FamilyResponsibilityReason; label: string }> = [
  { code: "CHILD_BIRTH", label: "Birth of employee's child" },
  { code: "CHILD_SICK", label: "Employee's child is sick" },
  { code: "SPOUSE_OR_LIFE_PARTNER_DEATH", label: "Death of spouse or life partner" },
  { code: "PARENT_DEATH", label: "Death of employee's parent" },
  { code: "ADOPTIVE_PARENT_DEATH", label: "Death of employee's adoptive parent" },
  { code: "GRANDPARENT_DEATH", label: "Death of employee's grandparent" },
  { code: "CHILD_DEATH", label: "Death of employee's child" },
  { code: "ADOPTED_CHILD_DEATH", label: "Death of employee's adopted child" },
  { code: "GRANDCHILD_DEATH", label: "Death of employee's grandchild" },
  { code: "SIBLING_DEATH", label: "Death of employee's sibling" },
];

const PARENTAL_SCENARIOS: Array<{ code: ParentalScenario; label: string; hint: string }> = [
  { code: "SOLE_OR_ONLY_EMPLOYED_PARENT", label: "Sole or only employed parent", hint: "4 consecutive months" },
  { code: "SHARED_POOL", label: "Shared with the other parent", hint: "4 months + 10 days pool, declared not verified" },
];

const tabs: Array<{ key: Tab; label: string; shortLabel: string; icon: IconName }> = [
  { key: "queue", label: "Approval queue", shortLabel: "Queue", icon: "inbox" },
  { key: "approved", label: "Approved leave", shortLabel: "Approved", icon: "check" },
  { key: "records", label: "Leave records", shortLabel: "Records", icon: "records" },
  { key: "balances", label: "Balances", shortLabel: "Balances", icon: "balance" },
  { key: "calendar", label: "Leave calendar", shortLabel: "Calendar", icon: "calendar" },
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

function leaveTypeLabel(code: string): string {
  return LEAVE_TYPE_OPTIONS.find((option) => option.code === code)?.label ?? code;
}

function unitsLabel(employeeType?: string | null): string {
  return employeeType === "security_officer" ? "shifts" : "days";
}

function units(value: string | number): number {
  return typeof value === "number" ? value : parseFloat(value);
}

function unitsText(value: string | number, employeeType?: string | null): string {
  const amount = units(value);
  return `${amount % 1 === 0 ? amount : amount.toFixed(2)} ${unitsLabel(employeeType)}`;
}

function dateLabel(value: string, pattern = "d MMM yyyy"): string {
  return format(parseISO(value.slice(0, 10)), pattern);
}

function period(start: string, end: string): string {
  return start.slice(0, 10) === end.slice(0, 10) ? dateLabel(start) : `${dateLabel(start)} - ${dateLabel(end)}`;
}

function employeeName(employee?: LeaveEmployee): string {
  return employee ? `${employee.firstName} ${employee.lastName}` : "Unknown employee";
}

function initials(employee?: LeaveEmployee): string {
  return employee ? `${employee.firstName[0] ?? ""}${employee.lastName[0] ?? ""}`.toUpperCase() : "?";
}

function friendly(value: string): string {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: string): string {
  if (status === "APPROVED") return "border-security-emerald-200 bg-security-emerald-50 text-security-emerald-700";
  if (status === "REJECTED" || status === "CANCELLED") return "border-red-200 bg-red-50 text-red-700";
  return "border-security-amber-200 bg-security-amber-50 text-security-amber-700";
}

export default function LeaveManagementPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(
    user && (hasCapability(user, "/employees/leave", "create") || hasCapability(user, "/payroll", "create"))
  );
  const canEdit = Boolean(
    user && (hasCapability(user, "/employees/leave", "edit") || hasCapability(user, "/payroll", "edit"))
  );
  const canApprove = Boolean(
    user && (hasCapability(user, "/employees/leave", "approve") || hasCapability(user, "/payroll", "approve"))
  );
  const canExport = Boolean(
    user && (hasCapability(user, "/employees/leave", "export") || hasCapability(user, "/payroll", "export"))
  );

  const [tab, setTab] = useState<Tab>("queue");
  const [employees, setEmployees] = useState<GuardPickerOption[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [adjustments, setAdjustments] = useState<LeaveAdjustment[]>([]);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | "">("");
  const [range, setRange] = useState({ start: monthStart, end: monthEnd });

  const [form, setForm] = useState({
    employeeId: "",
    leaveType: "ANNUAL" as LeaveTypeCode,
    startDate: today,
    endDate: today,
    unitsRequested: "1",
    reason: "",
    familyResponsibilityReason: "" as FamilyResponsibilityReason | "",
    parentalLeaveScenario: "" as ParentalScenario | "",
    workedPublicHoliday: false,
  });
  const [preview, setPreview] = useState<LeavePreview | null>(null);

  const [adjustmentForm, setAdjustmentForm] = useState({ employeeId: "", leaveType: "ANNUAL" as LeaveTypeCode, units: "", reason: "" });

  const [actionDialog, setActionDialog] = useState<{ kind: "reject" | "cancel"; request: LeaveRequest } | null>(null);
  const [actionReason, setActionReason] = useState("");

  const [certDialog, setCertDialog] = useState<LeaveRequest | null>(null);
  const [certForm, setCertForm] = useState({ practitionerName: "", practitionerRegistrationNumber: "", consultationDate: today, bookedOffStartDate: today, bookedOffEndDate: today });
  const [certFile, setCertFile] = useState<File | null>(null);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    if (!token) throw new Error("Not signed in");
    const response = await authFetch(path, token, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorMessage(body, `Request failed (${response.status})`));
    return body;
  }, [token]);

  const loadPendingCount = useCallback(async () => {
    if (!token) return;
    const body = await request("/leave?status=PENDING");
    setPendingCount((body.data ?? []).length);
  }, [token, request]);

  const loadEmployees = useCallback(async () => {
    if (!token) return;
    const rows = await fetchEmployeePickerOptions(token, { statuses: ["active", "training", "hired", "reliever"] });
    setEmployees(rows);
  }, [token]);

  useEffect(() => {
    loadEmployees().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load employees"));
  }, [loadEmployees]);
  useEffect(() => {
    loadPendingCount().catch(() => undefined);
  }, [loadPendingCount]);

  const loadTab = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      if (tab === "queue") {
        const query = new URLSearchParams({ status: "PENDING" });
        if (employeeFilter) query.set("employeeId", employeeFilter);
        setRequests((await request(`/leave?${query}`)).data ?? []);
      } else if (tab === "approved") {
        const query = new URLSearchParams({ status: "APPROVED" });
        if (employeeFilter) query.set("employeeId", employeeFilter);
        setRequests((await request(`/leave?${query}`)).data ?? []);
      } else if (tab === "records") {
        const query = new URLSearchParams();
        if (employeeFilter) query.set("employeeId", employeeFilter);
        if (statusFilter) query.set("status", statusFilter);
        setRequests((await request(`/leave?${query}`)).data ?? []);
      } else if (tab === "calendar") {
        const query = new URLSearchParams({ start: range.start, end: range.end, status: "APPROVED" });
        if (employeeFilter) query.set("employeeId", employeeFilter);
        setRequests((await request(`/leave?${query}`)).data ?? []);
      } else if (tab === "balances") {
        if (employeeFilter) {
          setBalances((await request(`/leave/balances?employeeId=${employeeFilter}`)).data ?? []);
        } else {
          setBalances([]);
        }
      } else if (tab === "adjustments") {
        const query = employeeFilter ? `?employeeId=${employeeFilter}` : "";
        setAdjustments((await request(`/leave/adjustments${query}`)).data ?? []);
      } else if (tab === "audit") {
        const query = employeeFilter ? `?employeeId=${employeeFilter}&limit=250` : "?limit=250";
        setAudit((await request(`/leave/audit${query}`)).data ?? []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load leave data");
    } finally {
      setLoading(false);
    }
  }, [token, tab, employeeFilter, statusFilter, range.start, range.end, request]);

  useEffect(() => { loadTab(); }, [loadTab]);

  const selectedEmployee = useMemo(() => employees.find((e) => e.id === form.employeeId), [employees, form.employeeId]);
  const availableLeaveTypes = useMemo(
    () => LEAVE_TYPE_OPTIONS.filter((option) => option.code !== "STUDY" || selectedEmployee?.employeeType === "security_officer"),
    [selectedEmployee]
  );

  function resetPreview() { setPreview(null); }

  function resetForm() {
    setForm({ employeeId: "", leaveType: "ANNUAL", startDate: today, endDate: today, unitsRequested: "1", reason: "", familyResponsibilityReason: "", parentalLeaveScenario: "", workedPublicHoliday: false });
    setPreview(null);
  }

  async function previewRequest() {
    setBusy("preview");
    setError(null);
    try {
      const body = await request("/leave/preview", {
        method: "POST",
        body: JSON.stringify({
          employeeId: form.employeeId,
          leaveType: form.leaveType,
          startDate: form.startDate,
          endDate: form.endDate,
          unitsRequested: Number(form.unitsRequested),
          familyResponsibilityReason: form.familyResponsibilityReason || undefined,
          parentalLeaveScenario: form.parentalLeaveScenario || undefined,
          workedPublicHoliday: form.workedPublicHoliday,
        }),
      });
      setPreview(body.data);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  }

  async function createRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!canCreate) return;
    setBusy("create");
    setError(null);
    try {
      await request("/leave", {
        method: "POST",
        body: JSON.stringify({
          employeeId: form.employeeId,
          leaveType: form.leaveType,
          startDate: form.startDate,
          endDate: form.endDate,
          unitsRequested: Number(form.unitsRequested),
          reason: form.reason || undefined,
          familyResponsibilityReason: form.familyResponsibilityReason || undefined,
          parentalLeaveScenario: form.parentalLeaveScenario || undefined,
          workedPublicHoliday: form.workedPublicHoliday,
        }),
      });
      resetForm();
      setTab("queue");
      await loadPendingCount();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create leave request");
    } finally {
      setBusy(null);
    }
  }

  async function decide(leaveRequest: LeaveRequest, decision: "approve" | "reject", reason?: string) {
    if (!canApprove) return;
    setBusy(leaveRequest.id);
    setError(null);
    try {
      await request(`/leave/${leaveRequest.id}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision, reason: reason || undefined }),
      });
      setActionDialog(null);
      setActionReason("");
      await Promise.all([loadTab(), loadPendingCount()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Decision failed");
    } finally {
      setBusy(null);
    }
  }

  async function cancelRequest(leaveRequest: LeaveRequest, reason: string) {
    if (!canCreate && !canEdit) return;
    setBusy(leaveRequest.id);
    setError(null);
    try {
      await request(`/leave/${leaveRequest.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
      setActionDialog(null);
      setActionReason("");
      await Promise.all([loadTab(), loadPendingCount()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cancellation failed");
    } finally {
      setBusy(null);
    }
  }

  async function postAdjustment(event: React.FormEvent) {
    event.preventDefault();
    if (!canApprove) return;
    setBusy("adjustment");
    setError(null);
    try {
      await request("/leave/adjustments", {
        method: "POST",
        body: JSON.stringify({
          employeeId: adjustmentForm.employeeId,
          leaveType: adjustmentForm.leaveType,
          units: Number(adjustmentForm.units),
          reason: adjustmentForm.reason,
        }),
      });
      setAdjustmentForm({ employeeId: "", leaveType: "ANNUAL", units: "", reason: "" });
      await loadTab();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Adjustment failed");
    } finally {
      setBusy(null);
    }
  }

  async function uploadCertificate(event: React.FormEvent) {
    event.preventDefault();
    if (!certDialog || !certFile) return;
    setBusy(`cert:${certDialog.id}`);
    setError(null);
    try {
      const upload = new FormData();
      upload.append("file", certFile);
      upload.append("practitionerName", certForm.practitionerName);
      upload.append("practitionerRegistrationNumber", certForm.practitionerRegistrationNumber);
      upload.append("consultationDate", certForm.consultationDate);
      upload.append("bookedOffStartDate", certForm.bookedOffStartDate);
      upload.append("bookedOffEndDate", certForm.bookedOffEndDate);
      await request(`/leave/${certDialog.id}/medical-certificate`, { method: "POST", body: upload });
      setCertDialog(null);
      setCertFile(null);
      await loadTab();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not attach medical certificate");
    } finally {
      setBusy(null);
    }
  }

  async function downloadCertificate(leaveRequest: LeaveRequest) {
    if (!token || !canExport) return;
    setBusy(`cert-download:${leaveRequest.id}`);
    setError(null);
    try {
      const response = await authFetch(`/leave/${leaveRequest.id}/medical-certificate`, token);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(errorMessage(body, "Download failed"));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = "medical-certificate";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] animate-fade-in pb-12">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <Link href="/employees" className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-security-lg border border-security-navy-100 bg-white text-security-navy-600 shadow-security-card transition hover:border-security-navy-200 hover:text-security-navy-900" aria-label="Back to team">
            <Icon name="arrow" />
          </Link>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-security-amber-600">Team workspace</p>
            <h1 className="text-3xl font-bold tracking-tight text-security-navy-900">Leave management</h1>
            <p className="mt-1 max-w-2xl text-sm text-security-navy-600">Annual, sick, family responsibility, parental, and study leave for general staff and NBCPSS security officers.</p>
          </div>
        </div>
        {canCreate && (
          <button onClick={() => setTab("add")} className="btn-primary inline-flex items-center justify-center gap-2 shadow-security-card">
            <Icon name="plus" className="h-4 w-4" /> New leave request
          </button>
        )}
      </header>

      <nav className="mb-6 overflow-x-auto rounded-security-lg border border-security-navy-100 bg-white p-1.5 shadow-security-card" aria-label="Leave sections">
        <div className="flex min-w-max gap-1">
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              aria-current={tab === item.key ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-medium transition ${tab === item.key ? "bg-security-navy-900 text-white shadow-security-card" : "text-security-navy-600 hover:bg-security-navy-50 hover:text-security-navy-900"}`}
            >
              <Icon name={item.icon} className="h-4 w-4" />
              <span className="hidden lg:inline">{item.label}</span>
              <span className="lg:hidden">{item.shortLabel}</span>
              {item.key === "queue" && pendingCount > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === item.key ? "bg-white text-security-navy-900" : "bg-security-amber-100 text-security-amber-700"}`}>{pendingCount}</span>}
            </button>
          ))}
        </div>
      </nav>

      {error && (
        <div role="alert" className="mb-5 flex items-start gap-3 rounded-security-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <span className="mt-0.5 rounded-full bg-red-100 p-1"><Icon name="warning" className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">We could not complete that action</p><p className="mt-0.5 break-words text-sm text-red-700">{error}</p></div>
          <button onClick={() => setError(null)} aria-label="Dismiss error" className="rounded p-1 hover:bg-red-100"><Icon name="close" className="h-4 w-4" /></button>
        </div>
      )}

      {tab === "queue" && (
        <SectionShell title="Approval queue" description="Leave requests waiting on a decision.">
          <div className="mb-5 max-w-sm"><EmployeeSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} allLabel="All employees" /></div>
          {loading ? <LoadingCards /> : requests.length ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {requests.map((leaveRequest) => (
                <RequestCard
                  key={leaveRequest.id}
                  leaveRequest={leaveRequest}
                  busy={busy}
                  canApprove={canApprove}
                  canExport={canExport}
                  onApprove={(req) => decide(req, "approve")}
                  onReject={(req) => { setActionReason(""); setActionDialog({ kind: "reject", request: req }); }}
                  onAttachCertificate={canCreate || canEdit ? (req) => { setCertForm({ practitionerName: "", practitionerRegistrationNumber: "", consultationDate: today, bookedOffStartDate: req.startDate.slice(0, 10), bookedOffEndDate: req.endDate.slice(0, 10) }); setCertFile(null); setCertDialog(req); } : undefined}
                  onDownloadCertificate={canExport ? downloadCertificate : undefined}
                />
              ))}
            </div>
          ) : <EmptyState icon="inbox" title="Queue cleared" text="There are no pending requests for this filter." action={canCreate ? { label: "Create a leave request", onClick: () => setTab("add") } : undefined} />}
        </SectionShell>
      )}

      {tab === "approved" && (
        <SectionShell title="Approved leave" description="Currently approved leave, with the option to cancel it.">
          <div className="mb-5 max-w-sm"><EmployeeSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} allLabel="All employees" /></div>
          {loading ? <LoadingCards /> : requests.length ? (
            <div className="space-y-3">
              {requests.map((leaveRequest) => (
                <div key={leaveRequest.id} className="rounded-security-lg border border-security-navy-100 bg-white">
                  <RecordRow leaveRequest={leaveRequest} />
                  <div className="flex flex-wrap justify-end gap-2 border-t border-security-navy-100 bg-security-navy-50 p-3">
                    {(canCreate || canEdit) && <button type="button" disabled={busy === leaveRequest.id} onClick={() => { setActionReason(""); setActionDialog({ kind: "cancel", request: leaveRequest }); }} className="btn-ghost px-3 py-2 text-sm">Cancel leave</button>}
                    {leaveRequest.leaveType === "SICK" && !leaveRequest.medicalCertificate && (canCreate || canEdit) && (
                      <button type="button" onClick={() => { setCertForm({ practitionerName: "", practitionerRegistrationNumber: "", consultationDate: today, bookedOffStartDate: leaveRequest.startDate.slice(0, 10), bookedOffEndDate: leaveRequest.endDate.slice(0, 10) }); setCertFile(null); setCertDialog(leaveRequest); }} className="btn-ghost px-3 py-2 text-sm">Attach medical certificate</button>
                    )}
                    {leaveRequest.medicalCertificate && canExport && <button type="button" onClick={() => downloadCertificate(leaveRequest)} className="btn-ghost px-3 py-2 text-sm">Download certificate</button>}
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState icon="check" title="No approved leave found" text="Try a different employee filter." />}
        </SectionShell>
      )}

      {tab === "records" && (
        <SectionShell title="Leave records" description="Search every leave request regardless of status.">
          <div className="mb-5 flex flex-col gap-3 rounded-security-lg border border-security-navy-100 bg-security-navy-50 p-3 lg:flex-row lg:items-end">
            <div className="min-w-52 flex-1"><EmployeeSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} allLabel="All employees" /></div>
            <label className="relative block"><span className="sr-only">Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as LeaveStatus | "")} className="input-modern">
                <option value="">All statuses</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </label>
            <button className="btn-secondary h-[46px] shrink-0" onClick={loadTab}>Refresh</button>
          </div>
          {loading ? <LoadingTable /> : requests.length ? (
            <div className="space-y-3">{requests.map((leaveRequest) => <div key={leaveRequest.id} className="rounded-security-lg border border-security-navy-100 bg-white"><RecordRow leaveRequest={leaveRequest} /></div>)}</div>
          ) : <EmptyState icon="records" title="No leave records found" text="Try a different employee or status filter." />}
        </SectionShell>
      )}

      {tab === "calendar" && (
        <SectionShell title="Leave calendar" description="Approved leave falling within a date range.">
          <div className="mb-5 flex flex-col gap-3 rounded-security-lg border border-security-navy-100 bg-security-navy-50 p-3 lg:flex-row lg:items-end">
            <div className="min-w-52 flex-1"><EmployeeSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} allLabel="All employees" /></div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From"><DateInput value={range.start} onChange={(start) => setRange((old) => ({ ...old, start }))} className="input-modern mt-1" /></Field>
              <Field label="To"><DateInput value={range.end} onChange={(end) => setRange((old) => ({ ...old, end }))} className="input-modern mt-1" /></Field>
            </div>
            <button className="btn-secondary h-[46px] shrink-0" onClick={loadTab}>Refresh</button>
          </div>
          {loading ? <LoadingCards /> : requests.length ? (
            <div className="space-y-3">{requests.map((leaveRequest) => <div key={leaveRequest.id} className="rounded-security-lg border border-security-navy-100 bg-white"><RecordRow leaveRequest={leaveRequest} /></div>)}</div>
          ) : <EmptyState icon="calendar" title="No approved leave in this period" text="Try a wider date range." />}
        </SectionShell>
      )}

      {tab === "balances" && (
        <SectionShell title="Leave balances" description="Entitlement, adjustments, and taken units for the employee's current cycle per leave type.">
          <div className="mb-5 max-w-sm"><EmployeeSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} allLabel="Select an employee" /></div>
          {!employeeFilter ? (
            <EmptyState icon="balance" title="Select an employee" text="Balances are calculated per employee." />
          ) : loading ? <LoadingTable /> : balances.length ? (
            <BalanceTable balances={balances} employeeType={employees.find((e) => e.id === employeeFilter)?.employeeType} />
          ) : <EmptyState icon="balance" title="No balance data" text="This employee may be missing a commencement date." />}
        </SectionShell>
      )}

      {tab === "add" && canCreate && (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <form onSubmit={createRequest} className="card-wireframe overflow-hidden">
            <div className="border-b border-security-navy-100 px-5 py-5 sm:px-7">
              <div className="flex items-center gap-3"><span className="rounded-security-lg bg-security-amber-100 p-2 text-security-amber-700"><Icon name="plus" /></span><div><h2 className="text-xl font-bold">New leave request</h2><p className="text-sm text-security-navy-500">Complete the details, preview the balance impact, then submit.</p></div></div>
            </div>
            <div className="space-y-7 p-5 sm:p-7">
              <FormSection number="1" title="Employee and leave type">
                <Field label="Employee" required>
                  <GuardSearchPicker guards={employees} value={form.employeeId} onChange={(employeeId) => { setForm((old) => ({ ...old, employeeId: employeeId ?? "", leaveType: "ANNUAL", familyResponsibilityReason: "", parentalLeaveScenario: "" })); resetPreview(); }} placeholder="Search by name or employee number" />
                </Field>
                <Field label="Leave type" required>
                  <select value={form.leaveType} onChange={(event) => { setForm((old) => ({ ...old, leaveType: event.target.value as LeaveTypeCode })); resetPreview(); }} className="input-modern mt-1">
                    {availableLeaveTypes.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
                  </select>
                </Field>
                {form.leaveType === "FAMILY_RESPONSIBILITY" && (
                  <Field label="Reason" required hint="Free text is not accepted for this leave type">
                    <select value={form.familyResponsibilityReason} onChange={(event) => setForm((old) => ({ ...old, familyResponsibilityReason: event.target.value as FamilyResponsibilityReason }))} className="input-modern mt-1">
                      <option value="">Select a reason</option>
                      {FAMILY_RESPONSIBILITY_REASONS.map((reason) => <option key={reason.code} value={reason.code}>{reason.label}</option>)}
                    </select>
                  </Field>
                )}
                {form.leaveType === "PARENTAL" && (
                  <Field label="Scenario" required>
                    <div className="mt-1 space-y-2">
                      {PARENTAL_SCENARIOS.map((scenario) => (
                        <label key={scenario.code} className="flex cursor-pointer items-start gap-3 rounded-security-lg border border-security-navy-100 p-3 hover:bg-security-navy-50">
                          <input type="radio" name="parentalScenario" checked={form.parentalLeaveScenario === scenario.code} onChange={() => setForm((old) => ({ ...old, parentalLeaveScenario: scenario.code }))} className="mt-1 h-4 w-4 accent-security-amber-600" />
                          <span><span className="block text-sm font-semibold">{scenario.label}</span><span className="block text-xs text-security-navy-500">{scenario.hint}</span></span>
                        </label>
                      ))}
                    </div>
                  </Field>
                )}
              </FormSection>

              <FormSection number="2" title="Dates and units">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Start date" required><DateInput value={form.startDate} onChange={(startDate) => { setForm((old) => ({ ...old, startDate, endDate: old.endDate < startDate ? startDate : old.endDate })); resetPreview(); }} className="input-modern mt-1 w-full" /></Field>
                  <Field label="End date" required><DateInput value={form.endDate} onChange={(endDate) => { setForm((old) => ({ ...old, endDate })); resetPreview(); }} className="input-modern mt-1 w-full" /></Field>
                </div>
                <Field label={`Units requested (${unitsLabel(selectedEmployee?.employeeType)})`} required hint="Enter directly — not derived from the date range">
                  <input required type="number" min="0.5" step="0.5" value={form.unitsRequested} onChange={(event) => { setForm((old) => ({ ...old, unitsRequested: event.target.value })); resetPreview(); }} className="input-modern mt-1" />
                </Field>
                {form.leaveType === "ANNUAL" && (
                  <label className="flex cursor-pointer items-start gap-3 rounded-security-lg border border-security-navy-100 p-3 hover:bg-security-navy-50">
                    <input type="checkbox" checked={form.workedPublicHoliday} onChange={(event) => { setForm((old) => ({ ...old, workedPublicHoliday: event.target.checked })); resetPreview(); }} className="mt-1 h-4 w-4 accent-security-amber-600" />
                    <span><span className="block text-sm font-semibold">A public holiday falls within this period</span><span className="block text-xs text-security-navy-500">Public holidays inside annual leave are not deducted from the balance.</span></span>
                  </label>
                )}
              </FormSection>

              <FormSection number="3" title="Reason">
                <Field label="Reason or note" hint="Optional internal context for the approver"><textarea value={form.reason} onChange={(event) => setForm((old) => ({ ...old, reason: event.target.value }))} className="input-modern mt-1 min-h-24 resize-y" placeholder="Add any context HR should know" /></Field>
              </FormSection>
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-security-navy-100 bg-security-navy-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">
              <button type="button" onClick={() => setTab("queue")} className="btn-ghost">Cancel</button>
              <button type="button" disabled={!form.employeeId || busy === "preview"} onClick={previewRequest} className="btn-secondary inline-flex items-center justify-center gap-2"><Icon name="search" className="h-4 w-4" />{busy === "preview" ? "Calculating..." : "Preview impact"}</button>
              <button type="submit" disabled={!form.employeeId || busy === "create" || (preview !== null && preview.exceedsBalance)} className="btn-primary inline-flex items-center justify-center gap-2"><Icon name="check" className="h-4 w-4" />{busy === "create" ? "Submitting..." : "Submit request"}</button>
            </div>
          </form>
          <aside className="card-wireframe overflow-hidden xl:sticky xl:top-5">
            <div className="border-b border-security-navy-100 px-5 py-4"><h3 className="font-bold">Impact summary</h3><p className="text-xs text-security-navy-500">Calculated from the employee's leave rules and current cycle.</p></div>
            {preview ? <PreviewCard preview={preview} employeeType={selectedEmployee?.employeeType} /> : <div className="flex min-h-72 flex-col items-center justify-center px-6 py-10 text-center"><span className="mb-3 rounded-full bg-security-navy-50 p-3 text-security-navy-500"><Icon name="search" /></span><p className="font-semibold">Preview before submitting</p><p className="mt-1 text-sm leading-6 text-security-navy-500">Select an employee, leave type, and dates, then preview to check the balance impact.</p></div>}
          </aside>
        </div>
      )}

      {tab === "adjustments" && (
        <SectionShell title="Leave adjustments" description="Manual balance corrections. Every adjustment is permanently recorded in the audit history.">
          <div className="space-y-8">
            {canApprove && (
              <section className="max-w-2xl">
                <h3 className="mb-3 font-bold text-security-navy-900">Post an adjustment</h3>
                <form onSubmit={postAdjustment} className="space-y-5 rounded-security-lg border border-security-navy-100 bg-security-navy-50 p-5">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800"><strong>Use carefully.</strong> Positive units grant extra balance; negative units deduct. Every change is permanently audited.</div>
                  <Field label="Employee" required><GuardSearchPicker guards={employees} value={adjustmentForm.employeeId} onChange={(employeeId) => setAdjustmentForm((old) => ({ ...old, employeeId: employeeId ?? "" }))} placeholder="Search employee" /></Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Leave type" required>
                      <select value={adjustmentForm.leaveType} onChange={(event) => setAdjustmentForm((old) => ({ ...old, leaveType: event.target.value as LeaveTypeCode }))} className="input-modern mt-1">
                        {LEAVE_TYPE_OPTIONS.filter((option) => option.code !== "PARENTAL").map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Units" required hint="e.g. 2 or -1"><input required type="number" step="0.5" value={adjustmentForm.units} onChange={(event) => setAdjustmentForm((old) => ({ ...old, units: event.target.value }))} className="input-modern mt-1" /></Field>
                  </div>
                  <Field label="Reason" required><textarea required value={adjustmentForm.reason} onChange={(event) => setAdjustmentForm((old) => ({ ...old, reason: event.target.value }))} className="input-modern mt-1 min-h-24" /></Field>
                  <button disabled={busy === "adjustment" || !adjustmentForm.employeeId} className="btn-primary">{busy === "adjustment" ? "Posting..." : "Post adjustment"}</button>
                </form>
              </section>
            )}
            <section className="border-t border-security-navy-100 pt-8">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <h3 className="font-bold text-security-navy-900">Adjustment history</h3>
                <div className="w-full sm:w-72"><EmployeeSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} allLabel="All employees" /></div>
              </div>
              {loading ? <LoadingTable /> : adjustments.length ? (
                <div className="overflow-x-auto rounded-security-lg border border-security-navy-100">
                  <table className="w-full text-sm">
                    <thead className="bg-security-navy-50 text-left text-xs font-semibold uppercase tracking-wide text-security-navy-500"><tr><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Leave type</th><th className="px-4 py-3">Units</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Date</th></tr></thead>
                    <tbody className="divide-y divide-security-navy-100">
                      {adjustments.map((adjustment) => (
                        <tr key={adjustment.id}>
                          <td className="px-4 py-3">{employees.find((e) => e.id === adjustment.employeeId) ? `${employees.find((e) => e.id === adjustment.employeeId)!.firstName} ${employees.find((e) => e.id === adjustment.employeeId)!.lastName}` : adjustment.employeeId}</td>
                          <td className="px-4 py-3">{leaveTypeLabel(adjustment.leaveType)}</td>
                          <td className={`px-4 py-3 font-semibold ${units(adjustment.units) < 0 ? "text-red-700" : "text-security-emerald-700"}`}>{units(adjustment.units) > 0 ? "+" : ""}{units(adjustment.units)}</td>
                          <td className="px-4 py-3 text-security-navy-600">{adjustment.reason}</td>
                          <td className="px-4 py-3 text-security-navy-500">{dateLabel(adjustment.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState icon="adjust" title="No adjustments" text="No manual balance corrections have been posted." />}
            </section>
          </div>
        </SectionShell>
      )}

      {tab === "audit" && (
        <SectionShell title="Audit history" description="A permanent, append-only record of every request, decision, and balance adjustment.">
          <div className="mb-5 max-w-sm"><EmployeeSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} allLabel="All employees" /></div>
          {loading ? <LoadingTable /> : audit.length ? <div className="relative ml-3 border-l border-security-navy-100 pl-6">{audit.map((event) => <AuditRow key={event.id} event={event} employees={employees} />)}</div> : <EmptyState icon="audit" title="No audit events yet" text="Leave actions will appear here as they occur." />}
        </SectionShell>
      )}

      {actionDialog && ((actionDialog.kind === "reject" && canApprove) || (actionDialog.kind === "cancel" && (canCreate || canEdit))) && (
        <ActionDialog
          kind={actionDialog.kind}
          leaveRequest={actionDialog.request}
          reason={actionReason}
          onReasonChange={setActionReason}
          busy={busy === actionDialog.request.id}
          onClose={() => { setActionDialog(null); setActionReason(""); }}
          onSubmit={() => actionDialog.kind === "reject" ? decide(actionDialog.request, "reject", actionReason) : cancelRequest(actionDialog.request, actionReason)}
        />
      )}

      {certDialog && (
        <CertificateDialog
          leaveRequest={certDialog}
          form={certForm}
          file={certFile}
          onFormChange={setCertForm}
          onFileChange={setCertFile}
          busy={busy === `cert:${certDialog.id}`}
          onClose={() => setCertDialog(null)}
          onSubmit={uploadCertificate}
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
    audit: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="m15 18-6-6 6-6"/>,
    warning: <><path d="M12 3 2.5 20h19z"/><path d="M12 9v4M12 17h.01"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    file: <><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    close: <path d="M6 6l12 12M18 6 6 18"/>,
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function SectionShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="card-wireframe overflow-hidden"><div className="border-b border-security-navy-100 px-5 py-5 sm:px-6"><h2 className="text-lg font-bold text-security-navy-900">{title}</h2><p className="mt-1 text-sm text-security-navy-500">{description}</p></div><div className="p-4 sm:p-6">{children}</div></section>;
}

function Status({ value }: { value: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(value)}`}>{friendly(value)}</span>;
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="text-sm font-semibold text-security-navy-900">{label}{required && <span className="ml-1 text-red-600">*</span>}</span>{hint && <span className="ml-2 text-xs font-normal text-security-navy-500">{hint}</span>}{children}</label>;
}

function FormSection({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <section><div className="mb-4 flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-security-navy-900 text-xs font-bold text-white">{number}</span><h3 className="font-bold text-security-navy-900">{title}</h3></div><div className="space-y-4 sm:pl-10">{children}</div></section>;
}

function EmployeeSelect({ value, onChange, employees, allLabel }: { value: string; onChange: (value: string) => void; employees: GuardPickerOption[]; allLabel: string }) {
  return <label className="relative block"><span className="sr-only">Employee filter</span><select value={value} onChange={(event) => onChange(event.target.value)} className="input-modern pr-10"><option value="">{allLabel}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} ({employee.employeeNumber})</option>)}</select></label>;
}

function CardFact({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return <div><p className="text-[10px] font-semibold uppercase tracking-wide text-security-navy-500">{label}</p><p className={`mt-0.5 text-sm font-semibold ${danger ? "text-red-700" : "text-security-navy-900"}`}>{value}</p></div>;
}

function RequestCard({ leaveRequest, busy, canApprove, canExport, onApprove, onReject, onAttachCertificate, onDownloadCertificate }: {
  leaveRequest: LeaveRequest;
  busy: string | null;
  canApprove: boolean;
  canExport: boolean;
  onApprove: (req: LeaveRequest) => void;
  onReject: (req: LeaveRequest) => void;
  onAttachCertificate?: (req: LeaveRequest) => void;
  onDownloadCertificate?: (req: LeaveRequest) => void;
}) {
  const isBusy = busy === leaveRequest.id;
  return (
    <article className="overflow-hidden rounded-security-lg border border-security-navy-100 bg-white shadow-security-card transition hover:border-security-navy-200 hover:shadow-md">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-security-navy-900 text-sm font-bold text-white">{initials(leaveRequest.employee)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-security-navy-900">{employeeName(leaveRequest.employee)}</h3>
              <Status value={leaveRequest.status} />
            </div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 rounded-security-lg bg-security-navy-50 p-4 sm:grid-cols-4">
          <CardFact label="Period" value={period(leaveRequest.startDate, leaveRequest.endDate)} />
          <CardFact label="Leave type" value={leaveTypeLabel(leaveRequest.leaveType)} />
          <CardFact label="Units" value={unitsText(leaveRequest.unitsRequested, leaveRequest.employee.employeeType)} />
          <CardFact label="Reason" value={leaveRequest.familyResponsibilityReason ? friendly(leaveRequest.familyResponsibilityReason) : leaveRequest.parentalLeaveScenario ? friendly(leaveRequest.parentalLeaveScenario) : leaveRequest.reason || "—"} />
        </div>
        {leaveRequest.leaveType === "SICK" && (
          <p className="mt-3 text-xs text-security-navy-500">
            {leaveRequest.medicalCertificate ? "Medical certificate attached." : "No medical certificate attached."}
            {onAttachCertificate && !leaveRequest.medicalCertificate && <button type="button" onClick={() => onAttachCertificate(leaveRequest)} className="ml-2 font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2">Attach</button>}
            {onDownloadCertificate && leaveRequest.medicalCertificate && <button type="button" onClick={() => onDownloadCertificate(leaveRequest)} className="ml-2 font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2">Download</button>}
          </p>
        )}
      </div>
      {canApprove && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-security-navy-100 bg-security-navy-50 p-3">
          <button type="button" disabled={isBusy} onClick={() => onReject(leaveRequest)} className="btn-ghost px-3 py-2 text-sm">Reject</button>
          <button type="button" disabled={isBusy} onClick={() => onApprove(leaveRequest)} className="btn-primary px-3 py-2 text-sm">{isBusy ? "Working..." : "Approve"}</button>
        </div>
      )}
    </article>
  );
}

function RecordRow({ leaveRequest }: { leaveRequest: LeaveRequest }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-security-navy-900 text-xs font-bold text-white">{initials(leaveRequest.employee)}</span>
        <div>
          <p className="font-semibold text-security-navy-900">{employeeName(leaveRequest.employee)}</p>
          <p className="text-xs text-security-navy-500">{leaveTypeLabel(leaveRequest.leaveType)} · {period(leaveRequest.startDate, leaveRequest.endDate)} · {unitsText(leaveRequest.unitsRequested, leaveRequest.employee.employeeType)}</p>
        </div>
      </div>
      <Status value={leaveRequest.status} />
    </div>
  );
}

function BalanceTable({ balances, employeeType }: { balances: LeaveBalance[]; employeeType?: string | null }) {
  return (
    <div className="overflow-x-auto rounded-security-lg border border-security-navy-100">
      <table className="w-full text-sm">
        <thead className="bg-security-navy-50 text-left text-xs font-semibold uppercase tracking-wide text-security-navy-500">
          <tr><th className="px-4 py-3">Leave type</th><th className="px-4 py-3">Cycle</th><th className="px-4 py-3">Entitlement</th><th className="px-4 py-3">Adjustments</th><th className="px-4 py-3">Taken</th><th className="px-4 py-3">Available</th></tr>
        </thead>
        <tbody className="divide-y divide-security-navy-100">
          {balances.map((balance) => (
            <tr key={balance.leaveType}>
              <td className="px-4 py-3 font-semibold text-security-navy-900">{leaveTypeLabel(balance.leaveType)}</td>
              <td className="px-4 py-3 text-security-navy-500">{dateLabel(balance.cycleStart)} - {dateLabel(balance.cycleEnd)}</td>
              <td className="px-4 py-3">{unitsText(balance.entitlementUnits, employeeType)}</td>
              <td className={`px-4 py-3 ${balance.adjustmentUnits < 0 ? "text-red-700" : balance.adjustmentUnits > 0 ? "text-security-emerald-700" : ""}`}>{balance.adjustmentUnits > 0 ? "+" : ""}{unitsText(balance.adjustmentUnits, employeeType)}</td>
              <td className="px-4 py-3">{unitsText(balance.takenUnits, employeeType)}</td>
              <td className={`px-4 py-3 font-semibold ${balance.availableUnits < 0 ? "text-red-700" : "text-security-emerald-700"}`}>{unitsText(balance.availableUnits, employeeType)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewCard({ preview, employeeType }: { preview: LeavePreview; employeeType?: string | null }) {
  return (
    <div className="space-y-4 p-5">
      {preview.exceedsBalance && (
        <div className="flex items-start gap-2 rounded-security-lg border border-red-200 bg-red-50 p-3 text-red-800">
          <Icon name="warning" className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-sm font-semibold">
            {preview.maxDaysForScenario != null
              ? `This exceeds the ${preview.maxDaysForScenario} day cap for the selected parental leave scenario.`
              : `This exceeds the available balance of ${preview.availableUnits} ${unitsLabel(employeeType)}.`}
          </p>
        </div>
      )}
      <CardFact label="Units to deduct" value={unitsText(preview.deductibleUnits, employeeType)} />
      {preview.availableUnits != null && <CardFact label="Available before this request" value={unitsText(preview.availableUnits, employeeType)} danger={preview.exceedsBalance} />}
      {preview.maxDaysForScenario != null && <CardFact label="Scenario cap" value={`${preview.maxDaysForScenario} days`} />}
      <CardFact label="Medical certificate" value={preview.documentRequired ? "Required" : "Not required"} danger={preview.documentRequired} />
    </div>
  );
}

function AuditRow({ event, employees }: { event: AuditLog; employees: GuardPickerOption[] }) {
  const employee = employees.find((e) => e.id === event.employeeId);
  return (
    <div className="relative mb-4 pb-1">
      <span className="absolute -left-[27px] mt-1 h-3 w-3 rounded-full border-2 border-white bg-security-navy-300" />
      <p className="text-sm font-semibold text-security-navy-900">{friendly(event.action)}</p>
      <p className="text-xs text-security-navy-500">{employee ? `${employee.firstName} ${employee.lastName}` : "—"} · {format(parseISO(event.createdAt), "d MMM yyyy HH:mm")}</p>
    </div>
  );
}

function ActionDialog({ kind, leaveRequest, reason, onReasonChange, busy, onClose, onSubmit }: {
  kind: "reject" | "cancel";
  leaveRequest: LeaveRequest;
  reason: string;
  onReasonChange: (value: string) => void;
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const requiresReason = kind === "cancel";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="border-b border-security-navy-100 px-5 py-4"><h3 className="font-bold text-security-navy-900">{kind === "reject" ? "Reject leave request" : "Cancel leave"}</h3><p className="mt-1 text-sm text-security-navy-500">{employeeName(leaveRequest.employee)} · {leaveTypeLabel(leaveRequest.leaveType)} · {period(leaveRequest.startDate, leaveRequest.endDate)}</p></div>
        <div className="p-5">
          <Field label="Reason" required={requiresReason}><textarea value={reason} onChange={(event) => onReasonChange(event.target.value)} className="input-modern mt-1 min-h-24" /></Field>
        </div>
        <div className="flex justify-end gap-3 border-t border-security-navy-100 bg-security-navy-50 p-4">
          <button type="button" onClick={onClose} className="btn-ghost">Close</button>
          <button type="button" disabled={busy || (requiresReason && !reason.trim())} onClick={onSubmit} className="btn-primary">{busy ? "Working..." : "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

function CertificateDialog({ leaveRequest, form, file, onFormChange, onFileChange, busy, onClose, onSubmit }: {
  leaveRequest: LeaveRequest;
  form: { practitionerName: string; practitionerRegistrationNumber: string; consultationDate: string; bookedOffStartDate: string; bookedOffEndDate: string };
  file: File | null;
  onFormChange: React.Dispatch<React.SetStateAction<{ practitionerName: string; practitionerRegistrationNumber: string; consultationDate: string; bookedOffStartDate: string; bookedOffEndDate: string }>>;
  onFileChange: (file: File | null) => void;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={onSubmit} className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="border-b border-security-navy-100 px-5 py-4"><h3 className="font-bold text-security-navy-900">Attach medical certificate</h3><p className="mt-1 text-sm text-security-navy-500">{employeeName(leaveRequest.employee)} · {period(leaveRequest.startDate, leaveRequest.endDate)}</p></div>
        <div className="space-y-4 p-5">
          <Field label="Practitioner name" required><input required value={form.practitionerName} onChange={(event) => onFormChange((old) => ({ ...old, practitionerName: event.target.value }))} className="input-modern mt-1" /></Field>
          <Field label="Practitioner registration number" required><input required value={form.practitionerRegistrationNumber} onChange={(event) => onFormChange((old) => ({ ...old, practitionerRegistrationNumber: event.target.value }))} className="input-modern mt-1" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Consultation date" required><DateInput value={form.consultationDate} onChange={(consultationDate) => onFormChange((old) => ({ ...old, consultationDate }))} className="input-modern mt-1" /></Field>
            <Field label="Booked off from" required><DateInput value={form.bookedOffStartDate} onChange={(bookedOffStartDate) => onFormChange((old) => ({ ...old, bookedOffStartDate }))} className="input-modern mt-1" /></Field>
            <Field label="Booked off to" required><DateInput value={form.bookedOffEndDate} onChange={(bookedOffEndDate) => onFormChange((old) => ({ ...old, bookedOffEndDate }))} className="input-modern mt-1" /></Field>
          </div>
          <Field label="Certificate file" required hint="PDF, JPG, PNG or WebP">
            <label className="mt-1 flex cursor-pointer items-center gap-3 rounded-security-lg border-2 border-dashed border-security-navy-200 bg-security-navy-50 p-4 transition hover:border-security-amber-400 hover:bg-security-amber-50/40">
              <span className="rounded-lg bg-white p-2 text-security-navy-600 shadow-security-card"><Icon name="file" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{file?.name ?? "Choose a file"}</span></span>
              <input required type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} className="sr-only" />
            </label>
          </Field>
        </div>
        <div className="flex justify-end gap-3 border-t border-security-navy-100 bg-security-navy-50 p-4">
          <button type="button" onClick={onClose} className="btn-ghost">Close</button>
          <button type="submit" disabled={busy || !file} className="btn-primary">{busy ? "Uploading..." : "Attach certificate"}</button>
        </div>
      </form>
    </div>
  );
}

function LoadingCards() {
  return <div className="grid gap-4 xl:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-security-lg bg-security-navy-50" />)}</div>;
}

function LoadingTable() {
  return <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-security-lg bg-security-navy-50" />)}</div>;
}

function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-security-lg border border-dashed border-security-navy-200 px-6 py-14 text-center">
      <span className="mb-3 rounded-full bg-security-navy-50 p-3 text-security-navy-500"><Icon name={icon} /></span>
      <p className="font-semibold text-security-navy-900">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-security-navy-500">{text}</p>
      {action && <button onClick={action.onClick} className="btn-primary mt-4">{action.label}</button>}
    </div>
  );
}
