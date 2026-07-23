"use client";

import { ContractExpiryIndicator } from "./ContractExpiryIndicator";
import { InstructorComplianceBadge } from "./InstructorComplianceBadge";
import { InstructorStatusBadge } from "./InstructorStatusBadge";
import type { InstructorRecord } from "./types";

type RowAction =
  | "view"
  | "edit"
  | "upload_documents"
  | "assign_courses"
  | "assign_branch"
  | "renew_contract"
  | "archive"
  | "delete";

const ACTIONS: Array<{ value: RowAction; label: string }> = [
  { value: "view", label: "View" },
  { value: "edit", label: "Edit" },
  { value: "upload_documents", label: "Upload Documents" },
  { value: "assign_courses", label: "Assign Courses" },
  { value: "assign_branch", label: "Assign Branch" },
  { value: "renew_contract", label: "Renew Contract" },
  { value: "archive", label: "Archive" },
  { value: "delete", label: "Delete" },
];

function initials(name: string): string {
  const bits = name.trim().split(/\s+/).filter(Boolean);
  if (!bits.length) return "IN";
  return `${bits[0]?.[0] ?? ""}${bits[1]?.[0] ?? bits[0]?.[1] ?? ""}`.toUpperCase();
}

function certificateBadge(status: string | null | undefined) {
  const normalized = (status ?? "missing").toString();
  if (normalized === "valid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (normalized === "expiring_soon") return "border-amber-200 bg-amber-50 text-amber-700";
  if (normalized === "expired") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function certificateLabel(status: string | null | undefined): string {
  const normalized = (status ?? "missing").toString();
  if (normalized === "valid") return "Valid";
  if (normalized === "expiring_soon") return "Expiring Soon";
  if (normalized === "expired") return "Expired";
  return "Missing";
}

export function InstructorTable({
  rows,
  loading,
  selectedIds,
  allowedActions,
  onToggleSelect,
  onToggleSelectAll,
  onRowClick,
  onAction,
}: {
  rows: InstructorRecord[];
  loading: boolean;
  selectedIds: Set<string>;
  allowedActions: RowAction[];
  onToggleSelect: (id: string, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onRowClick: (id: string) => void;
  onAction: (id: string, action: RowAction) => void;
}) {
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));

  return (
    <div className="space-y-3">
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:block">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-neutral-500">
                <th className="w-8">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-neutral-300 text-security-navy-600 focus:ring-security-navy-500 rounded-md"
                    aria-label="Select all instructors"
                    checked={allSelected}
                    onChange={(e) => onToggleSelectAll(e.target.checked)}
                  />
                </th>
                <th>Instructor</th>
                <th>PSIRA Instructor No.</th>
                <th>ID Number</th>
                <th>Qualification / Grade</th>
                <th>Assigned Branch</th>
                <th>Assigned Courses</th>
                <th>Contract End Date</th>
                <th>Certificate Status</th>
                <th>Compliance Status</th>
                <th>Status</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13} className="py-10 text-center text-sm text-neutral-500">
                    Loading instructors...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-10 text-center text-sm text-neutral-500">
                    No instructors match the selected filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="cursor-pointer hover:bg-slate-50/70" onClick={() => onRowClick(row.id)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-neutral-300 text-security-navy-600 focus:ring-security-navy-500 rounded-md"
                        aria-label={`Select ${row.fullName}`}
                        checked={selectedIds.has(row.id)}
                        onChange={(e) => onToggleSelect(row.id, e.target.checked)}
                      />
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                          {initials(row.fullName)}
                        </div>
                        <div>
                          <div className="font-medium text-security-navy-900">{row.fullName}</div>
                          <div className="text-xs text-neutral-600">
                            {row.email || "No email"} · {row.phone || "No phone"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{row.psiraInstructorNumber || "—"}</td>
                    <td>{row.idNumber || "—"}</td>
                    <td>
                      <div className="text-xs">
                        <div>{row.qualification || "—"}</div>
                        <div className="text-neutral-500">{row.instructorGrade || "—"}</div>
                      </div>
                    </td>
                    <td>{row.assignedBranch?.name || "—"}</td>
                    <td>
                      <div className="max-w-[220px] text-xs text-neutral-700">
                        {row.assignedCourses.length
                          ? row.assignedCourses
                              .slice(0, 2)
                              .map((course) => course.code || course.title)
                              .join(", ")
                          : "—"}
                        {row.assignedCourses.length > 2 ? ` +${row.assignedCourses.length - 2}` : ""}
                      </div>
                    </td>
                    <td>
                      <ContractExpiryIndicator
                        contractEndDate={row.contractEndDate}
                        daysRemaining={row.contractDaysRemaining}
                      />
                    </td>
                    <td>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${certificateBadge(row.certificateStatus)}`}
                      >
                        {certificateLabel(row.certificateStatus)}
                      </span>
                    </td>
                    <td>
                      <InstructorComplianceBadge status={row.complianceStatusComputed} />
                    </td>
                    <td>
                      <InstructorStatusBadge status={row.archivedAt ? "archived" : row.status} />
                    </td>
                    <td className="text-xs text-neutral-600">
                      {new Date(row.updatedAt).toLocaleDateString()}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select
                        className="input-compact text-xs w-40 rounded-lg"
                        aria-label={`Actions for ${row.fullName}`}
                        value=""
                        onChange={(e) => {
                          const value = e.target.value as RowAction;
                          if (!value) return;
                          onAction(row.id, value);
                          e.currentTarget.value = "";
                        }}
                      >
                        <option value="">Actions...</option>
                        {ACTIONS.filter((action) => allowedActions.includes(action.value)).map((action) => (
                          <option key={action.value} value={action.value}>
                            {action.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3 lg:hidden">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-neutral-600 shadow-sm">
            Loading instructors...
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-neutral-600 shadow-sm">
            No instructors match the selected filters.
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              onClick={() => onRowClick(row.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-neutral-300 text-security-navy-600 focus:ring-security-navy-500 rounded-md"
                    aria-label={`Select ${row.fullName}`}
                    checked={selectedIds.has(row.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onToggleSelect(row.id, e.target.checked)}
                  />
                  <div>
                    <div className="font-medium text-security-navy-900">{row.fullName}</div>
                    <div className="text-xs text-neutral-600">{row.psiraInstructorNumber || "No PSIRA number"}</div>
                  </div>
                </div>
                <InstructorStatusBadge status={row.archivedAt ? "archived" : row.status} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-neutral-500">Branch</span>
                  <div>{row.assignedBranch?.name || "—"}</div>
                </div>
                <div>
                  <span className="text-neutral-500">Courses</span>
                  <div>{row.assignedCourses.length || 0}</div>
                </div>
                <div className="col-span-2">
                  <ContractExpiryIndicator
                    contractEndDate={row.contractEndDate}
                    daysRemaining={row.contractDaysRemaining}
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <InstructorComplianceBadge status={row.complianceStatusComputed} />
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${certificateBadge(row.certificateStatus)}`}
                >
                  {certificateLabel(row.certificateStatus)}
                </span>
              </div>
              <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                <select
                  className="input-compact w-full rounded-xl"
                  aria-label={`Actions for ${row.fullName}`}
                  value=""
                  onChange={(e) => {
                    const value = e.target.value as RowAction;
                    if (!value) return;
                    onAction(row.id, value);
                    e.currentTarget.value = "";
                  }}
                >
                  <option value="">Row actions...</option>
                  {ACTIONS.filter((action) => allowedActions.includes(action.value)).map((action) => (
                    <option key={action.value} value={action.value}>
                      {action.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export type { RowAction };
