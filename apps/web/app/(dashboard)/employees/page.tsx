"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { isFullAdmin } from "@/lib/permissions";
import { DateInput } from "@/components/date-input";
import { useConfirmDialog } from "@/components/ui";
import { clsx } from "clsx";

const SA_MAJOR_BANKS = [
  "ABSA",
  "Capitec",
  "FNB",
  "Investec",
  "Nedbank",
  "Standard Bank",
  "African Bank",
  "TymeBank",
];

interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  idNumber?: string | null;
  phone?: string | null;
  status: string;
  hourlyRate?: number | null;
  monthlySalary?: number | null;
  gradeId?: string | null;
  grade?: { name: string; hourlyRate: number } | null;
  groupId?: string | null;
  group?: { id: string; name: string } | null;
  currentSite: string | null;
  currentPost: string | null;
  assignedSites?: string[];
  employeeType?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  email?: string | null;
  physicalAddress?: string | null;
  postalAddress?: string | null;
  postalCode?: string | null;
  taxNumber?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankBranchCode?: string | null;
  commencementDate?: string | null;
  occupation?: string | null;
  placeOfWork?: string | null;
  ordinaryHours?: string | null;
  ordinaryDays?: string | null;
  overtimeRate?: number | null;
  payFrequency?: string | null;
  leaveEntitlement?: string | null;
  noticePeriod?: string | null;
  previousService?: string | null;
  psiraNumber?: string | null;
  psiraExpiryDate?: string | null;
  securityServiceType?: string | null;
  nextOfKin1Name?: string | null;
  nextOfKin1Phone?: string | null;
  nextOfKin2Name?: string | null;
  nextOfKin2Phone?: string | null;
  nextOfKin3Name?: string | null;
  nextOfKin3Phone?: string | null;
  residedOutsideSA?: boolean | null;
  militaryPoliceService?: boolean | null;
  criminalInvestigation?: boolean | null;
  mentallyUnstable?: boolean | null;
  trainingCompleted?: boolean | null;
}

const statusColors: Record<string, string> = {
  applicant: "badge-neutral",
  hired: "badge-neutral",
  training: "badge-warning",
  active: "badge-success",
  reliever: "badge-success",
  suspended: "badge-error",
  offboarded: "badge-neutral opacity-75",
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  applicant: ["hired"],
  hired: ["training", "offboarded"],
  training: ["active", "reliever", "offboarded"],
  active: ["suspended", "reliever", "offboarded"],
  reliever: ["active", "suspended", "offboarded"],
  suspended: ["active", "reliever", "offboarded"],
  offboarded: [],
};

/** Bucket key for team members with no group or an unknown/deleted group id */
const TEAM_UNASSIGNED_FOLDER_KEY = "__unassigned__";

export default function EmployeesPage() {
  const { token, user } = useAuth();
  const canDeleteEmployees = user ? isFullAdmin(user) : false;
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") ?? "";
  const defaultCompanyName = (user as { company?: { name: string } } | null)?.company?.name ?? "";
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showManageGroups, setShowManageGroups] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statusChangeId, setStatusChangeId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set());

  const groupSections = useMemo(() => {
    const validIds = new Set(groups.map((g) => g.id));
    const byKey = new Map<string, Employee[]>();
    for (const emp of employees) {
      const rawId = emp.group?.id ?? emp.groupId ?? null;
      const key =
        rawId && validIds.has(rawId) ? rawId : TEAM_UNASSIGNED_FOLDER_KEY;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(emp);
    }
    const sorted = [...groups].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
    const sections = sorted.map((g) => ({
      key: g.id,
      name: g.name,
      employees: byKey.get(g.id) ?? [],
    }));
    const unassigned = byKey.get(TEAM_UNASSIGNED_FOLDER_KEY);
    if (unassigned && unassigned.length > 0) {
      sections.push({
        key: TEAM_UNASSIGNED_FOLDER_KEY,
        name: "Unassigned",
        employees: unassigned,
      });
    }
    return sections;
  }, [employees, groups]);

  const fetchEmployees = async () => {
    if (!token) return;
    const pageSize = 100;
    const baseParams = new URLSearchParams();
    if (statusFilter !== "all") baseParams.set("status", statusFilter);
    if (searchQuery.trim().length >= 2) baseParams.set("q", searchQuery.trim());

    try {
      const all: Employee[] = [];
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;

      while (all.length < total) {
        const params = new URLSearchParams(baseParams);
        params.set("limit", String(pageSize));
        params.set("offset", String(offset));
        const res = await authFetch(`/employees?${params.toString()}`, token);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { message?: string; error?: string }).message ||
              (body as { error?: string }).error ||
              "Unable to load team members"
          );
        }
        const payload = await res.json();
        const page = Array.isArray(payload?.data) ? payload.data : [];
        total = Number(payload?.total ?? page.length);
        all.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }

      setEmployees(all);
    } catch (err) {
      console.error(err);
      setEmployees([]);
      setFetchError(
        err instanceof Error ? err.message : "Unable to load team members. Check the connection and try again."
      );
    }
  };

  const fetchGroups = async () => {
    if (!token) return;
    try {
      const response = await authFetch("/employee-groups", token);
      const data = await response.json();
      setGroups(data.data || []);
    } catch (err) {
      console.error(err);
      setFetchError("Unable to load team groups. Check the connection and try again.");
    }
  };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    Promise.all([fetchEmployees(), fetchGroups()]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [token, statusFilter, searchQuery]);

  if (loading) {
    return (
      <div className="animate-pulse grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-44 bg-white border-2 border-neutral-200 rounded-[10px]" />
        ))}
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div>
          <h1 className="page-title">Team</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Add employees, keep their details up to date, and organise them into groups.
          </p>
          {searchQuery.trim().length >= 2 && (
            <p className="text-xs text-neutral-600 mt-2">
              Filtered by &quot;{searchQuery}&quot;{" "}
              <Link href="/employees" className="underline hover:no-underline">Clear</Link>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link
            href="/employees/leave"
            className="btn-secondary h-11 shrink-0 flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Leave
          </Link>
          <button
            onClick={() => setShowManageGroups(!showManageGroups)}
            className="btn-secondary h-11 shrink-0"
          >
            {showManageGroups ? "Hide groups" : "Manage groups"}
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className={`${showForm ? "btn-secondary" : "btn-primary"} h-11 shrink-0`}
          >
            {showForm ? "Cancel" : "Add team member"}
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="mb-4 rounded-security border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {fetchError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 mb-8 p-4 sm:p-5 rounded-security-lg bg-gradient-to-br from-white via-neutral-50/80 to-security-navy-50/30 border-2 border-neutral-200 shadow-security-card">
        <span className="text-xs font-bold uppercase tracking-widest text-neutral-600 shrink-0">
          Filters
        </span>
        <div className="relative shrink-0 min-w-[min(100%,14rem)] sm:min-w-[15.5rem]">
          <label htmlFor="team-status-filter" className="sr-only">
            Filter team by employment status
          </label>
          <select
            id="team-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={clsx(
              "h-11 w-full min-w-[13.5rem] appearance-none rounded-security-lg border-2 border-neutral-200/90 bg-white",
              "pl-4 pr-11 text-sm font-semibold text-neutral-900 tracking-tight",
              "shadow-security-card",
              "cursor-pointer transition-all duration-200 ease-out",
              "hover:border-security-navy-300 hover:shadow-security-card-hover",
              "focus:border-security-navy-500 focus:outline-none focus:ring-2 focus:ring-security-navy-200 focus:ring-offset-2 focus:ring-offset-white"
            )}
          >
            <option value="all">All statuses</option>
            <option value="applicant">Applicant</option>
            <option value="hired">Hired</option>
            <option value="training">Training</option>
            <option value="active">Active</option>
            <option value="reliever">Reliever</option>
            <option value="suspended">Suspended</option>
            <option value="offboarded">Offboarded</option>
          </select>
          <span
            className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-[calc(0.5rem-1px)] border-l border-neutral-200/70 bg-gradient-to-b from-security-navy-50/90 to-white text-security-navy-700"
            aria-hidden
          >
            <svg className="h-4 w-4 shrink-0 opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </div>
      </div>

      {showForm && (
        <EmployeeForm
          token={token!}
          defaultPlaceOfWork={defaultCompanyName}
          onSuccess={() => {
            setShowForm(false);
            fetchEmployees();
          }}
        />
      )}

      {editingId && (
        <EditModal
          employeeId={editingId}
          token={token!}
          defaultPlaceOfWork={defaultCompanyName}
          canDeleteEmployees={canDeleteEmployees}
          onClose={() => setEditingId(null)}
          onSuccess={() => {
            setEditingId(null);
            fetchEmployees();
          }}
        />
      )}

      {statusChangeId && (
        <StatusModal
          employee={employees.find((e) => e.id === statusChangeId)!}
          token={token!}
          onClose={() => setStatusChangeId(null)}
          onSuccess={() => {
            setStatusChangeId(null);
            fetchEmployees();
          }}
        />
      )}

      {showManageGroups && (
        <ManageGroupsSection
          groups={groups}
          token={token!}
          onRefresh={() => {
            fetchGroups();
            fetchEmployees();
          }}
        />
      )}

      {employees.length > 0 && (
        <div className="space-y-3">
          {groupSections.map((section) => {
            const isOpen = expandedFolderIds.has(section.key);
            return (
              <div
                key={section.key}
                className="rounded-[10px] border-2 border-neutral-200 bg-white overflow-hidden shadow-sm"
              >
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-neutral-50/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                  aria-expanded={isOpen}
                  aria-controls={`team-folder-panel-${section.key}`}
                  id={`team-folder-trigger-${section.key}`}
                  onClick={() => {
                    setExpandedFolderIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(section.key)) next.delete(section.key);
                      else next.add(section.key);
                      return next;
                    });
                  }}
                >
                  <span className="shrink-0 text-neutral-600" aria-hidden>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.75}
                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                      />
                    </svg>
                  </span>
                  <span className="flex-1 min-w-0 font-semibold text-black truncate">
                    {section.name}
                  </span>
                  <span className="shrink-0 text-sm text-neutral-500 tabular-nums">
                    ({section.employees.length})
                  </span>
                  <svg
                    className={clsx(
                      "w-5 h-5 shrink-0 text-neutral-500 transition-transform duration-200",
                      isOpen && "rotate-180"
                    )}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isOpen && (
                  <div
                    id={`team-folder-panel-${section.key}`}
                    role="region"
                    aria-labelledby={`team-folder-trigger-${section.key}`}
                    className="border-t-2 border-neutral-200 p-4 bg-wireframe-accent/40"
                  >
                    {section.employees.length === 0 ? (
                      <p className="text-sm text-neutral-600 py-2 px-1">No members in this group.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {section.employees.map((emp) => (
                          <EmployeeTeamCard
                            key={emp.id}
                            emp={emp}
                            expandedId={expandedId}
                            onToggleExpand={(id) =>
                              setExpandedId((prev) => (prev === id ? null : id))
                            }
                            onEdit={setEditingId}
                            onChangeStatus={setStatusChangeId}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {employees.length === 0 && (
        <div className="card-wireframe text-center py-16 px-6">
          <p className="text-base font-semibold text-black">
            {statusFilter !== "all" || searchQuery.trim().length >= 2
              ? "No team members match your filters"
              : "No team members yet"}
          </p>
          <p className="text-sm mt-2 text-neutral-600 max-w-md mx-auto">
            {statusFilter !== "all" || searchQuery.trim().length >= 2
              ? "Try a different status or clear the search to see everyone."
              : "Add your first team member to start building rosters, tracking attendance, and preparing payroll."}
          </p>
          {statusFilter === "all" && searchQuery.trim().length < 2 && (
            <button onClick={() => setShowForm(true)} className="btn-primary mt-6">
              Add team member
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function toDateStr(d: string | Date | null | undefined): string {
  if (!d) return "";
  const x = typeof d === "string" ? d : d.toISOString?.().slice(0, 10);
  return x?.slice(0, 10) ?? "";
}

function EmployeeTeamCard({
  emp,
  expandedId,
  onToggleExpand,
  onEdit,
  onChangeStatus,
}: {
  emp: Employee;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onEdit: (id: string) => void;
  onChangeStatus: (id: string) => void;
}) {
  return (
    <div
      onClick={() => onToggleExpand(emp.id)}
      className={`card-elevated p-5 cursor-pointer ${
        expandedId === emp.id ? "ring-2 ring-offset-2 ring-black" : ""
      }`}
    >
      <div className="flex justify-between items-start gap-3">
        <div>
          <h3 className="text-lg font-bold text-black uppercase tracking-tight">
            {emp.firstName} {emp.lastName}
          </h3>
          <p className="text-xs uppercase tracking-wider text-black mt-1">
            ID: {emp.employeeNumber}
          </p>
          <p className="text-xs uppercase tracking-wider text-black mt-0.5">
            {(emp.employeeType === "office" ? "Office" : "Guard")}: {emp.group?.name ?? "—"}
          </p>
        </div>
        <span className={`shrink-0 uppercase ${statusColors[emp.status] ?? "badge-neutral"}`}>
          {emp.status}
        </span>
      </div>

      <div className="mt-4 p-4 rounded-[10px] bg-neutral-200 border-2 border-neutral-200">
        <div className="space-y-1.5 text-xs uppercase tracking-wider text-black font-medium">
          {emp.idNumber && <p>ID: {emp.idNumber}</p>}
          {emp.psiraNumber && <p>PSIRA: {emp.psiraNumber}</p>}
          {emp.phone && <p>PHONE: {emp.phone}</p>}
          {(emp.grade || emp.hourlyRate != null || emp.monthlySalary != null) && (
            <p>
              GRADE: {emp.grade
                ? `${emp.grade.name} (${Number(emp.grade.hourlyRate).toFixed(2)}/HR)`
                : emp.employeeType === "office" && emp.monthlySalary != null
                  ? `R${emp.monthlySalary}/MONTH`
                  : emp.hourlyRate != null
                    ? `R${Number(emp.hourlyRate).toFixed(2)}/HR`
                    : "—"}
            </p>
          )}
          {(emp.employeeType ?? "security") === "security" && (
            <p>
              SITE: {emp.assignedSites && emp.assignedSites.length > 0 ? emp.assignedSites.join(", ") : "Not assigned"}
            </p>
          )}
          {!emp.idNumber && !emp.psiraNumber && !emp.phone && !emp.grade && emp.hourlyRate == null && emp.monthlySalary == null && (
            <p className="text-black/70">No details</p>
          )}
        </div>
      </div>

      {(emp.employeeType ?? "security") === "security" &&
        (!emp.assignedSites || emp.assignedSites.length === 0) &&
        ["active", "training", "hired", "reliever"].includes(emp.status) && (
          <div
            className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border-2 border-neutral-200 bg-neutral-50 px-3 py-2 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="uppercase tracking-wider text-black">Next step: assign this guard to a site</span>
            <Link href="/sites" className="font-bold uppercase tracking-wider text-black underline">
              Go to Sites
            </Link>
          </div>
        )}

      {expandedId === emp.id && (
        <div className="mt-4 pt-4 border-t-2 border-neutral-200 space-y-3 text-sm">
          {emp.email && (
            <p><span className="text-[10px] uppercase tracking-wider text-black">Email</span><br />{emp.email}</p>
          )}
          {emp.dateOfBirth && (
            <p><span className="text-[10px] uppercase tracking-wider text-black">DOB</span><br />{toDateStr(emp.dateOfBirth)}</p>
          )}
          {emp.gender && (
            <p><span className="text-[10px] uppercase tracking-wider text-black">Gender</span><br />{emp.gender === "M" ? "Male" : "Female"}</p>
          )}
          {emp.maritalStatus && (
            <p><span className="text-[10px] uppercase tracking-wider text-black">Marital status</span><br />{emp.maritalStatus.charAt(0).toUpperCase() + emp.maritalStatus.slice(1)}</p>
          )}
          {emp.physicalAddress && (
            <p><span className="text-[10px] uppercase tracking-wider text-black">Address</span><br />{emp.physicalAddress}{emp.postalCode ? ` ${emp.postalCode}` : ""}</p>
          )}
          {emp.commencementDate && (
            <p><span className="text-[10px] uppercase tracking-wider text-black">Started</span><br />{toDateStr(emp.commencementDate)}</p>
          )}
          {(emp.bankName || emp.bankAccountNumber) && (
            <p><span className="text-[10px] uppercase tracking-wider text-black">Bank</span><br />{emp.bankName || "—"}{emp.bankAccountNumber ? ` •••• ${String(emp.bankAccountNumber).slice(-4)}` : ""}</p>
          )}
          {(emp.nextOfKin1Name || emp.nextOfKin1Phone) && (
            <p><span className="text-[10px] uppercase tracking-wider text-black">Next of kin</span><br />{emp.nextOfKin1Name || "—"} {emp.nextOfKin1Phone ? `• ${emp.nextOfKin1Phone}` : ""}</p>
          )}
          {emp.psiraExpiryDate && (
            <p><span className="text-[10px] uppercase tracking-wider text-black">PSIRA expiry</span><br />{toDateStr(emp.psiraExpiryDate)}</p>
          )}
          {emp.occupation && (
            <p><span className="text-[10px] uppercase tracking-wider text-black">Occupation</span><br />{emp.occupation}</p>
          )}
          {emp.placeOfWork && (
            <p><span className="text-[10px] uppercase tracking-wider text-black">Place of work</span><br />{emp.placeOfWork}</p>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-4" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => onEdit(emp.id)}
          className="text-xs font-medium uppercase tracking-wider text-black hover:underline"
        >
          Edit
        </button>
        {emp.status !== "offboarded" && (
          <button
            type="button"
            onClick={() => onChangeStatus(emp.id)}
            className="text-xs font-medium uppercase tracking-wider text-black hover:underline"
          >
            Change status
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Parse South African 13-digit ID number to extract date of birth and gender.
 * Format: YYMMDD SSSS C AZ (first 6 = DOB, digits 7-10: 0000-4999 = F, 5000-9999 = M)
 */
function parseSAIdNumber(id: string): { dateOfBirth?: string; gender?: "M" | "F" } | null {
  const clean = id.replace(/\s/g, "");
  if (clean.length !== 13 || !/^\d{13}$/.test(clean)) return null;
  const yy = parseInt(clean.slice(0, 2), 10);
  const mm = parseInt(clean.slice(2, 4), 10);
  const dd = parseInt(clean.slice(4, 6), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  // SA convention: 00-29 = 2000-2029, 30-99 = 1930-1999
  const century = yy <= 29 ? 2000 : 1900;
  const year = century + yy;
  const dateOfBirth = `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const genderSeq = parseInt(clean.slice(6, 10), 10);
  const gender = genderSeq < 5000 ? "F" : "M";
  return { dateOfBirth, gender };
}

function PayGradeSelect({
  token,
  value,
  onChange,
  groupId,
  className = "input-modern",
  required = false,
}: {
  token: string;
  value: string;
  onChange: (v: string) => void;
  groupId?: string | null;
  className?: string;
  required?: boolean;
}) {
  const [grades, setGrades] = useState<{ id: string; name: string; hourlyRate: string }[]>([]);
  useEffect(() => {
    const url = groupId && groupId.trim()
      ? `/payroll/pay-grades?groupId=${encodeURIComponent(groupId)}`
      : "/payroll/pay-grades";
    authFetch(url, token)
      .then((r) => r.json())
      .then((d) => setGrades(d.data || []))
      .catch(console.error);
  }, [token, groupId]);

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className} required={required}>
      <option value="">{required ? "Select pay grade *" : "Pay grade (optional)"}</option>
      {grades.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name} — R{Number(g.hourlyRate).toFixed(2)}/hr
        </option>
      ))}
    </select>
  );
}

function GroupSelect({
  token,
  value,
  onChange,
  className = "input-modern",
  required = false,
}: {
  token: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  required?: boolean;
}) {
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    authFetch("/employee-groups", token)
      .then((r) => r.json())
      .then((d) => setGroups(d.data || []))
      .catch(console.error);
  }, [token]);

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className} required={required}>
      <option value="">{required ? "Select group *" : "Group (optional)"}</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>{g.name}</option>
      ))}
    </select>
  );
}

function ManageGroupsSection({
  groups,
  token,
  onRefresh,
}: {
  groups: { id: string; name: string }[];
  token: string;
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await authFetch("/employee-groups", token, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      if (res.ok) {
        setName("");
        setDescription("");
        onRefresh();
      } else {
        const data = await res.json().catch(() => ({}));
        const msg =
          data?.message?.name?.[0] ??
          (typeof data?.message === "string" ? data.message : null) ??
          data?.error ??
          `Failed to add group (${res.status})`;
        alert(msg);
      }
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to add group");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: "Delete group?",
      message: "Team members in this group will be unassigned.",
      confirmLabel: "Delete group",
    });
    if (!confirmed) return;
    try {
      const res = await authFetch(`/employee-groups/${id}`, token, { method: "DELETE" });
      if (res.ok) onRefresh();
      else alert("Failed to delete.");
    } catch (err) {
      console.error(err);
      alert("Failed to delete.");
    }
  };

  return (
    <div className="card-wireframe mb-6 p-4">
      {confirmDialog}
      <h3 className="text-sm font-semibold text-neutral-800 mb-1">Groups</h3>
      <p className="text-xs text-neutral-600 mb-4">
        Groups organise your team (for example by region or client). Each team member belongs to one group.
      </p>
      <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name"
          className="flex-1 min-w-[140px] px-2 py-1.5 text-sm border-2 border-neutral-200 rounded-[10px] bg-white input-modern"
          required
        />
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="flex-1 min-w-[140px] px-2 py-1.5 text-sm border-2 border-neutral-200 rounded-[10px] bg-white input-modern"
        />
        <button type="submit" disabled={saving} className="btn-secondary text-xs py-1.5 px-3">
          {saving ? "Adding..." : "Add group"}
        </button>
      </form>
      <div className="space-y-1">
        {groups.map((g) => (
          <div key={g.id} className="flex items-center justify-between py-1.5 px-2 text-sm rounded hover:bg-neutral-100/80">
            <span>{g.name}</span>
            <button
              type="button"
              onClick={() => handleDelete(g.id)}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
              aria-label={`Delete group ${g.name}`}
            >
              Delete
            </button>
          </div>
        ))}
        {groups.length === 0 && <p className="text-neutral-400 text-xs py-1">No groups yet. Add one above.</p>}
      </div>
    </div>
  );
}

function EmployeeForm({
  token,
  defaultPlaceOfWork,
  onSuccess,
}: {
  token: string;
  defaultPlaceOfWork?: string;
  onSuccess: () => void;
}) {
  const [employeeType, setEmployeeType] = useState<"office" | "security">("security");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [monthlySalary, setMonthlySalary] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [status, setStatus] = useState("applicant");
  const [error, setError] = useState("");

  // Labour Law (BCEA) - office staff
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [physicalAddress, setPhysicalAddress] = useState("");
  const [postalAddress, setPostalAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankBranchCode, setBankBranchCode] = useState("");
  const [commencementDate, setCommencementDate] = useState("");
  const [occupation, setOccupation] = useState("");
  const [placeOfWork, setPlaceOfWork] = useState(defaultPlaceOfWork ?? "");
  const [ordinaryHours, setOrdinaryHours] = useState("");
  const [ordinaryDays, setOrdinaryDays] = useState("");
  const [overtimeRate, setOvertimeRate] = useState("");
  const [payFrequency, setPayFrequency] = useState("");
  const [leaveEntitlement, setLeaveEntitlement] = useState("");
  const [noticePeriod, setNoticePeriod] = useState("");
  const [previousService, setPreviousService] = useState("");

  // PSIRA - security staff
  const [psiraNumber, setPsiraNumber] = useState("");
  const [psiraExpiryDate, setPsiraExpiryDate] = useState("");
  const [securityServiceType, setSecurityServiceType] = useState("");
  const [nextOfKin1Name, setNextOfKin1Name] = useState("");
  const [nextOfKin1Phone, setNextOfKin1Phone] = useState("");
  const [nextOfKin2Name, setNextOfKin2Name] = useState("");
  const [nextOfKin2Phone, setNextOfKin2Phone] = useState("");
  const [nextOfKin3Name, setNextOfKin3Name] = useState("");
  const [nextOfKin3Phone, setNextOfKin3Phone] = useState("");
  const [residedOutsideSA, setResidedOutsideSA] = useState<boolean | "">("");
  const [militaryPoliceService, setMilitaryPoliceService] = useState<boolean | "">("");
  const [criminalInvestigation, setCriminalInvestigation] = useState<boolean | "">("");
  const [mentallyUnstable, setMentallyUnstable] = useState<boolean | "">("");
  const [trainingCompleted, setTrainingCompleted] = useState<boolean | "">("");
  const [activeTab, setActiveTab] = useState<"basic" | "labour" | "bank" | "psira">("basic");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    authFetch("/employees/next-number", token)
      .then((r) => r.json())
      .then((d) => {
        if (d?.employeeNumber) setEmployeeNumber(d.employeeNumber);
      })
      .catch(() => {});
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!employeeNumber.trim()) {
      setActiveTab("basic");
      setError("Team member ID is required. Enter it on the Basic details tab.");
      return;
    }
    if (employeeType === "security" && !psiraNumber.trim()) {
      setActiveTab("psira");
      setError("PSIRA number is required for security guards. Enter it on the PSIRA tab.");
      return;
    }
    if (employeeType === "security" && !gradeId) {
      setActiveTab("basic");
      setError("Pay grade is required for security guards. Choose one on the Basic details tab.");
      return;
    }
    if (!groupId) {
      setActiveTab("basic");
      setError("Every team member needs a group. Choose one on the Basic details tab.");
      return;
    }
    if (employeeType === "office" && (!monthlySalary || parseFloat(monthlySalary) <= 0)) {
      setActiveTab("basic");
      setError("Monthly salary is required for office staff. Enter it on the Basic details tab.");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        employeeNumber: employeeNumber.trim(),
        firstName,
        lastName,
        idNumber: idNumber || undefined,
        phone: phone.trim() === "" ? "" : phone.trim() || undefined,
        email: email || undefined,
        monthlySalary: employeeType === "office" && monthlySalary ? parseFloat(monthlySalary) : undefined,
        gradeId: employeeType === "security" ? gradeId : undefined,
        groupId,
        status,
        employeeType,
        dateOfBirth: dateOfBirth || undefined,
        gender: gender || undefined,
        maritalStatus: maritalStatus || undefined,
        physicalAddress: physicalAddress || undefined,
        postalAddress: postalAddress || undefined,
        postalCode: postalCode || undefined,
        taxNumber: taxNumber || undefined,
        bankName: bankName || undefined,
        bankAccountNumber: bankAccountNumber || undefined,
        bankBranchCode: bankBranchCode || undefined,
        commencementDate: commencementDate || undefined,
        occupation: occupation || undefined,
        placeOfWork: placeOfWork || undefined,
        ordinaryHours: ordinaryHours || undefined,
        ordinaryDays: ordinaryDays || undefined,
        overtimeRate: overtimeRate ? parseFloat(overtimeRate) : undefined,
        payFrequency: payFrequency || undefined,
        leaveEntitlement: leaveEntitlement || undefined,
        noticePeriod: noticePeriod || undefined,
        previousService: previousService || undefined,
        psiraNumber: psiraNumber || undefined,
        psiraExpiryDate: psiraExpiryDate || undefined,
        securityServiceType: securityServiceType || undefined,
        nextOfKin1Name: nextOfKin1Name || undefined,
        nextOfKin1Phone: nextOfKin1Phone || undefined,
        nextOfKin2Name: nextOfKin2Name || undefined,
        nextOfKin2Phone: nextOfKin2Phone || undefined,
        nextOfKin3Name: nextOfKin3Name || undefined,
        nextOfKin3Phone: nextOfKin3Phone || undefined,
        residedOutsideSA: residedOutsideSA === "" ? undefined : residedOutsideSA,
        militaryPoliceService: militaryPoliceService === "" ? undefined : militaryPoliceService,
        criminalInvestigation: criminalInvestigation === "" ? undefined : criminalInvestigation,
        mentallyUnstable: mentallyUnstable === "" ? undefined : mentallyUnstable,
        trainingCompleted: trainingCompleted === "" ? undefined : trainingCompleted,
      };
      const res = await authFetch("/employees", token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        const msg = data?.message?.psiraNumber?.[0] ?? data?.message?.gradeId?.[0] ?? data?.message?.groupId?.[0] ?? data?.message?.monthlySalary?.[0] ?? data?.message?.employeeNumber?.[0] ?? (typeof data?.message === "string" ? data.message : null) ?? "Could not save the team member. Please check the details and try again.";
        throw new Error(msg);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the team member. Please check the details and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="card-wireframe mb-6 p-6 max-h-[85vh] overflow-y-auto"
    >
      <div className="mb-4 pb-3 border-b-2 border-neutral-200">
        <h3 className="text-base font-semibold text-neutral-900 tracking-tight">Add a team member</h3>
        <p className="mt-1 text-xs text-neutral-600">
          Fields marked with <span className="text-red-600 font-semibold">*</span> are required. You can fill in the other tabs later.
        </p>
      </div>
      {error && (
        <div className="mb-4 p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md" role="alert">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <section className="p-4 rounded-lg bg-wireframe-accent border-2 border-neutral-200">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 mb-2">Staff type</h4>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="staffType"
                value="office"
                checked={employeeType === "office"}
                onChange={() => setEmployeeType("office")}
                className="w-3.5 h-3.5 border-2 border-neutral-200 accent-neutral-900"
              />
              <span className="text-sm font-medium text-neutral-900">Office</span>
              <span className="text-xs text-neutral-500">(salary)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="staffType"
                value="security"
                checked={employeeType === "security"}
                onChange={() => setEmployeeType("security")}
                className="w-3.5 h-3.5 border-2 border-neutral-200 accent-neutral-900"
              />
              <span className="text-sm font-medium text-neutral-900">Guard</span>
              <span className="text-xs text-neutral-500">(hourly)</span>
            </label>
          </div>
        </section>

        <div className="flex gap-1 border-b-2 border-neutral-200 overflow-x-auto">
          {(["basic", "labour", "psira", "bank"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={clsx(
                "px-4 py-2.5 text-sm font-medium rounded-t-sm transition-colors -mb-px",
                activeTab === tab
                  ? "bg-white text-neutral-800 border-2 border-neutral-200 border-b-transparent"
                  : "text-neutral-600 hover:text-neutral-900"
              )}
            >
              {tab === "basic" ? "Basic details" : tab === "labour" ? "Employment (BCEA)" : tab === "bank" ? "Bank & tax" : "PSIRA"}
            </button>
          ))}
        </div>

        {activeTab === "basic" && (
        <section className="p-4 rounded-lg bg-wireframe-accent border-2 border-neutral-200">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 mb-3">Basic details</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="new-emp-number" className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
                Team member ID <span className="text-red-600">*</span>
              </label>
              <input
                id="new-emp-number"
                placeholder="e.g. EMP-0042"
                value={employeeNumber}
                onChange={(e) => setEmployeeNumber(e.target.value)}
                className="input-compact"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="new-emp-status" className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
                Employment status
              </label>
              <select id="new-emp-status" value={status} onChange={(e) => setStatus(e.target.value)} className="input-compact">
                <option value="applicant">Applicant</option>
                <option value="hired">Hired</option>
                <option value="training">Training</option>
                <option value="active">Active</option>
                <option value="reliever">Reliever</option>
                <option value="suspended">Suspended</option>
                <option value="offboarded">Offboarded</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="new-emp-first-name" className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
                First name <span className="text-red-600">*</span>
              </label>
              <input id="new-emp-first-name" placeholder="e.g. Thabo" value={firstName} onChange={(e) => setFirstName(e.target.value)} required className="input-compact" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="new-emp-last-name" className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
                Last name <span className="text-red-600">*</span>
              </label>
              <input id="new-emp-last-name" placeholder="e.g. Mokoena" value={lastName} onChange={(e) => setLastName(e.target.value)} required className="input-compact" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="new-emp-id-number" className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
                SA ID number
              </label>
              <input
                id="new-emp-id-number"
                placeholder="13-digit ID – fills in birth date & gender"
                value={idNumber}
                onChange={(e) => {
                  const v = e.target.value;
                  setIdNumber(v);
                  const parsed = parseSAIdNumber(v);
                  if (parsed) {
                    setDateOfBirth(parsed.dateOfBirth ?? "");
                    if (parsed.gender) setGender(parsed.gender);
                  }
                }}
                className="input-compact"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="new-emp-phone" className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
                Phone (WhatsApp)
              </label>
              <input id="new-emp-phone" placeholder="e.g. 0821234567" value={phone} onChange={(e) => setPhone(e.target.value)} className="input-compact" title="WhatsApp number for clock-in, payslip, etc." />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="new-emp-email" className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
                Email
              </label>
              <input id="new-emp-email" type="email" placeholder="e.g. name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="input-compact" />
            </div>
            {employeeType === "office" ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="new-emp-salary" className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
                  Monthly salary (R) <span className="text-red-600">*</span>
                </label>
                <input
                  id="new-emp-salary"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 15000"
                  value={monthlySalary}
                  onChange={(e) => setMonthlySalary(e.target.value)}
                  className="input-compact"
                  required
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
                  Pay grade <span className="text-red-600">*</span>
                </label>
                <PayGradeSelect token={token} value={gradeId} onChange={setGradeId} groupId={groupId} className="input-compact" required />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
                Group <span className="text-red-600">*</span>
              </label>
              <GroupSelect token={token} value={groupId} onChange={setGroupId} className="input-compact" required />
            </div>
          </div>
        </section>
        )}

        {activeTab === "labour" && (
        <section className="p-4 rounded-lg bg-wireframe-accent border-2 border-neutral-200">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 mb-2">Labour Law (BCEA)</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">DOB</label>
              <DateInput value={dateOfBirth} onChange={setDateOfBirth} ariaLabel="Date of birth" pastOnly showToday={false} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">Gender</label>
              <select value={gender} onChange={(e) => setGender(e.target.value)} className="input-compact">
                <option value="">Select gender</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">Marital status</label>
              <select value={maritalStatus} onChange={(e) => setMaritalStatus(e.target.value)} className="input-compact">
                <option value="">Select marital status</option>
                <option value="single">Single</option>
                <option value="married">Married</option>
                <option value="divorced">Divorced</option>
                <option value="widowed">Widowed</option>
              </select>
            </div>
            <input placeholder="Physical address" value={physicalAddress} onChange={(e) => setPhysicalAddress(e.target.value)} className="input-compact sm:col-span-2" />
            <input placeholder="Postal address" value={postalAddress} onChange={(e) => setPostalAddress(e.target.value)} className="input-compact" />
            <input placeholder="Postal code" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="input-compact" />
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">Commencement</label>
              <DateInput value={commencementDate} onChange={setCommencementDate} ariaLabel="Commencement" />
            </div>
            <input placeholder="Occupation" value={occupation} onChange={(e) => setOccupation(e.target.value)} className="input-compact" />
            <input placeholder="Place of work" value={placeOfWork} onChange={(e) => setPlaceOfWork(e.target.value)} className="input-compact" />
            <input placeholder="Ordinary hours" value={ordinaryHours} onChange={(e) => setOrdinaryHours(e.target.value)} className="input-compact" />
            <input placeholder="Ordinary days" value={ordinaryDays} onChange={(e) => setOrdinaryDays(e.target.value)} className="input-compact" />
            <input type="number" step="0.01" min="0" placeholder="Overtime rate (R)" value={overtimeRate} onChange={(e) => setOvertimeRate(e.target.value)} className="input-compact" />
            <select value={payFrequency} onChange={(e) => setPayFrequency(e.target.value)} className="input-compact">
              <option value="">Pay frequency</option>
              <option value="weekly">Weekly</option>
              <option value="bi-weekly">Bi-weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <input placeholder="Leave entitlement" value={leaveEntitlement} onChange={(e) => setLeaveEntitlement(e.target.value)} className="input-compact" />
            <input placeholder="Notice period" value={noticePeriod} onChange={(e) => setNoticePeriod(e.target.value)} className="input-compact" />
            <input placeholder="Previous service" value={previousService} onChange={(e) => setPreviousService(e.target.value)} className="input-compact sm:col-span-2" />
          </div>
        </section>
        )}

        {activeTab === "bank" && (
        <section className="p-4 rounded-lg bg-wireframe-accent border-2 border-neutral-200">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 mb-1.5">Bank Details</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input placeholder="Tax number" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} className="input-compact py-1.5 text-sm" />
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-600 mb-0.5">Bank</label>
              <select
                value={SA_MAJOR_BANKS.includes(bankName) ? bankName : "Other"}
                onChange={(e) => setBankName(e.target.value === "Other" ? "" : e.target.value)}
                className="input-compact py-1.5 text-sm"
              >
                <option value="">Select bank</option>
                {SA_MAJOR_BANKS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
                <option value="Other">Other</option>
              </select>
            </div>
            {!SA_MAJOR_BANKS.includes(bankName) && (
              <input
                placeholder="Bank name (if Other)"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="input-compact py-1.5 text-sm sm:col-span-2"
              />
            )}
            <input placeholder="Account number" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} className="input-compact py-1.5 text-sm" />
            <input placeholder="Branch code" value={bankBranchCode} onChange={(e) => setBankBranchCode(e.target.value)} className="input-compact py-1.5 text-sm" />
          </div>
        </section>
        )}

        {activeTab === "psira" && (
        <section className="p-4 rounded-lg bg-wireframe-accent border-2 border-neutral-200">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 mb-2">PSIRA</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-600 mb-1">PSIRA <span className="text-red-600">*</span></label>
              <input placeholder="PSIRA number" value={psiraNumber} onChange={(e) => setPsiraNumber(e.target.value)} className="input-compact" required={employeeType === "security"} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">PSIRA expiry</label>
              <DateInput value={psiraExpiryDate} onChange={setPsiraExpiryDate} ariaLabel="PSIRA expiry" futureOnly />
            </div>
            <select value={securityServiceType} onChange={(e) => setSecurityServiceType(e.target.value)} className="input-compact sm:col-span-2">
              <option value="">Security service type</option>
              <option value="guarding">Guarding / Patrolling</option>
              <option value="close_protection">Close protection / Bodyguard</option>
              <option value="reaction">Reaction / Response</option>
              <option value="control_room">Control room / Monitoring</option>
              <option value="other">Other</option>
            </select>
            <input placeholder="Next of kin 1 – Name" value={nextOfKin1Name} onChange={(e) => setNextOfKin1Name(e.target.value)} className="input-compact" />
            <input placeholder="Next of kin 1 – Phone" value={nextOfKin1Phone} onChange={(e) => setNextOfKin1Phone(e.target.value)} className="input-compact" />
            <input placeholder="Next of kin 2 – Name" value={nextOfKin2Name} onChange={(e) => setNextOfKin2Name(e.target.value)} className="input-compact" />
            <input placeholder="Next of kin 2 – Phone" value={nextOfKin2Phone} onChange={(e) => setNextOfKin2Phone(e.target.value)} className="input-compact" />
            <input placeholder="Next of kin 3 – Name" value={nextOfKin3Name} onChange={(e) => setNextOfKin3Name(e.target.value)} className="input-compact" />
            <input placeholder="Next of kin 3 – Phone" value={nextOfKin3Phone} onChange={(e) => setNextOfKin3Phone(e.target.value)} className="input-compact" />
            <div className="sm:col-span-2 p-4 rounded-lg border-2 border-neutral-200 bg-white space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-600 mb-1">Declaration</p>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={residedOutsideSA === true} onChange={(e) => setResidedOutsideSA(e.target.checked ? true : "")} className="w-3.5 h-3.5 rounded-sm border-2 border-neutral-200 accent-neutral-900" />
                Resided outside SA 1+ year (last 10 years)
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={militaryPoliceService === true} onChange={(e) => setMilitaryPoliceService(e.target.checked ? true : "")} className="w-3.5 h-3.5 rounded-sm border-2 border-neutral-200 accent-neutral-900" />
                Military / Police / Intelligence
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={criminalInvestigation === true} onChange={(e) => setCriminalInvestigation(e.target.checked ? true : "")} className="w-3.5 h-3.5 rounded-sm border-2 border-neutral-200 accent-neutral-900" />
                Criminal investigation pending
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={mentallyUnstable === true} onChange={(e) => setMentallyUnstable(e.target.checked ? true : "")} className="w-3.5 h-3.5 rounded-sm border-2 border-neutral-200 accent-neutral-900" />
                Ever declared mentally unstable
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={trainingCompleted === true} onChange={(e) => setTrainingCompleted(e.target.checked ? true : "")} className="w-3.5 h-3.5 rounded-sm border-2 border-neutral-200 accent-neutral-900" />
                Accredited training completed
              </label>
            </div>
          </div>
        </section>
        )}
      </div>

      <div className="mt-4 pt-4 border-t-2 border-neutral-200">
        <button type="submit" disabled={submitting} className="btn-primary text-sm py-2">
          {submitting ? "Saving..." : "Save team member"}
        </button>
      </div>
    </form>
  );
}

function EditModal({
  employeeId,
  token,
  defaultPlaceOfWork,
  canDeleteEmployees,
  onClose,
  onSuccess,
}: {
  employeeId: string;
  token: string;
  defaultPlaceOfWork?: string;
  canDeleteEmployees: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [employeeType, setEmployeeType] = useState<"office" | "security">("security");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [monthlySalary, setMonthlySalary] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [physicalAddress, setPhysicalAddress] = useState("");
  const [postalAddress, setPostalAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankBranchCode, setBankBranchCode] = useState("");
  const [commencementDate, setCommencementDate] = useState("");
  const [occupation, setOccupation] = useState("");
  const [placeOfWork, setPlaceOfWork] = useState("");
  const [ordinaryHours, setOrdinaryHours] = useState("");
  const [ordinaryDays, setOrdinaryDays] = useState("");
  const [overtimeRate, setOvertimeRate] = useState("");
  const [payFrequency, setPayFrequency] = useState("");
  const [leaveEntitlement, setLeaveEntitlement] = useState("");
  const [noticePeriod, setNoticePeriod] = useState("");
  const [previousService, setPreviousService] = useState("");

  const [psiraNumber, setPsiraNumber] = useState("");
  const [psiraExpiryDate, setPsiraExpiryDate] = useState("");
  const [securityServiceType, setSecurityServiceType] = useState("");
  const [nextOfKin1Name, setNextOfKin1Name] = useState("");
  const [nextOfKin1Phone, setNextOfKin1Phone] = useState("");
  const [nextOfKin2Name, setNextOfKin2Name] = useState("");
  const [nextOfKin2Phone, setNextOfKin2Phone] = useState("");
  const [nextOfKin3Name, setNextOfKin3Name] = useState("");
  const [nextOfKin3Phone, setNextOfKin3Phone] = useState("");
  const [residedOutsideSA, setResidedOutsideSA] = useState<boolean | "">("");
  const [militaryPoliceService, setMilitaryPoliceService] = useState<boolean | "">("");
  const [criminalInvestigation, setCriminalInvestigation] = useState<boolean | "">("");
  const [mentallyUnstable, setMentallyUnstable] = useState<boolean | "">("");
  const [trainingCompleted, setTrainingCompleted] = useState<boolean | "">("");
  const [activeTab, setActiveTab] = useState<"basic" | "labour" | "bank" | "psira">("basic");

  useEffect(() => {
    authFetch(`/employees/${employeeId}`, token)
      .then((r) => r.json())
      .then((emp) => {
        setEmployeeType((emp.employeeType || "security") as "office" | "security");
        setEmployeeNumber(emp.employeeNumber || "");
        setFirstName(emp.firstName);
        setLastName(emp.lastName);
        setIdNumber(emp.idNumber || "");
        setPhone(emp.phone || "");
        setEmail(emp.email || "");
        setMonthlySalary(emp.monthlySalary != null ? String(emp.monthlySalary) : "");
        setGradeId(emp.gradeId || "");
        setGroupId(emp.groupId || "");
        setDateOfBirth(toDateStr(emp.dateOfBirth));
        setGender(emp.gender || "");
        setMaritalStatus(emp.maritalStatus || "");
        setPhysicalAddress(emp.physicalAddress || "");
        setPostalAddress(emp.postalAddress || "");
        setPostalCode(emp.postalCode || "");
        setTaxNumber(emp.taxNumber || "");
        setBankName(emp.bankName || "");
        setBankAccountNumber(emp.bankAccountNumber || "");
        setBankBranchCode(emp.bankBranchCode || "");
        setCommencementDate(toDateStr(emp.commencementDate));
        setOccupation(emp.occupation || "");
        setPlaceOfWork(emp.placeOfWork || defaultPlaceOfWork || "");
        setOrdinaryHours(emp.ordinaryHours || "");
        setOrdinaryDays(emp.ordinaryDays || "");
        setOvertimeRate(emp.overtimeRate != null ? String(emp.overtimeRate) : "");
        setPayFrequency(emp.payFrequency || "");
        setLeaveEntitlement(emp.leaveEntitlement || "");
        setNoticePeriod(emp.noticePeriod || "");
        setPreviousService(emp.previousService || "");
        setPsiraNumber(emp.psiraNumber || "");
        setPsiraExpiryDate(toDateStr(emp.psiraExpiryDate));
        setSecurityServiceType(emp.securityServiceType || "");
        setNextOfKin1Name(emp.nextOfKin1Name || "");
        setNextOfKin1Phone(emp.nextOfKin1Phone || "");
        setNextOfKin2Name(emp.nextOfKin2Name || "");
        setNextOfKin2Phone(emp.nextOfKin2Phone || "");
        setNextOfKin3Name(emp.nextOfKin3Name || "");
        setNextOfKin3Phone(emp.nextOfKin3Phone || "");
        setResidedOutsideSA(emp.residedOutsideSA ?? "");
        setMilitaryPoliceService(emp.militaryPoliceService ?? "");
        setCriminalInvestigation(emp.criminalInvestigation ?? "");
        setMentallyUnstable(emp.mentallyUnstable ?? "");
        setTrainingCompleted(emp.trainingCompleted ?? "");
      })
      .catch(() => setError("Failed to load team member"))
      .finally(() => setLoading(false));
  }, [employeeId, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (employeeType === "security" && !psiraNumber.trim()) {
      setActiveTab("psira");
      setError("PSIRA number is required for security guards. Enter it on the PSIRA tab.");
      return;
    }
    if (employeeType === "security" && !gradeId) {
      setActiveTab("basic");
      setError("Pay grade is required for security guards. Choose one on the Basic details tab.");
      return;
    }
    if (!groupId) {
      setActiveTab("basic");
      setError("Every team member needs a group. Choose one on the Basic details tab.");
      return;
    }
    if (employeeType === "office" && (!monthlySalary || parseFloat(monthlySalary) <= 0)) {
      setActiveTab("basic");
      setError("Monthly salary is required for office staff. Enter it on the Basic details tab.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        employeeNumber: employeeNumber.trim() || undefined,
        firstName,
        lastName,
        idNumber: idNumber || undefined,
        phone: phone.trim() === "" ? "" : phone.trim() || undefined,
        email: email || undefined,
        hourlyRate: employeeType === "office" ? null : undefined,
        monthlySalary: employeeType === "office" && monthlySalary ? parseFloat(monthlySalary) : employeeType === "security" ? null : undefined,
        gradeId: employeeType === "security" ? gradeId : null,
        groupId,
        employeeType,
        dateOfBirth: dateOfBirth || undefined,
        gender: gender || undefined,
        maritalStatus: maritalStatus || undefined,
        physicalAddress: physicalAddress || undefined,
        postalAddress: postalAddress || undefined,
        postalCode: postalCode || undefined,
        taxNumber: taxNumber || undefined,
        bankName: bankName || undefined,
        bankAccountNumber: bankAccountNumber || undefined,
        bankBranchCode: bankBranchCode || undefined,
        commencementDate: commencementDate || undefined,
        occupation: occupation || undefined,
        placeOfWork: placeOfWork || undefined,
        ordinaryHours: ordinaryHours || undefined,
        ordinaryDays: ordinaryDays || undefined,
        overtimeRate: overtimeRate ? parseFloat(overtimeRate) : undefined,
        payFrequency: payFrequency || undefined,
        leaveEntitlement: leaveEntitlement || undefined,
        noticePeriod: noticePeriod || undefined,
        previousService: previousService || undefined,
        psiraNumber: psiraNumber || undefined,
        psiraExpiryDate: psiraExpiryDate || undefined,
        securityServiceType: securityServiceType || undefined,
        nextOfKin1Name: nextOfKin1Name || undefined,
        nextOfKin1Phone: nextOfKin1Phone || undefined,
        nextOfKin2Name: nextOfKin2Name || undefined,
        nextOfKin2Phone: nextOfKin2Phone || undefined,
        nextOfKin3Name: nextOfKin3Name || undefined,
        nextOfKin3Phone: nextOfKin3Phone || undefined,
        residedOutsideSA: residedOutsideSA === "" ? undefined : residedOutsideSA,
        militaryPoliceService: militaryPoliceService === "" ? undefined : militaryPoliceService,
        criminalInvestigation: criminalInvestigation === "" ? undefined : criminalInvestigation,
        mentallyUnstable: mentallyUnstable === "" ? undefined : mentallyUnstable,
        trainingCompleted: trainingCompleted === "" ? undefined : trainingCompleted,
      };
      const res = await authFetch(`/employees/${employeeId}`, token, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        const msg = data?.message?.psiraNumber?.[0] ?? data?.message?.gradeId?.[0] ?? data?.message?.groupId?.[0] ?? data?.message?.monthlySalary?.[0] ?? data?.message?.employeeNumber?.[0] ?? data?.message ?? "Failed to update";
        throw new Error(typeof msg === "string" ? msg : "Failed to update");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update team member");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      {confirmDialog}
      <div className="card-elevated w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b-2 border-neutral-200 shrink-0 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-neutral-900">Edit Team Member</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-[10px] text-black hover:bg-neutral-100 border-2 border-transparent hover:border-security-navy-300 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-neutral-500">Loading...</div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[calc(90vh-180px)] space-y-6">
            {error && (
              <div className="p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md">
                {error}
              </div>
            )}

            <section className="p-4 rounded-lg bg-wireframe-accent border-2 border-neutral-200">
              <h4 className="text-sm font-semibold text-neutral-700 mb-3">Staff type</h4>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="editStaffType"
                    value="office"
                    checked={employeeType === "office"}
                    onChange={() => setEmployeeType("office")}
                    className="w-4 h-4"
                  />
                  <span className="font-medium">Office Staff</span>
                  <span className="text-sm text-neutral-500">(monthly salary)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="editStaffType"
                    value="security"
                    checked={employeeType === "security"}
                    onChange={() => setEmployeeType("security")}
                    className="w-4 h-4"
                  />
                  <span className="font-medium">Guard</span>
                  <span className="text-sm text-neutral-500">(hourly rate)</span>
                </label>
              </div>
            </section>

            <div className="flex gap-1 border-b-2 border-neutral-200 overflow-x-auto">
              {(["basic", "labour", "psira", "bank"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={clsx(
                    "px-4 py-2.5 text-sm font-medium rounded-t-sm transition-colors -mb-px",
                      activeTab === tab
                        ? "bg-white text-neutral-800 border-2 border-neutral-200 border-b-transparent"
                      : "text-neutral-600 hover:text-neutral-900"
                  )}
                >
                  {tab === "basic" ? "Basic details" : tab === "labour" ? "Employment (BCEA)" : tab === "bank" ? "Bank & tax" : "PSIRA"}
                </button>
              ))}
            </div>

            {activeTab === "basic" && (
            <section>
              <h4 className="text-sm font-semibold text-neutral-700 mb-3">Basic Information</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <input
                  placeholder="Team Member ID *"
                  value={employeeNumber}
                  onChange={(e) => setEmployeeNumber(e.target.value)}
                  required
                  className="input-modern"
                  title="Unique ID – must not match any other team member"
                />
                <input placeholder="First name *" value={firstName} onChange={(e) => setFirstName(e.target.value)} required className="input-modern" />
                <input placeholder="Last name *" value={lastName} onChange={(e) => setLastName(e.target.value)} required className="input-modern" />
                <input
                  placeholder="ID number (13-digit RSA ID)"
                  value={idNumber}
                  onChange={(e) => {
                    const v = e.target.value;
                    setIdNumber(v);
                    const parsed = parseSAIdNumber(v);
                    if (parsed) {
                      setDateOfBirth(parsed.dateOfBirth ?? "");
                      if (parsed.gender) setGender(parsed.gender);
                    }
                  }}
                  className="input-modern"
                  title="Enter 13-digit SA ID – date of birth and gender will auto-fill"
                />
                <div>
                  <input placeholder="Phone (e.g. 0821234567 or +27821234567)" value={phone} onChange={(e) => setPhone(e.target.value)} className="input-modern" title="WhatsApp number for clock-in, payslip, etc." />
                  <p className="text-xs text-neutral-500 mt-0.5">Saved in WhatsApp-compatible format for clock-in, payslip, and leave commands.</p>
                </div>
                <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-modern" />
                {employeeType === "office" ? (
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Monthly salary (R) *"
                    value={monthlySalary}
                    onChange={(e) => setMonthlySalary(e.target.value)}
                    className="input-modern"
                    required
                  />
                ) : (
                  <PayGradeSelect token={token} value={gradeId} onChange={setGradeId} groupId={groupId} required />
                )}
                <GroupSelect token={token} value={groupId} onChange={setGroupId} required />
              </div>
            </section>
            )}

            {activeTab === "labour" && (
            <section>
              <h4 className="text-sm font-semibold text-neutral-700 mb-3">Labour Law (BCEA)</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-neutral-600">Date of birth</label>
                  <DateInput value={dateOfBirth} onChange={setDateOfBirth} className="input-modern" ariaLabel="Date of birth" pastOnly showToday={false} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-neutral-600">Gender</label>
                  <select value={gender} onChange={(e) => setGender(e.target.value)} className="input-modern">
                    <option value="">Select gender</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-neutral-600">Marital status</label>
                  <select value={maritalStatus} onChange={(e) => setMaritalStatus(e.target.value)} className="input-modern">
                    <option value="">Select marital status</option>
                    <option value="single">Single</option>
                    <option value="married">Married</option>
                    <option value="divorced">Divorced</option>
                    <option value="widowed">Widowed</option>
                  </select>
                </div>
                <input placeholder="Physical address" value={physicalAddress} onChange={(e) => setPhysicalAddress(e.target.value)} className="input-modern sm:col-span-2" />
                <input placeholder="Postal address" value={postalAddress} onChange={(e) => setPostalAddress(e.target.value)} className="input-modern" />
                <input placeholder="Postal code" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="input-modern" />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-neutral-600">Employment commencement date</label>
                  <DateInput value={commencementDate} onChange={setCommencementDate} className="input-modern" ariaLabel="Commencement" />
                </div>
                <input placeholder="Occupation" value={occupation} onChange={(e) => setOccupation(e.target.value)} className="input-modern" />
                <input placeholder="Place of work" value={placeOfWork} onChange={(e) => setPlaceOfWork(e.target.value)} className="input-modern" />
                <input placeholder="Ordinary hours" value={ordinaryHours} onChange={(e) => setOrdinaryHours(e.target.value)} className="input-modern" />
                <input placeholder="Ordinary days" value={ordinaryDays} onChange={(e) => setOrdinaryDays(e.target.value)} className="input-modern" />
                <input type="number" step="0.01" min="0" placeholder="Overtime rate (R)" value={overtimeRate} onChange={(e) => setOvertimeRate(e.target.value)} className="input-modern" />
                <select value={payFrequency} onChange={(e) => setPayFrequency(e.target.value)} className="input-modern">
                  <option value="">Pay frequency</option>
                  <option value="weekly">Weekly</option>
                  <option value="bi-weekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <input placeholder="Leave entitlement" value={leaveEntitlement} onChange={(e) => setLeaveEntitlement(e.target.value)} className="input-modern" />
                <input placeholder="Notice period" value={noticePeriod} onChange={(e) => setNoticePeriod(e.target.value)} className="input-modern" />
                <input placeholder="Previous service" value={previousService} onChange={(e) => setPreviousService(e.target.value)} className="input-modern sm:col-span-2" />
              </div>
            </section>
            )}

            {activeTab === "bank" && (
            <section className="p-4 rounded-lg bg-wireframe-accent border-2 border-neutral-200">
              <h4 className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 mb-1.5">Bank Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input placeholder="Tax number" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} className="input-modern py-2 text-sm" />
                <div>
                  <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-600 mb-0.5">Bank</label>
                  <select
                    value={SA_MAJOR_BANKS.includes(bankName) ? bankName : "Other"}
                    onChange={(e) => setBankName(e.target.value === "Other" ? "" : e.target.value)}
                    className="input-modern py-2 text-sm"
                  >
                    <option value="">Select bank</option>
                    {SA_MAJOR_BANKS.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                    <option value="Other">Other</option>
                  </select>
                </div>
                {!SA_MAJOR_BANKS.includes(bankName) && (
                  <input
                    placeholder="Bank name (if Other)"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    className="input-modern py-2 text-sm sm:col-span-2"
                  />
                )}
                <input placeholder="Account number" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} className="input-modern py-2 text-sm" />
                <input placeholder="Branch code" value={bankBranchCode} onChange={(e) => setBankBranchCode(e.target.value)} className="input-modern py-2 text-sm" />
              </div>
            </section>
            )}

            {activeTab === "psira" && (
            <section>
              <h4 className="text-sm font-semibold text-neutral-700 mb-3">PSIRA – Security Staff</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-600 mb-1">PSIRA number <span className="text-red-600">*</span></label>
                  <input placeholder="PSIRA number" value={psiraNumber} onChange={(e) => setPsiraNumber(e.target.value)} className="input-modern" required={employeeType === "security"} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-neutral-600">PSIRA expiry</label>
                  <DateInput value={psiraExpiryDate} onChange={setPsiraExpiryDate} className="input-modern" ariaLabel="PSIRA expiry" futureOnly />
                </div>
                <select value={securityServiceType} onChange={(e) => setSecurityServiceType(e.target.value)} className="input-modern sm:col-span-2">
                  <option value="">Nature of security service</option>
                  <option value="guarding">Guarding / Patrolling</option>
                  <option value="close_protection">Close protection / Bodyguard</option>
                  <option value="reaction">Reaction / Response</option>
                  <option value="control_room">Control room / Monitoring</option>
                  <option value="other">Other</option>
                </select>
                <input placeholder="Next of kin 1 – Name" value={nextOfKin1Name} onChange={(e) => setNextOfKin1Name(e.target.value)} className="input-modern" />
                <input placeholder="Next of kin 1 – Phone" value={nextOfKin1Phone} onChange={(e) => setNextOfKin1Phone(e.target.value)} className="input-modern" />
                <input placeholder="Next of kin 2 – Name" value={nextOfKin2Name} onChange={(e) => setNextOfKin2Name(e.target.value)} className="input-modern" />
                <input placeholder="Next of kin 2 – Phone" value={nextOfKin2Phone} onChange={(e) => setNextOfKin2Phone(e.target.value)} className="input-modern" />
                <input placeholder="Next of kin 3 – Name" value={nextOfKin3Name} onChange={(e) => setNextOfKin3Name(e.target.value)} className="input-modern" />
                <input placeholder="Next of kin 3 – Phone" value={nextOfKin3Phone} onChange={(e) => setNextOfKin3Phone(e.target.value)} className="input-modern" />
                <div className="sm:col-span-2 space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={residedOutsideSA === true} onChange={(e) => setResidedOutsideSA(e.target.checked ? true : "")} />
                    Resided outside SA 1+ year in last 10 years
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={militaryPoliceService === true} onChange={(e) => setMilitaryPoliceService(e.target.checked ? true : "")} />
                    Military / Police / Intelligence service
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={criminalInvestigation === true} onChange={(e) => setCriminalInvestigation(e.target.checked ? true : "")} />
                    Criminal investigation pending
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={mentallyUnstable === true} onChange={(e) => setMentallyUnstable(e.target.checked ? true : "")} />
                    Ever declared mentally unstable
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={trainingCompleted === true} onChange={(e) => setTrainingCompleted(e.target.checked ? true : "")} />
                    Accredited training completed
                  </label>
                </div>
              </div>
            </section>
            )}

            <div className={clsx("flex gap-3 pt-2", !canDeleteEmployees && "flex-wrap")}>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 btn-primary">
                {saving ? "Saving..." : "Save changes"}
              </button>
              {canDeleteEmployees && (
                <button
                  type="button"
                  onClick={async () => {
                    const confirmed = await confirm({
                      title: "Delete team member permanently?",
                      message: `This permanently deletes ${firstName} ${lastName} from the system.`,
                      confirmLabel: "Delete team member",
                    });
                    if (!confirmed) return;
                    setError("");
                    setDeleting(true);
                    try {
                      const res = await authFetch(`/employees/${employeeId}`, token, { method: "DELETE" });
                      if (!res.ok) {
                        const data = await res.json();
                        throw new Error(data?.message || data?.error || "Failed to delete");
                      }
                      onSuccess();
                      onClose();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to delete team member");
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  disabled={deleting}
                  className="flex-1 btn-destructive"
                >
                  {deleting ? "Deleting..." : "Delete team member"}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function StatusModal({
  employee,
  token,
  onClose,
  onSuccess,
}: {
  employee: Employee;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedStatus, setSelectedStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const validNext = VALID_TRANSITIONS[employee.status] || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStatus) return;
    setError("");
    setSaving(true);
    try {
      const res = await authFetch(`/employees/${employee.id}/status`, token, {
        method: "POST",
        body: JSON.stringify({ status: selectedStatus }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Invalid transition");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  if (validNext.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="card-wireframe w-full max-w-sm p-6 shadow-xl">
          <p className="text-neutral-600">No status transitions available for offboarded team members.</p>
          <button onClick={onClose} className="mt-4 btn-primary w-full">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="card-wireframe w-full max-w-sm shadow-xl">
        <div className="p-6 border-b-2 border-neutral-200">
          <h3 className="text-lg font-semibold text-neutral-900">Change employment status</h3>
          <p className="text-sm text-neutral-500 mt-1">
            {employee.firstName} {employee.lastName}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="mb-4 p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}
          <p className="text-sm text-neutral-600 mb-3">
            Current: <span className={`badge ${statusColors[employee.status]}`}>{employee.status}</span>
          </p>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            required
            className="input-modern mb-4"
          >
            <option value="">Select new status</option>
            {validNext.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 btn-primary">
              {saving ? "Updating..." : "Update status"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
