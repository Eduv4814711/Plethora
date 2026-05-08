"use client";

import { InstructorComplianceBadge } from "./InstructorComplianceBadge";
import { InstructorDocumentsManager } from "./InstructorDocumentsManager";
import { InstructorStatusBadge } from "./InstructorStatusBadge";
import { DateInput } from "@/components/date-input";
import type {
  InstructorAuditItem,
  InstructorBranchOption,
  InstructorCourseOption,
  InstructorDocument,
  InstructorFormErrors,
  InstructorFormState,
  InstructorRecord,
} from "./types";

export type InstructorDrawerMode = "create" | "view" | "edit";
export type InstructorDrawerTab =
  | "overview"
  | "personal"
  | "compliance"
  | "contract"
  | "assignments"
  | "documents"
  | "activity";

const TABS: Array<{ key: InstructorDrawerTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "personal", label: "Personal Info" },
  { key: "compliance", label: "PSIRA & Compliance" },
  { key: "contract", label: "Contract" },
  { key: "assignments", label: "Assignments" },
  { key: "documents", label: "Documents" },
  { key: "activity", label: "Activity Log" },
];

function complianceHealth(status: string | null | undefined): {
  label: string;
  cls: string;
} {
  if (status === "compliant") return { label: "Healthy", cls: "bg-emerald-500" };
  if (status === "attention_needed" || status === "pending_review") {
    return { label: "Watch", cls: "bg-amber-500" };
  }
  if (status === "high_risk") return { label: "Critical", cls: "bg-red-500" };
  return { label: "Pending", cls: "bg-slate-400" };
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function contractWarning(daysRemaining?: number | null): {
  tone: string;
  text: string;
} {
  if (daysRemaining == null) return { tone: "border-slate-200 bg-slate-50 text-slate-700", text: "Contract date missing" };
  if (daysRemaining < 0) return { tone: "border-red-200 bg-red-50 text-red-700", text: `Expired ${Math.abs(daysRemaining)} day(s) ago` };
  if (daysRemaining <= 30) return { tone: "border-amber-200 bg-amber-50 text-amber-700", text: `${daysRemaining} day(s) remaining` };
  return { tone: "border-emerald-200 bg-emerald-50 text-emerald-700", text: `${daysRemaining} day(s) remaining` };
}

export function InstructorDrawer({
  open,
  mode,
  activeTab,
  instructor,
  form,
  errors,
  branches,
  courses,
  documents,
  activity,
  saving,
  uploading,
  canEdit,
  canEditCompliance,
  canArchive,
  canDelete,
  canPermanentDelete,
  onClose,
  onTabChange,
  onFormChange,
  onStartEdit,
  onSave,
  onSaveDraft,
  onSuspend,
  onRenewContract,
  onArchive,
  onDelete,
  onUploadDocument,
  onReplaceDocument,
  onDeleteDocument,
  onMarkDocumentVerified,
}: {
  open: boolean;
  mode: InstructorDrawerMode;
  activeTab: InstructorDrawerTab;
  instructor: InstructorRecord | null;
  form: InstructorFormState;
  errors: InstructorFormErrors;
  branches: InstructorBranchOption[];
  courses: InstructorCourseOption[];
  documents: InstructorDocument[];
  activity: InstructorAuditItem[];
  saving: boolean;
  uploading: boolean;
  canEdit: boolean;
  canEditCompliance: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canPermanentDelete: boolean;
  onClose: () => void;
  onTabChange: (tab: InstructorDrawerTab) => void;
  onFormChange: (patch: Partial<InstructorFormState>) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onSaveDraft: () => void;
  onSuspend: () => void;
  onRenewContract: () => void;
  onArchive: () => void;
  onDelete: (permanent?: boolean) => void;
  onUploadDocument: (payload: {
    file: File;
    documentType: string;
    issueDate?: string;
    expiryDate?: string;
    notes?: string;
  }) => Promise<void>;
  onReplaceDocument: (document: InstructorDocument, file: File) => Promise<void>;
  onDeleteDocument: (documentId: string) => Promise<void>;
  onMarkDocumentVerified: (documentId: string) => Promise<void>;
}) {
  if (!open) return null;
  const editable = mode !== "view" && canEdit;
  const complianceEditable = editable && canEditCompliance;
  const health = complianceHealth(instructor?.complianceStatusComputed || form.complianceStatus);
  const warning = contractWarning(instructor?.contractDaysRemaining);

  const toggleCourse = (courseId: string) => {
    const selected = form.assignedCourseIds.includes(courseId);
    onFormChange({
      assignedCourseIds: selected
        ? form.assignedCourseIds.filter((id) => id !== courseId)
        : [...form.assignedCourseIds, courseId],
    });
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/35">
      <div className="ml-auto flex h-full w-full max-w-[980px] flex-col bg-white shadow-2xl">
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3 md:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-security-navy-900">
                {mode === "create" ? "Add Instructor" : instructor?.fullName || "Instructor details"}
              </h2>
              <p className="text-sm text-base-content/70">
                Manage accredited instructors, contracts, certificates, compliance, and assignments.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {mode === "view" && canEdit && (
                <button type="button" className="btn btn-outline btn-sm rounded-xl" onClick={onStartEdit}>
                  Edit
                </button>
              )}
              {editable && (
                <>
                  <button type="button" className="btn btn-ghost btn-sm rounded-xl" onClick={onSaveDraft} disabled={saving}>
                    Save Draft
                  </button>
                  <button type="button" className="btn btn-primary btn-sm rounded-xl" onClick={onSave} disabled={saving}>
                    {saving ? "Saving..." : mode === "create" ? "Create Instructor" : "Save Changes"}
                  </button>
                </>
              )}
              <button type="button" className="btn btn-ghost btn-sm rounded-xl" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto pb-1">
            <div className="flex min-w-max gap-1">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    activeTab === tab.key
                      ? "bg-security-navy-900 text-white"
                      : "bg-slate-100 text-base-content/80 hover:bg-slate-200"
                  }`}
                  onClick={() => onTabChange(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {activeTab === "overview" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-semibold text-security-navy-900">{instructor?.fullName || form.fullName || "New instructor"}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <InstructorStatusBadge status={instructor?.archivedAt ? "archived" : instructor?.status || form.status} />
                      <InstructorComplianceBadge
                        status={instructor?.complianceStatusComputed || form.complianceStatus || "pending_review"}
                      />
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${health.cls}`}>
                        {health.label}
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs text-base-content/80">
                    <div>PSIRA No: {instructor?.psiraInstructorNumber || form.psiraInstructorNumber || "—"}</div>
                    <div>Branch: {instructor?.assignedBranch?.name || branchName(form.assignedBranchId, branches) || "—"}</div>
                    <div>Courses: {instructor?.assignedCourses.length || form.assignedCourseIds.length || 0}</div>
                    <div>Contract End: {formatDate(instructor?.contractEndDate || form.contractEndDate)}</div>
                  </div>
                </div>
                <div className={`mt-3 rounded-xl border px-3 py-2 text-xs font-medium ${warning.tone}`}>
                  <span className={`inline-flex rounded-xl border px-2 py-1 text-xs ${warning.tone}`}>{warning.text}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {canEdit && (
                    <button type="button" className="btn btn-outline btn-sm rounded-xl" onClick={onStartEdit}>
                      Edit
                    </button>
                  )}
                  {canEditCompliance && (
                    <button type="button" className="btn btn-outline btn-sm rounded-xl" onClick={() => onTabChange("documents")}>
                      Upload Document
                    </button>
                  )}
                  {canEdit && (
                    <button type="button" className="btn btn-outline btn-sm rounded-xl" onClick={onRenewContract}>
                      Renew Contract
                    </button>
                  )}
                  {canArchive && (
                    <button type="button" className="btn btn-outline btn-sm rounded-xl" onClick={onSuspend}>
                      Suspend Instructor
                    </button>
                  )}
                  {canArchive && (
                    <button type="button" className="btn btn-outline btn-sm rounded-xl" onClick={onArchive}>
                      Archive Instructor
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "personal" && (
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                label="Full Name"
                value={form.fullName}
                onChange={(value) => onFormChange({ fullName: value })}
                disabled={!editable}
                error={errors.fullName}
                required
              />
              <SelectField
                label="Status"
                value={form.status}
                onChange={(value) => onFormChange({ status: value as InstructorFormState["status"] })}
                disabled={!editable}
                options={[
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                  { value: "suspended", label: "Suspended" },
                  { value: "contract_ended", label: "Contract Ended" },
                ]}
                error={errors.status}
                required
              />
              <TextField
                label="ID Number"
                value={form.idNumber}
                onChange={(value) => onFormChange({ idNumber: value })}
                disabled={!editable}
                error={errors.idNumber}
              />
              <TextField
                label="Phone"
                value={form.phone}
                onChange={(value) => onFormChange({ phone: value })}
                disabled={!editable}
                error={errors.phone}
                required
              />
              <TextField
                label="Email"
                value={form.email}
                onChange={(value) => onFormChange({ email: value })}
                disabled={!editable}
                error={errors.email}
              />
              <DateField
                label="Date of Birth"
                value={form.dateOfBirth}
                onChange={(value) => onFormChange({ dateOfBirth: value })}
                disabled={!editable}
              />
              <TextField
                label="Gender"
                value={form.gender}
                onChange={(value) => onFormChange({ gender: value })}
                disabled={!editable}
              />
              <TextField
                label="Emergency Contact"
                value={form.emergencyContact}
                onChange={(value) => onFormChange({ emergencyContact: value })}
                disabled={!editable}
              />
              <TextAreaField
                label="Residential Address"
                value={form.residentialAddress}
                onChange={(value) => onFormChange({ residentialAddress: value })}
                disabled={!editable}
                className="md:col-span-2"
              />
              <TextAreaField
                label="Notes"
                value={form.notes}
                onChange={(value) => onFormChange({ notes: value })}
                disabled={!editable}
                className="md:col-span-2"
              />
            </div>
          )}

          {activeTab === "compliance" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-medium">Compliance Health Indicator</div>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${health.cls}`} />
                  <span className="text-sm text-base-content/80">{health.label}</span>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <TextField
                  label="PSIRA Instructor Number"
                  value={form.psiraInstructorNumber}
                  onChange={(value) => onFormChange({ psiraInstructorNumber: value })}
                  disabled={!complianceEditable}
                  error={errors.psiraInstructorNumber}
                  required
                />
                <TextField
                  label="Instructor Grade"
                  value={form.instructorGrade}
                  onChange={(value) => onFormChange({ instructorGrade: value })}
                  disabled={!complianceEditable}
                />
                <TextField
                  label="Qualification"
                  value={form.qualification}
                  onChange={(value) => onFormChange({ qualification: value })}
                  disabled={!complianceEditable}
                />
                <TextField
                  label="Accreditation Scope"
                  value={form.accreditationScope}
                  onChange={(value) => onFormChange({ accreditationScope: value })}
                  disabled={!complianceEditable}
                />
                <TextField
                  label="Accreditation Status"
                  value={form.accreditationStatus}
                  onChange={(value) => onFormChange({ accreditationStatus: value })}
                  disabled={!complianceEditable}
                />
                <TextField
                  label="Certificate Number"
                  value={form.certificateNumber}
                  onChange={(value) => onFormChange({ certificateNumber: value })}
                  disabled={!complianceEditable}
                />
                <DateField
                  label="Certificate Issue Date"
                  value={form.certificateIssueDate}
                  onChange={(value) => onFormChange({ certificateIssueDate: value })}
                  disabled={!complianceEditable}
                />
                <DateField
                  label="Certificate Expiry Date"
                  value={form.certificateExpiryDate}
                  onChange={(value) => onFormChange({ certificateExpiryDate: value })}
                  disabled={!complianceEditable}
                />
                <SelectField
                  label="Verification Status"
                  value={form.complianceStatus}
                  onChange={(value) => onFormChange({ complianceStatus: value })}
                  disabled={!complianceEditable}
                  options={[
                    { value: "", label: "Auto" },
                    { value: "compliant", label: "Compliant" },
                    { value: "attention_needed", label: "Attention Needed" },
                    { value: "high_risk", label: "High Risk" },
                    { value: "pending_review", label: "Pending Review" },
                  ]}
                />
                <TextAreaField
                  label="Compliance Notes"
                  value={form.notes}
                  onChange={(value) => onFormChange({ notes: value })}
                  disabled={!complianceEditable}
                  className="md:col-span-2"
                />
              </div>
            </div>
          )}

          {activeTab === "contract" && (
            <div className="space-y-4">
              <div className={`rounded-2xl border p-3 text-sm ${warning.tone}`}>{warning.text}</div>
              <div className="grid gap-3 md:grid-cols-2">
                <TextField
                  label="Employment Type"
                  value={form.employmentType}
                  onChange={(value) => onFormChange({ employmentType: value })}
                  disabled={!editable}
                />
                <TextField
                  label="Contract Status"
                  value={form.contractStatus}
                  onChange={(value) => onFormChange({ contractStatus: value })}
                  disabled={!editable}
                />
                <DateField
                  label="Contract Start Date"
                  value={form.contractStartDate}
                  onChange={(value) => onFormChange({ contractStartDate: value })}
                  disabled={!editable}
                  error={errors.contractStartDate}
                  required
                />
                <DateField
                  label="Contract End Date"
                  value={form.contractEndDate}
                  onChange={(value) => onFormChange({ contractEndDate: value })}
                  disabled={!editable}
                  error={errors.contractEndDate}
                  required
                />
                <SelectField
                  label="Linked Branch"
                  value={form.assignedBranchId}
                  onChange={(value) => onFormChange({ assignedBranchId: value })}
                  disabled={!editable}
                  options={[
                    { value: "", label: "Unassigned" },
                    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
                  ]}
                />
                <TextField
                  label="Supervisor"
                  value=""
                  onChange={() => {}}
                  disabled
                  placeholder="Add in next phase"
                />
              </div>
            </div>
          )}

          {activeTab === "assignments" && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <SelectField
                  label="Assigned Branch"
                  value={form.assignedBranchId}
                  onChange={(value) => onFormChange({ assignedBranchId: value })}
                  disabled={!editable}
                  options={[
                    { value: "", label: "Unassigned" },
                    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
                  ]}
                />
                <TextField
                  label="Current Workload"
                  value={`${form.assignedCourseIds.length} course(s) assigned`}
                  onChange={() => {}}
                  disabled
                />
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold text-security-navy-900">Assigned Courses</h4>
                <p className="mt-1 text-xs text-base-content/70">
                  Assign courses, remove courses, and rebalance instructor allocation.
                </p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {courses.map((course) => (
                    <label
                      key={course.id}
                      className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${
                        form.assignedCourseIds.includes(course.id)
                          ? "border-security-navy-200 bg-security-navy-50/50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={form.assignedCourseIds.includes(course.id)}
                        disabled={!editable}
                        onChange={() => toggleCourse(course.id)}
                      />
                      <span>{course.code ? `${course.code} · ${course.title}` : course.title}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <InfoCard label="Assigned Classrooms" value="Managed via sessions" />
                <InfoCard label="Active Course Runs" value="Visible in attendance plans" />
                <InfoCard label="Upcoming Sessions" value="Use attendance module" />
              </div>
            </div>
          )}

          {activeTab === "documents" && (
            <InstructorDocumentsManager
              documents={documents}
              canEdit={canEditCompliance}
              uploading={uploading}
              onUpload={onUploadDocument}
              onReplace={onReplaceDocument}
              onDelete={onDeleteDocument}
              onMarkVerified={onMarkDocumentVerified}
            />
          )}

          {activeTab === "activity" && (
            <div className="rounded-2xl border border-slate-200 bg-white">
              {activity.length === 0 ? (
                <div className="p-6 text-sm text-base-content/60">No activity recorded yet.</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {activity.map((item) => (
                    <li key={item.id} className="flex items-start justify-between gap-3 p-4">
                      <div>
                        <div className="text-sm font-medium text-security-navy-900">{prettyAction(item.action)}</div>
                        <div className="text-xs text-base-content/70">{item.userName || "System user"}</div>
                      </div>
                      <div className="text-xs text-base-content/60">{new Date(item.at).toLocaleString()}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {(canArchive || canDelete) && (
          <div className="border-t border-slate-200 bg-white px-4 py-3 md:px-6">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canArchive && (
                <button type="button" className="btn btn-outline btn-sm rounded-xl" onClick={onArchive}>
                  Archive
                </button>
              )}
              {canDelete && (
                <button type="button" className="btn btn-error btn-sm rounded-xl" onClick={() => onDelete(false)}>
                  Delete
                </button>
              )}
              {canPermanentDelete && (
                <button type="button" className="btn btn-error btn-sm rounded-xl" onClick={() => onDelete(true)}>
                  Permanent Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  error,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <label className="w-full">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-base-content/60">
        {label} {required ? "*" : ""}
      </span>
      <input
        className={`input input-bordered w-full rounded-xl ${error ? "input-error" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
      {error ? <span className="mt-1 block text-xs text-error">{error}</span> : null}
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
  disabled,
  error,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  required?: boolean;
}) {
  return (
    <label className="w-full">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-base-content/60">
        {label} {required ? "*" : ""}
      </span>
      <DateInput
        value={value}
        onChange={onChange}
        disabled={disabled}
        required={required}
        className="input-modern w-full"
        ariaLabel={label}
        showToday
      />
      {error ? <span className="mt-1 block text-xs text-error">{error}</span> : null}
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  error,
  required,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  required?: boolean;
}) {
  return (
    <label className="w-full">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-base-content/60">
        {label} {required ? "*" : ""}
      </span>
      <select
        className={`select select-bordered w-full rounded-xl ${error ? "select-error" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {options.map((option) => (
          <option key={option.value || option.label} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <span className="mt-1 block text-xs text-error">{error}</span> : null}
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-base-content/60">{label}</span>
      <textarea
        className="textarea textarea-bordered min-h-[90px] w-full rounded-xl"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs uppercase tracking-wide text-base-content/60">{label}</div>
      <div className="mt-1 text-sm font-medium text-security-navy-900">{value}</div>
    </div>
  );
}

function prettyAction(value: string): string {
  return value
    .replace(/^academy\./, "")
    .replaceAll(".", " · ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function branchName(branchId: string, branches: InstructorBranchOption[]): string | null {
  if (!branchId) return null;
  return branches.find((branch) => branch.id === branchId)?.name ?? null;
}
