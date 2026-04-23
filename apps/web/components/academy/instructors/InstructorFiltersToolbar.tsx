"use client";

import type { InstructorBranchOption, InstructorCourseOption, InstructorFilters } from "./types";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest Added" },
  { value: "oldest", label: "Oldest Added" },
  { value: "name_asc", label: "Name A-Z" },
  { value: "name_desc", label: "Name Z-A" },
  { value: "contract_expiry_soonest", label: "Contract Expiry Soonest" },
  { value: "updated_desc", label: "Most Recently Updated" },
  { value: "compliance_risk_highest", label: "Compliance Risk Highest" },
];

interface Props {
  filters: InstructorFilters;
  branches: InstructorBranchOption[];
  courses: InstructorCourseOption[];
  compact?: boolean;
  rowStyle?: boolean;
  onChange: (next: Partial<InstructorFilters>) => void;
  onReset: () => void;
}

export function InstructorFiltersToolbar({
  filters,
  branches,
  courses,
  compact = false,
  rowStyle = false,
  onChange,
  onReset,
}: Props) {
  if (rowStyle) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white/90 p-2 shadow-sm">
        <div className="overflow-x-auto">
          <div className="flex min-w-[980px] items-center gap-2 xl:min-w-0">
            <input
              className="input input-bordered input-sm w-64 min-w-[16rem] rounded-lg"
              placeholder="Search name, PSIRA, ID, email, phone"
              value={filters.search}
              onChange={(e) => onChange({ search: e.target.value })}
            />
            <CompactSelect
              value={filters.status}
              onChange={(value) => onChange({ status: value })}
              options={[
                { value: "", label: "Status: All" },
                { value: "active", label: "Status: Active" },
                { value: "inactive", label: "Status: Inactive" },
                { value: "suspended", label: "Status: Suspended" },
                { value: "contract_ended", label: "Status: Contract Ended" },
                { value: "archived", label: "Status: Archived" },
              ]}
            />
            <CompactSelect
              value={filters.complianceStatus}
              onChange={(value) => onChange({ complianceStatus: value })}
              options={[
                { value: "", label: "Compliance: All" },
                { value: "compliant", label: "Compliant" },
                { value: "missing_contract", label: "Missing Contract" },
                { value: "missing_certificate", label: "Missing Certificate" },
                { value: "expired_contract", label: "Expired Contract" },
                { value: "expired_certificate", label: "Expired Certificate" },
                { value: "pending_review", label: "Pending Review" },
                { value: "attention_needed", label: "Attention Needed" },
                { value: "high_risk", label: "High Risk" },
              ]}
            />
            <CompactSelect
              value={filters.contractExpiry}
              onChange={(value) => onChange({ contractExpiry: value })}
              options={[
                { value: "all", label: "Contract: All" },
                { value: "expiring_30", label: "Expiring in 30 days" },
                { value: "expired", label: "Expired" },
                { value: "valid", label: "Valid" },
              ]}
            />
            <CompactSelect
              value={filters.branchId}
              onChange={(value) => onChange({ branchId: value })}
              options={[{ value: "", label: "Branch: All" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
            />
            <CompactSelect
              value={filters.courseId}
              onChange={(value) => onChange({ courseId: value })}
              options={[
                { value: "", label: "Course: All" },
                ...courses.map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.title}` : c.title })),
              ]}
            />
            <CompactSelect value={filters.sort} onChange={(value) => onChange({ sort: value })} options={SORT_OPTIONS} />
            <button type="button" className="btn btn-ghost btn-sm rounded-lg" onClick={onReset}>
              Reset
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-[1.3fr_repeat(6,minmax(0,1fr))_auto]"}`}>
        <label className="w-full">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-base-content/60">
            Search
          </span>
          <input
            className="input input-bordered w-full rounded-xl"
            placeholder="Name, PSIRA no, ID no, email, phone"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
          />
        </label>

        <SelectField
          label="Status"
          value={filters.status}
          onChange={(value) => onChange({ status: value })}
          options={[
            { value: "", label: "All" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "suspended", label: "Suspended" },
            { value: "contract_ended", label: "Contract Ended" },
            { value: "archived", label: "Archived" },
          ]}
        />

        <SelectField
          label="Compliance"
          value={filters.complianceStatus}
          onChange={(value) => onChange({ complianceStatus: value })}
          options={[
            { value: "", label: "All" },
            { value: "compliant", label: "Compliant" },
            { value: "missing_contract", label: "Missing Contract" },
            { value: "missing_certificate", label: "Missing Certificate" },
            { value: "expired_contract", label: "Expired Contract" },
            { value: "expired_certificate", label: "Expired Certificate" },
            { value: "pending_review", label: "Pending Review" },
            { value: "attention_needed", label: "Attention Needed" },
            { value: "high_risk", label: "High Risk" },
          ]}
        />

        <SelectField
          label="Contract expiry"
          value={filters.contractExpiry}
          onChange={(value) => onChange({ contractExpiry: value })}
          options={[
            { value: "all", label: "All" },
            { value: "expiring_30", label: "Expiring in 30 days" },
            { value: "expired", label: "Expired" },
            { value: "valid", label: "Valid" },
          ]}
        />

        <SelectField
          label="Branch / Site"
          value={filters.branchId}
          onChange={(value) => onChange({ branchId: value })}
          options={[{ value: "", label: "All branches" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
        />

        <SelectField
          label="Course"
          value={filters.courseId}
          onChange={(value) => onChange({ courseId: value })}
          options={[
            { value: "", label: "All courses" },
            ...courses.map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.title}` : c.title })),
          ]}
        />

        <SelectField
          label="Sort"
          value={filters.sort}
          onChange={(value) => onChange({ sort: value })}
          options={SORT_OPTIONS}
        />

        <div className="flex items-end">
          <button type="button" className="btn btn-outline w-full rounded-xl" onClick={onReset}>
            Reset Filters
          </button>
        </div>
      </div>
    </div>
  );
}

function CompactSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <select className="select select-bordered select-sm min-w-36 rounded-lg" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.value || `opt-${option.label}`} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="w-full">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-base-content/60">{label}</span>
      <select className="select select-bordered w-full rounded-xl" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value || `opt-${option.label}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
