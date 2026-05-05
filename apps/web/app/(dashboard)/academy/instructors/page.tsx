"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { academyApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isFullAdmin } from "@/lib/permissions";
import {
  BulkActionBar,
  DEFAULT_INSTRUCTOR_FORM,
  DeleteConfirmationModal,
  EmptyStateCard,
  InstructorDrawer,
  type InstructorDrawerMode,
  type InstructorDrawerTab,
  InstructorFiltersToolbar,
  type InstructorFormErrors,
  type InstructorFormState,
  type InstructorRecord,
  type InstructorSummary,
  InstructorStatsCards,
  InstructorTable,
  type InstructorAuditItem,
  type InstructorBranchOption,
  type InstructorCourseOption,
  type InstructorDocument,
  type InstructorFilters,
} from "@/components/academy/instructors";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 260;
const DEFAULT_FILTERS: InstructorFilters = {
  search: "",
  status: "",
  complianceStatus: "",
  contractExpiry: "all",
  branchId: "",
  courseId: "",
  sort: "newest",
};

type ConfirmState =
  | {
      action: "archive" | "delete";
      instructorId: string;
      permanent?: boolean;
      title: string;
      message: string;
      confirmLabel: string;
    }
  | null;

type ParsedAudit = {
  id: string;
  at: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userName: string | null;
  metadata: Record<string, unknown> | null;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeStatus(value: string): InstructorRecord["status"] {
  if (value === "active" || value === "inactive" || value === "suspended" || value === "contract_ended") {
    return value;
  }
  return "inactive";
}

function toCourseOption(raw: unknown): InstructorCourseOption | null {
  const row = asObject(raw);
  const id = asString(row.id);
  const title = asString(row.title);
  if (!id || !title) return null;
  return { id, code: asNullableString(row.code), title };
}

function toBranchOption(raw: unknown): InstructorBranchOption | null {
  const row = asObject(raw);
  const id = asString(row.id);
  const name = asString(row.name);
  if (!id || !name) return null;
  return { id, name };
}

function toInstructorRecord(raw: unknown): InstructorRecord | null {
  const row = asObject(raw);
  const id = asString(row.id);
  const fullName = asString(row.fullName);
  if (!id || !fullName) return null;
  const assignedBranchRaw = asObject(row.assignedBranch);
  const assignedBranchId = asString(assignedBranchRaw.id);
  const assignedBranchName = asString(assignedBranchRaw.name);
  const assignedCourses = Array.isArray(row.assignedCourses)
    ? row.assignedCourses
        .map(toCourseOption)
        .filter((course): course is InstructorCourseOption => Boolean(course))
    : [];

  return {
    id,
    fullName,
    idNumber: asNullableString(row.idNumber),
    phone: asNullableString(row.phone),
    email: asNullableString(row.email),
    dateOfBirth: asNullableString(row.dateOfBirth),
    gender: asNullableString(row.gender),
    residentialAddress: asNullableString(row.residentialAddress),
    emergencyContact: asNullableString(row.emergencyContact),
    psiraInstructorNumber: asNullableString(row.psiraInstructorNumber),
    instructorGrade: asNullableString(row.instructorGrade),
    qualification: asNullableString(row.qualification),
    accreditationScope: asNullableString(row.accreditationScope),
    accreditationStatus: asNullableString(row.accreditationStatus),
    certificateNumber: asNullableString(row.certificateNumber),
    certificateIssueDate: asNullableString(row.certificateIssueDate),
    certificateExpiryDate: asNullableString(row.certificateExpiryDate),
    employmentType: asNullableString(row.employmentType),
    contractStartDate: asNullableString(row.contractStartDate),
    contractEndDate: asNullableString(row.contractEndDate),
    contractStatus: asNullableString(row.contractStatus),
    assignedBranchId: asNullableString(row.assignedBranchId),
    assignedBranch:
      assignedBranchId && assignedBranchName
        ? {
            id: assignedBranchId,
            name: assignedBranchName,
          }
        : null,
    assignedCourseIds: asStringArray(row.assignedCourseIds),
    assignedCourses,
    complianceStatus: asNullableString(row.complianceStatus),
    complianceStatusComputed: asString(row.complianceStatusComputed) || "pending_review",
    certificateStatus: asString(row.certificateStatus) || "missing",
    contractStatusComputed: asString(row.contractStatusComputed) || "missing",
    contractDaysRemaining:
      row.contractDaysRemaining == null ? null : asNumber(row.contractDaysRemaining, 0),
    status: normalizeStatus(asString(row.status)),
    notes: asNullableString(row.notes),
    archivedAt: asNullableString(row.archivedAt),
    createdAt: asString(row.createdAt) || new Date().toISOString(),
    updatedAt: asString(row.updatedAt) || new Date().toISOString(),
    missingDocumentTypes: asStringArray(row.missingDocumentTypes),
    missingDocumentsCount: asNumber(row.missingDocumentsCount, 0),
    documents: Array.isArray(row.documents)
      ? row.documents.map((docRaw) => {
          const doc = asObject(docRaw);
          return {
            id: asString(doc.id),
            documentType: asString(doc.documentType),
            verificationStatus: asString(doc.verificationStatus),
            expiryDate: asNullableString(doc.expiryDate),
          };
        })
      : [],
  };
}

function toInstructorSummary(raw: unknown): InstructorSummary {
  const row = asObject(raw);
  return {
    totalInstructors: asNumber(row.totalInstructors, 0),
    activeInstructors: asNumber(row.activeInstructors, 0),
    expiringContracts: asNumber(row.expiringContracts, 0),
    missingDocuments: asNumber(row.missingDocuments, 0),
    suspendedInactive: asNumber(row.suspendedInactive, 0),
    psiraComplianceScore: asNumber(row.psiraComplianceScore, 0),
    highRisk: asNumber(row.highRisk, 0),
    attentionNeeded: asNumber(row.attentionNeeded, 0),
  };
}

function toInstructorDocument(raw: unknown): InstructorDocument | null {
  const row = asObject(raw);
  const id = asString(row.id);
  if (!id) return null;
  const uploadedByRaw = asObject(row.uploadedBy);
  const verifiedByRaw = asObject(row.verifiedBy);
  return {
    id,
    instructorId: asString(row.instructorId),
    documentType: asString(row.documentType),
    fileUrl: asString(row.fileUrl),
    fileName: asString(row.fileName),
    issueDate: asNullableString(row.issueDate),
    expiryDate: asNullableString(row.expiryDate),
    verificationStatus: asString(row.verificationStatus) || "pending_review",
    uploadedAt: asNullableString(row.uploadedAt),
    uploadedBy: uploadedByRaw.id
      ? {
          id: asString(uploadedByRaw.id),
          name: asNullableString(uploadedByRaw.name),
          email: asNullableString(uploadedByRaw.email),
        }
      : null,
    verifiedAt: asNullableString(row.verifiedAt),
    verifiedBy: verifiedByRaw.id
      ? {
          id: asString(verifiedByRaw.id),
          name: asNullableString(verifiedByRaw.name),
          email: asNullableString(verifiedByRaw.email),
        }
      : null,
    notes: asNullableString(row.notes),
  };
}

function toParsedAudit(raw: unknown): ParsedAudit | null {
  const row = asObject(raw);
  const id = asString(row.id);
  if (!id) return null;
  const user = asObject(row.user);
  return {
    id,
    at: asString(row.timestamp) || new Date().toISOString(),
    action: asString(row.action),
    entityType: asString(row.entityType),
    entityId: asNullableString(row.entityId),
    userName: asNullableString(user.name) || asNullableString(user.email),
    metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : null,
  };
}

function toActivityItems(items: ParsedAudit[]): InstructorAuditItem[] {
  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map((item) => ({
      id: item.id,
      at: item.at,
      action: item.action,
      entityType: item.entityType,
      userName: item.userName,
    }));
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function toFormState(instructor: InstructorRecord | null): InstructorFormState {
  if (!instructor) return { ...DEFAULT_INSTRUCTOR_FORM };
  return {
    fullName: instructor.fullName || "",
    status: instructor.status || "active",
    idNumber: instructor.idNumber || "",
    phone: instructor.phone || "",
    email: instructor.email || "",
    dateOfBirth: toDateInput(instructor.dateOfBirth),
    gender: instructor.gender || "",
    residentialAddress: instructor.residentialAddress || "",
    emergencyContact: instructor.emergencyContact || "",
    psiraInstructorNumber: instructor.psiraInstructorNumber || "",
    instructorGrade: instructor.instructorGrade || "",
    qualification: instructor.qualification || "",
    accreditationScope: instructor.accreditationScope || "",
    accreditationStatus: instructor.accreditationStatus || "",
    certificateNumber: instructor.certificateNumber || "",
    certificateIssueDate: toDateInput(instructor.certificateIssueDate),
    certificateExpiryDate: toDateInput(instructor.certificateExpiryDate),
    employmentType: instructor.employmentType || "",
    contractStartDate: toDateInput(instructor.contractStartDate),
    contractEndDate: toDateInput(instructor.contractEndDate),
    contractStatus: instructor.contractStatus || "",
    assignedBranchId: instructor.assignedBranchId || "",
    assignedCourseIds: instructor.assignedCourseIds || [],
    complianceStatus: instructor.complianceStatus || "",
    notes: instructor.notes || "",
  };
}

function isValidDateInput(value: string): boolean {
  if (!value.trim()) return true;
  return !Number.isNaN(new Date(value).getTime());
}

function validateForm(form: InstructorFormState, { draft }: { draft: boolean }): InstructorFormErrors {
  const errors: InstructorFormErrors = {};
  if (!form.fullName.trim()) errors.fullName = "Full name is required";
  if (!form.status) errors.status = "Status is required";
  if (!draft && !form.phone.trim() && !form.email.trim()) {
    errors.phone = "Provide at least phone or email";
  }
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address";
  }
  if (form.idNumber.trim() && !/^\d{13}$/.test(form.idNumber.trim())) {
    errors.idNumber = "ID number must be 13 digits";
  }
  if (!draft && !form.psiraInstructorNumber.trim()) {
    errors.psiraInstructorNumber = "PSIRA instructor number is required";
  } else if (
    form.psiraInstructorNumber.trim() &&
    !/^[A-Za-z0-9/-]{5,40}$/.test(form.psiraInstructorNumber.trim())
  ) {
    errors.psiraInstructorNumber = "Invalid PSIRA number format";
  }
  if (!draft && !form.contractStartDate.trim()) {
    errors.contractStartDate = "Contract start date is required";
  }
  if (!draft && !form.contractEndDate.trim()) {
    errors.contractEndDate = "Contract end date is required";
  }
  if (form.contractStartDate && !isValidDateInput(form.contractStartDate)) {
    errors.contractStartDate = "Invalid start date";
  }
  if (form.contractEndDate && !isValidDateInput(form.contractEndDate)) {
    errors.contractEndDate = "Invalid end date";
  }
  const start = form.contractStartDate ? new Date(form.contractStartDate) : null;
  const end = form.contractEndDate ? new Date(form.contractEndDate) : null;
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end < start) {
    errors.contractEndDate = "Contract end date cannot be before start date";
  }
  return errors;
}

function toPayload(form: InstructorFormState, draft: boolean): Record<string, unknown> {
  return {
    fullName: form.fullName.trim(),
    status: form.status,
    idNumber: nullable(form.idNumber),
    phone: nullable(form.phone),
    email: nullable(form.email),
    dateOfBirth: nullable(form.dateOfBirth),
    gender: nullable(form.gender),
    residentialAddress: nullable(form.residentialAddress),
    emergencyContact: nullable(form.emergencyContact),
    psiraInstructorNumber: nullable(form.psiraInstructorNumber),
    instructorGrade: nullable(form.instructorGrade),
    qualification: nullable(form.qualification),
    accreditationScope: nullable(form.accreditationScope),
    accreditationStatus: nullable(form.accreditationStatus),
    certificateNumber: nullable(form.certificateNumber),
    certificateIssueDate: nullable(form.certificateIssueDate),
    certificateExpiryDate: nullable(form.certificateExpiryDate),
    employmentType: nullable(form.employmentType),
    contractStartDate: nullable(form.contractStartDate),
    contractEndDate: nullable(form.contractEndDate),
    contractStatus: nullable(form.contractStatus),
    assignedBranchId: nullable(form.assignedBranchId),
    assignedCourseIds: form.assignedCourseIds.length ? form.assignedCourseIds : null,
    complianceStatus: nullable(form.complianceStatus),
    notes: nullable(form.notes),
    saveAsDraft: draft,
  };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(filename: string, rows: InstructorRecord[]) {
  const header = [
    "Full Name",
    "Status",
    "Compliance",
    "PSIRA Number",
    "ID Number",
    "Email",
    "Phone",
    "Branch",
    "Courses",
    "Contract End Date",
    "Certificate Status",
    "Last Updated",
  ];
  const data = rows.map((row) => [
    row.fullName,
    row.archivedAt ? "archived" : row.status,
    row.complianceStatusComputed,
    row.psiraInstructorNumber || "",
    row.idNumber || "",
    row.email || "",
    row.phone || "",
    row.assignedBranch?.name || "",
    row.assignedCourses.map((course) => course.code || course.title).join(" | "),
    row.contractEndDate || "",
    row.certificateStatus,
    row.updatedAt,
  ]);
  const csv = [header, ...data]
    .map((line) => line.map((entry) => csvEscape(String(entry))).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportAsPrintPdf(title: string, rows: InstructorRecord[]) {
  const printable = rows
    .map((row) => {
      const courses = row.assignedCourses.map((course) => course.code || course.title).join(", ") || "—";
      return `<tr>
        <td>${row.fullName}</td>
        <td>${row.psiraInstructorNumber || "—"}</td>
        <td>${row.assignedBranch?.name || "—"}</td>
        <td>${courses}</td>
        <td>${row.contractEndDate ? new Date(row.contractEndDate).toLocaleDateString() : "—"}</td>
        <td>${row.complianceStatusComputed}</td>
        <td>${row.archivedAt ? "archived" : row.status}</td>
      </tr>`;
    })
    .join("");
  const win = window.open("", "_blank", "width=1200,height=800");
  if (!win) return;
  win.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; color: #0f172a; }
          h1 { margin-bottom: 4px; }
          p { margin-top: 0; color: #475569; }
          table { border-collapse: collapse; width: 100%; margin-top: 16px; font-size: 12px; }
          th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
          th { background: #f8fafc; text-transform: uppercase; font-size: 11px; letter-spacing: .03em; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <p>Generated ${new Date().toLocaleString()}</p>
        <table>
          <thead>
            <tr>
              <th>Instructor</th>
              <th>PSIRA #</th>
              <th>Branch</th>
              <th>Courses</th>
              <th>Contract End</th>
              <th>Compliance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${printable}</tbody>
        </table>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

export default function AcademyInstructorsPage() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<InstructorRecord[]>([]);
  const [summary, setSummary] = useState<InstructorSummary>({
    totalInstructors: 0,
    activeInstructors: 0,
    expiringContracts: 0,
    missingDocuments: 0,
    suspendedInactive: 0,
    psiraComplianceScore: 0,
    highRisk: 0,
    attentionNeeded: 0,
  });
  const [filters, setFilters] = useState<InstructorFilters>(DEFAULT_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [branches, setBranches] = useState<InstructorBranchOption[]>([]);
  const [courses, setCourses] = useState<InstructorCourseOption[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<InstructorDrawerMode>("view");
  const [drawerTab, setDrawerTab] = useState<InstructorDrawerTab>("overview");
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [activeInstructorId, setActiveInstructorId] = useState<string | null>(null);
  const [activeInstructor, setActiveInstructor] = useState<InstructorRecord | null>(null);
  const [drawerForm, setDrawerForm] = useState<InstructorFormState>({ ...DEFAULT_INSTRUCTOR_FORM });
  const [drawerErrors, setDrawerErrors] = useState<InstructorFormErrors>({});
  const [documents, setDocuments] = useState<InstructorDocument[]>([]);
  const [activity, setActivity] = useState<InstructorAuditItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  const fullAdmin = isFullAdmin({
    role: user?.role ?? "",
    moduleAccess: user?.moduleAccess,
  });
  const canEditRecords = Boolean(
    user &&
      ["admin", "operations_manager", "hr_payroll", "controller"].includes(user.role)
  );
  const canEditCompliance = Boolean(
    user &&
      ["admin", "operations_manager", "hr_payroll"].includes(user.role)
  );
  const canArchiveDelete = Boolean(
    user &&
      ["admin", "operations_manager"].includes(user.role)
  );
  const canPermanentDelete = fullAdmin;

  const loadMeta = useCallback(async () => {
    if (!token) return;
    try {
      const [branchRes, courseRes] = await Promise.all([
        academyApi.listBranches(token),
        academyApi.listCourses(token),
      ]);
      const branchOptions = Array.isArray(branchRes.branches)
        ? branchRes.branches
            .map(toBranchOption)
            .filter((branch): branch is InstructorBranchOption => Boolean(branch))
        : [];
      const courseOptions = Array.isArray(courseRes.courses)
        ? courseRes.courses
            .map(toCourseOption)
            .filter((course): course is InstructorCourseOption => Boolean(course))
        : [];
      setBranches(branchOptions);
      setCourses(courseOptions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load branch/course options");
    }
  }, [token]);

  const loadList = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    academyApi
      .listInstructors(token, {
        search: debouncedSearch.trim() || undefined,
        status: filters.status || undefined,
        complianceStatus: filters.complianceStatus || undefined,
        contractExpiry: filters.contractExpiry || undefined,
        branchId: filters.branchId || undefined,
        courseId: filters.courseId || undefined,
        sort: filters.sort,
        includeArchived: filters.status === "archived",
        limit: PAGE_SIZE,
        offset,
      })
      .then((r) => {
        const nextRows = Array.isArray(r.instructors)
          ? r.instructors
              .map(toInstructorRecord)
              .filter((row): row is InstructorRecord => Boolean(row))
          : [];
        setRows(nextRows);
        setTotal(Number(r.total ?? 0));
        setSummary(toInstructorSummary(r.summary));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load instructors"))
      .finally(() => setLoading(false));
  }, [
    token,
    debouncedSearch,
    filters.status,
    filters.complianceStatus,
    filters.contractExpiry,
    filters.branchId,
    filters.courseId,
    filters.sort,
    offset,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    loadList();
  }, [loadList, reloadTick]);

  useEffect(() => {
    setSelectedIds((current) => {
      const visible = new Set(rows.map((row) => row.id));
      return new Set([...current].filter((id) => visible.has(id)));
    });
  }, [rows]);

  const resetDrawerState = useCallback(() => {
    setActiveInstructorId(null);
    setActiveInstructor(null);
    setDrawerForm({ ...DEFAULT_INSTRUCTOR_FORM });
    setDrawerErrors({});
    setDocuments([]);
    setActivity([]);
  }, []);

  const openCreateDrawer = useCallback(() => {
    resetDrawerState();
    setDrawerMode("create");
    setDrawerTab("personal");
    setDrawerOpen(true);
  }, [resetDrawerState]);

  const openInstructor = useCallback(
    async (id: string, mode: InstructorDrawerMode = "view", tab: InstructorDrawerTab = "overview") => {
      if (!token) return;
      setDrawerOpen(true);
      setDrawerMode(mode);
      setDrawerTab(tab);
      setDrawerLoading(true);
      setDrawerErrors({});
      setActiveInstructorId(id);
      try {
        const [detailRes, docsRes, instructorLogsRes, documentLogsRes] = await Promise.all([
          academyApi.getInstructor(token, id),
          academyApi.listInstructorDocuments(token, id),
          academyApi.listAuditLogs(token, {
            entityType: "AcademyInstructor",
            entityId: id,
            limit: 80,
          }),
          academyApi.listAuditLogs(token, {
            entityType: "AcademyInstructorDocument",
            limit: 120,
          }),
        ]);

        const record = toInstructorRecord((detailRes as { instructor: unknown }).instructor);
        if (!record) throw new Error("Instructor payload invalid");
        setActiveInstructor(record);
        setDrawerForm(toFormState(record));

        const nextDocuments = Array.isArray(docsRes.documents)
          ? docsRes.documents
              .map(toInstructorDocument)
              .filter((doc): doc is InstructorDocument => Boolean(doc))
          : [];
        setDocuments(nextDocuments);

        const parsedInstructorLogs = Array.isArray(instructorLogsRes.logs)
          ? instructorLogsRes.logs
              .map(toParsedAudit)
              .filter((item): item is ParsedAudit => Boolean(item))
          : [];
        const parsedDocumentLogs = Array.isArray(documentLogsRes.logs)
          ? documentLogsRes.logs
              .map(toParsedAudit)
              .filter((item): item is ParsedAudit => Boolean(item))
          : [];
        const documentIds = new Set(nextDocuments.map((doc) => doc.id));
        const filteredDocumentLogs = parsedDocumentLogs.filter((entry) => {
          const metadataInstructorId =
            entry.metadata && typeof entry.metadata.instructorId === "string"
              ? entry.metadata.instructorId
              : null;
          return metadataInstructorId === id || (entry.entityId ? documentIds.has(entry.entityId) : false);
        });
        setActivity(toActivityItems([...parsedInstructorLogs, ...filteredDocumentLogs]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load instructor details");
        setDrawerOpen(false);
      } finally {
        setDrawerLoading(false);
      }
    },
    [token]
  );

  const closeDrawer = useCallback(() => {
    if (drawerSaving || uploadingDocument) return;
    setDrawerOpen(false);
    setDrawerMode("view");
    setDrawerTab("overview");
    resetDrawerState();
  }, [drawerSaving, uploadingDocument, resetDrawerState]);

  const refreshAfterMutation = useCallback(() => {
    setReloadTick((current) => current + 1);
  }, []);

  const saveDrawer = useCallback(
    async (draft: boolean) => {
      if (!token || !canEditRecords) return;
      const validation = validateForm(drawerForm, { draft });
      setDrawerErrors(validation);
      if (Object.keys(validation).length > 0) {
        if (validation.fullName || validation.status || validation.phone || validation.email) {
          setDrawerTab("personal");
        } else if (
          validation.psiraInstructorNumber ||
          validation.idNumber
        ) {
          setDrawerTab("compliance");
        } else if (validation.contractStartDate || validation.contractEndDate) {
          setDrawerTab("contract");
        }
        return;
      }

      setDrawerSaving(true);
      setError(null);
      try {
        const payload = toPayload(drawerForm, draft);
        if (drawerMode === "create" || !activeInstructorId) {
          const response = await academyApi.createInstructor(token, payload);
          const created = toInstructorRecord((response as { instructor: unknown }).instructor);
          refreshAfterMutation();
          if (created) {
            await openInstructor(created.id, "view", "overview");
          } else {
            closeDrawer();
          }
          setNotice(draft ? "Instructor draft saved." : "Instructor created successfully.");
        } else {
          await academyApi.updateInstructor(token, activeInstructorId, payload);
          refreshAfterMutation();
          await openInstructor(activeInstructorId, "view", "overview");
          setNotice(draft ? "Draft changes saved." : "Instructor updated successfully.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save instructor");
      } finally {
        setDrawerSaving(false);
      }
    },
    [
      token,
      canEditRecords,
      drawerForm,
      drawerMode,
      activeInstructorId,
      openInstructor,
      closeDrawer,
      refreshAfterMutation,
    ]
  );

  const updateDrawerForm = useCallback((patch: Partial<InstructorFormState>) => {
    setDrawerForm((current) => ({ ...current, ...patch }));
    setDrawerErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch) as Array<keyof InstructorFormErrors>) {
        delete next[key];
      }
      return next;
    });
  }, []);

  const archiveInstructor = useCallback(
    async (id: string) => {
      if (!token || !canArchiveDelete) return;
      setBusy(true);
      try {
        await academyApi.archiveInstructor(token, id);
        refreshAfterMutation();
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        if (activeInstructorId === id) closeDrawer();
        setNotice("Instructor archived.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to archive instructor");
      } finally {
        setBusy(false);
      }
    },
    [token, canArchiveDelete, refreshAfterMutation, activeInstructorId, closeDrawer]
  );

  const deleteInstructor = useCallback(
    async (id: string, permanent: boolean) => {
      if (!token || !canArchiveDelete) return;
      setBusy(true);
      try {
        await academyApi.deleteInstructor(token, id, { permanent });
        refreshAfterMutation();
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        if (activeInstructorId === id) closeDrawer();
        setNotice(permanent ? "Instructor permanently deleted." : "Instructor deleted (soft).");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete instructor");
      } finally {
        setBusy(false);
      }
    },
    [token, canArchiveDelete, refreshAfterMutation, activeInstructorId, closeDrawer]
  );

  const updateInstructorStatus = useCallback(
    async (id: string, status: "active" | "inactive" | "suspended" | "contract_ended") => {
      if (!token || !canEditRecords) return;
      setBusy(true);
      try {
        await academyApi.updateInstructor(token, id, { status });
        refreshAfterMutation();
        if (activeInstructorId === id) {
          await openInstructor(id, "view", "overview");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update status");
      } finally {
        setBusy(false);
      }
    },
    [token, canEditRecords, refreshAfterMutation, activeInstructorId, openInstructor]
  );

  const handleBulkAction = useCallback(
    async (payload: { action: string; branchId?: string; courseId?: string }) => {
      if (!token || selectedIds.size === 0) return;
      const ids = [...selectedIds];
      if (payload.action === "export_selected") {
        const selectedRows = rows.filter((row) => selectedIds.has(row.id));
        downloadCsv(`academy-instructors-selected-${new Date().toISOString().slice(0, 10)}.csv`, selectedRows);
        setNotice(`Exported ${selectedRows.length} selected instructors.`);
        return;
      }

      setBusy(true);
      try {
        if (payload.action === "assign_branch") {
          await academyApi.bulkInstructorAction(token, {
            ids,
            action: "assign_branch",
            assignedBranchId: payload.branchId || null,
          });
        } else if (payload.action === "assign_course") {
          await academyApi.bulkInstructorAction(token, {
            ids,
            action: "assign_courses",
            assignedCourseIds: payload.courseId ? [payload.courseId] : null,
          });
        } else if (payload.action === "archive_selected") {
          await academyApi.bulkInstructorAction(token, { ids, action: "archive" });
        } else if (payload.action === "delete_selected") {
          await academyApi.bulkInstructorAction(token, { ids, action: "delete" });
        } else if (payload.action === "mark_documents_requested" || payload.action === "send_reminder") {
          await academyApi.bulkInstructorAction(token, { ids, action: "mark_documents_requested" });
        }
        setSelectedIds(new Set());
        refreshAfterMutation();
        setNotice("Bulk action completed.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Bulk action failed");
      } finally {
        setBusy(false);
      }
    },
    [token, selectedIds, rows, refreshAfterMutation]
  );

  const uploadDocument = useCallback(
    async (payload: {
      file: File;
      documentType: string;
      issueDate?: string;
      expiryDate?: string;
      notes?: string;
    }) => {
      if (!token || !activeInstructorId || !canEditCompliance) return;
      setUploadingDocument(true);
      try {
        await academyApi.uploadInstructorDocument(token, activeInstructorId, payload.file, {
          documentType: payload.documentType,
          issueDate: payload.issueDate ?? null,
          expiryDate: payload.expiryDate ?? null,
          notes: payload.notes ?? null,
        });
        await openInstructor(activeInstructorId, drawerMode, "documents");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Document upload failed");
      } finally {
        setUploadingDocument(false);
      }
    },
    [token, activeInstructorId, canEditCompliance, openInstructor, drawerMode]
  );

  const replaceDocument = useCallback(
    async (document: InstructorDocument, file: File) => {
      if (!token || !activeInstructorId || !canEditCompliance) return;
      setUploadingDocument(true);
      try {
        await academyApi.uploadInstructorDocument(token, activeInstructorId, file, {
          documentType: document.documentType,
          issueDate: document.issueDate,
          expiryDate: document.expiryDate,
          notes: document.notes ?? null,
        });
        await academyApi.deleteInstructorDocument(token, activeInstructorId, document.id);
        await openInstructor(activeInstructorId, drawerMode, "documents");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Document replace failed");
      } finally {
        setUploadingDocument(false);
      }
    },
    [token, activeInstructorId, canEditCompliance, openInstructor, drawerMode]
  );

  const deleteDocument = useCallback(
    async (documentId: string) => {
      if (!token || !activeInstructorId || !canEditCompliance) return;
      setUploadingDocument(true);
      try {
        await academyApi.deleteInstructorDocument(token, activeInstructorId, documentId);
        await openInstructor(activeInstructorId, drawerMode, "documents");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Document delete failed");
      } finally {
        setUploadingDocument(false);
      }
    },
    [token, activeInstructorId, canEditCompliance, openInstructor, drawerMode]
  );

  const verifyDocument = useCallback(
    async (documentId: string) => {
      if (!token || !activeInstructorId || !canEditCompliance) return;
      setUploadingDocument(true);
      try {
        await academyApi.updateInstructorDocument(token, activeInstructorId, documentId, {
          verificationStatus: "verified",
        });
        await openInstructor(activeInstructorId, drawerMode, "documents");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Document verification failed");
      } finally {
        setUploadingDocument(false);
      }
    },
    [token, activeInstructorId, canEditCompliance, openInstructor, drawerMode]
  );

  const activeAlerts = useMemo(() => {
    const expiring = rows.filter((row) => row.contractStatusComputed === "expiring_soon").slice(0, 3);
    const missingCertificates = rows.filter((row) => row.certificateStatus === "missing").slice(0, 2);
    const suspended = rows.filter((row) => row.status === "suspended").slice(0, 1);
    const pendingVerification = rows
      .filter((row) => row.complianceStatusComputed === "pending_review" || row.complianceStatusComputed === "attention_needed")
      .slice(0, 4);
    return { expiring, missingCertificates, suspended, pendingVerification };
  }, [rows]);

  const hasActiveFilters = useMemo(
    () =>
      filters.search.trim() !== "" ||
      filters.status !== "" ||
      filters.complianceStatus !== "" ||
      filters.contractExpiry !== "all" ||
      filters.branchId !== "" ||
      filters.courseId !== "" ||
      filters.sort !== "newest",
    [filters]
  );

  const canGoPrevious = offset > 0 && !loading;
  const canGoNext = !loading && offset + PAGE_SIZE < total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(totalPages, Math.floor(offset / PAGE_SIZE) + 1);

  const exportCurrent = useCallback(
    (asPdf: boolean) => {
      const exportRows = rows;
      if (exportRows.length === 0) {
        setNotice("No data to export for current view.");
        return;
      }
      if (asPdf) {
        exportAsPrintPdf("Academy Instructors Report", exportRows);
      } else {
        downloadCsv(`academy-instructors-${new Date().toISOString().slice(0, 10)}.csv`, exportRows);
      }
    },
    [rows]
  );

  const applyFilterPatch = useCallback((patch: Partial<InstructorFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setOffset(0);
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    setOffset(0);
  }, []);

  const handleTableAction = useCallback(
    (id: string, action: "view" | "edit" | "upload_documents" | "assign_courses" | "assign_branch" | "renew_contract" | "archive" | "delete") => {
      if (action === "view") {
        openInstructor(id, "view", "overview");
        return;
      }
      if (action === "edit") {
        openInstructor(id, "edit", "personal");
        return;
      }
      if (action === "upload_documents") {
        openInstructor(id, "edit", "documents");
        return;
      }
      if (action === "assign_courses" || action === "assign_branch") {
        openInstructor(id, "edit", "assignments");
        return;
      }
      if (action === "renew_contract") {
        openInstructor(id, "edit", "contract");
        return;
      }
      if (action === "archive") {
        setConfirmState({
          action: "archive",
          instructorId: id,
          title: "Archive instructor?",
          message: "This will move the instructor to archived records and hide it from active workflows.",
          confirmLabel: "Archive",
        });
        return;
      }
      if (action === "delete") {
        setConfirmState({
          action: "delete",
          instructorId: id,
          title: "Delete instructor?",
          message: "This performs a soft delete (archive) by default. Permanent delete is restricted to super admins.",
          confirmLabel: "Delete",
        });
      }
    },
    [openInstructor]
  );

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const confirmAction = async () => {
    if (!confirmState) return;
    if (confirmState.action === "archive") {
      await archiveInstructor(confirmState.instructorId);
    } else {
      await deleteInstructor(confirmState.instructorId, Boolean(confirmState.permanent));
    }
    setConfirmState(null);
  };

  const requestSuspendFromDrawer = () => {
    if (!activeInstructorId) return;
    updateInstructorStatus(activeInstructorId, "suspended");
  };

  const requestRenewContractFromDrawer = () => {
    if (!activeInstructor) return;
    const nextDate = activeInstructor.contractEndDate ? new Date(activeInstructor.contractEndDate) : new Date();
    nextDate.setFullYear(nextDate.getFullYear() + 1);
    updateDrawerForm({
      contractEndDate: nextDate.toISOString().slice(0, 10),
      contractStatus: "Renewed",
    });
    setDrawerMode("edit");
    setDrawerTab("contract");
  };

  const requestArchiveFromDrawer = () => {
    if (!activeInstructorId) return;
    setConfirmState({
      action: "archive",
      instructorId: activeInstructorId,
      title: "Archive instructor?",
      message: "Archiving keeps records and documents but removes the instructor from active lists.",
      confirmLabel: "Archive",
    });
  };

  const requestDeleteFromDrawer = (permanent?: boolean) => {
    if (!activeInstructorId) return;
    setConfirmState({
      action: "delete",
      instructorId: activeInstructorId,
      permanent,
      title: permanent ? "Permanently delete instructor?" : "Delete instructor?",
      message: permanent
        ? "This action is irreversible and removes instructor records and documents."
        : "This performs a soft delete (archive) and can be restored later.",
      confirmLabel: permanent ? "Permanent Delete" : "Delete",
    });
  };

  const tableEmpty = !loading && rows.length === 0;

  return (
    <div className="module-shell pb-4">
      <section className="card-wireframe overflow-hidden px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <Link href="/academy" className="link-inline text-sm font-semibold lg:hidden">
              ← Academy
            </Link>
            <p className="label-text mt-1">People · Instructors</p>
            <h1 className="page-title mt-1 text-xl md:text-2xl">Instructors</h1>
            <p className="mt-0.5 text-sm text-black">
              Manage accredited instructors, contracts, certificates, compliance, and assignments.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary text-sm py-2 px-4 rounded-security-lg"
              onClick={openCreateDrawer}
              disabled={!canEditRecords}
            >
              Add Instructor
            </button>
            <details className="dropdown dropdown-end">
              <summary className="btn-secondary text-sm py-2 px-4 rounded-lg">Actions</summary>
              <ul className="menu dropdown-content z-[50] mt-1 w-52 rounded-box border border-slate-200 bg-white p-2 shadow">
                <li>
                  <button type="button" onClick={() => exportCurrent(false)}>
                    Export CSV
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => exportCurrent(true)}>
                    Export PDF
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setNotice("Bulk upload workflow will be enabled in the next API iteration.")}
                  >
                    Bulk Upload
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() =>
                      applyFilterPatch({
                        complianceStatus: "high_risk",
                        sort: "compliance_risk_highest",
                      })
                    }
                  >
                    Compliance Report
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => applyFilterPatch({ contractExpiry: "expiring_30" })}>
                    View Expiring Contracts
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => applyFilterPatch({ complianceStatus: "missing_contract" })}>
                    View Missing Documents
                  </button>
                </li>
              </ul>
            </details>
          </div>
        </div>
        <div className="mt-2 hidden lg:block">
          <InstructorFiltersToolbar
            filters={filters}
            branches={branches}
            courses={courses}
            rowStyle
            onChange={applyFilterPatch}
            onReset={resetFilters}
          />
        </div>
        <div className="mt-2 lg:hidden">
          <button
            type="button"
            className="btn-secondary text-sm py-2 px-4 w-full rounded-lg"
            onClick={() => setMobileFiltersOpen(true)}
          >
            Filters, Search & Sort
          </button>
        </div>
      </section>

      {!canEditRecords && (
        <div className="notice-info text-sm">
          Read-only access for your role. You can review instructor data but cannot create or update records.
        </div>
      )}

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice-success text-sm">
          {notice}
        </div>
      )}

      <InstructorStatsCards
        summary={summary}
        onFilterSelect={(next) =>
          applyFilterPatch({
            status: next.status ?? "",
            complianceStatus: next.complianceStatus ?? "",
            contractExpiry: next.contractExpiry ?? "all",
          })
        }
      />

      <CompactAlertsStrip
        summary={summary}
        activeAlerts={activeAlerts}
        onExpiringClick={() => applyFilterPatch({ contractExpiry: "expiring_30" })}
        onMissingClick={() => applyFilterPatch({ complianceStatus: "missing_certificate" })}
        onSuspendedClick={() => applyFilterPatch({ status: "suspended" })}
        onPendingClick={() => applyFilterPatch({ complianceStatus: "pending_review" })}
      />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {tableEmpty ? (
          <div className="flex min-h-[320px] items-center justify-center p-4">
            {!hasActiveFilters ? (
              <EmptyStateCard
                title="No instructors yet"
                description="Add your first instructor to manage contracts, certificates, and compliance in one place."
                ctaLabel="Add Instructor"
                secondaryCtaLabel="Bulk Upload"
                onCta={openCreateDrawer}
                onSecondaryCta={() => setNotice("Bulk upload workflow will be enabled in the next API iteration.")}
              />
            ) : (
              <EmptyStateCard
                title="No instructors match these filters"
                description="Try adjusting your filters to find instructors by status, compliance, branch, or assignments."
                ctaLabel="Reset Filters"
                onCta={resetFilters}
              />
            )}
          </div>
        ) : (
          <div className="space-y-3 p-3">
            <InstructorTable
              rows={rows}
              loading={loading}
              selectedIds={selectedIds}
              onToggleSelect={(id, checked) =>
                setSelectedIds((current) => {
                  const next = new Set(current);
                  if (checked) next.add(id);
                  else next.delete(id);
                  return next;
                })
              }
              onToggleSelectAll={(checked) =>
                setSelectedIds((current) => {
                  const next = new Set(current);
                  if (checked) {
                    rows.forEach((row) => next.add(row.id));
                  } else {
                    rows.forEach((row) => next.delete(row.id));
                  }
                  return next;
                })
              }
              onRowClick={(id) => openInstructor(id, "view", "overview")}
              onAction={handleTableAction}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
              <div className="text-sm text-black">
                Page {currentPage} of {totalPages} · {total} records
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary text-sm py-2 px-3 rounded-security-lg"
                  disabled={!canGoPrevious}
                  onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-secondary text-sm py-2 px-3 rounded-security-lg"
                  disabled={!canGoNext}
                  onClick={() => setOffset((current) => current + PAGE_SIZE)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <BulkActionBar
        selectedCount={selectedIds.size}
        branches={branches}
        courses={courses}
        disabled={busy}
        onClear={() => setSelectedIds(new Set())}
        onApply={handleBulkAction}
      />

      <button
        type="button"
        className="btn-primary fixed bottom-4 right-4 z-40 rounded-full px-4 py-2 shadow-xl lg:hidden"
        onClick={openCreateDrawer}
        disabled={!canEditRecords}
      >
        + Add Instructor
      </button>

      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-[85] bg-slate-900/35 lg:hidden">
          <div className="ml-auto h-full w-full max-w-sm overflow-y-auto bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-security-navy-900">Filters</h3>
              <button type="button" className="btn-ghost text-sm py-2 px-3 rounded-security-lg" onClick={() => setMobileFiltersOpen(false)}>
                Close
              </button>
            </div>
            <InstructorFiltersToolbar
              filters={filters}
              branches={branches}
              courses={courses}
              compact
              onChange={applyFilterPatch}
              onReset={resetFilters}
            />
          </div>
        </div>
      )}

      <InstructorDrawer
        open={drawerOpen}
        mode={drawerMode}
        activeTab={drawerTab}
        instructor={activeInstructor}
        form={drawerForm}
        errors={drawerErrors}
        branches={branches}
        courses={courses}
        documents={documents}
        activity={activity}
        saving={drawerSaving || drawerLoading}
        uploading={uploadingDocument}
        canEdit={canEditRecords}
        canEditCompliance={canEditCompliance}
        canArchive={canArchiveDelete}
        canDelete={canArchiveDelete}
        canPermanentDelete={canPermanentDelete}
        onClose={closeDrawer}
        onTabChange={setDrawerTab}
        onFormChange={updateDrawerForm}
        onStartEdit={() => setDrawerMode("edit")}
        onSave={() => saveDrawer(false)}
        onSaveDraft={() => saveDrawer(true)}
        onSuspend={requestSuspendFromDrawer}
        onRenewContract={requestRenewContractFromDrawer}
        onArchive={requestArchiveFromDrawer}
        onDelete={requestDeleteFromDrawer}
        onUploadDocument={uploadDocument}
        onReplaceDocument={replaceDocument}
        onDeleteDocument={deleteDocument}
        onMarkDocumentVerified={verifyDocument}
      />

      <DeleteConfirmationModal
        open={Boolean(confirmState)}
        title={confirmState?.title || "Confirm action"}
        message={confirmState?.message || ""}
        confirmLabel={confirmState?.confirmLabel || "Confirm"}
        loading={busy}
        onCancel={() => setConfirmState(null)}
        onConfirm={confirmAction}
      />
    </div>
  );
}

function CompactAlertsStrip({
  summary,
  activeAlerts,
  onExpiringClick,
  onMissingClick,
  onSuspendedClick,
  onPendingClick,
}: {
  summary: InstructorSummary;
  activeAlerts: {
    expiring: InstructorRecord[];
    missingCertificates: InstructorRecord[];
    suspended: InstructorRecord[];
    pendingVerification: InstructorRecord[];
  };
  onExpiringClick: () => void;
  onMissingClick: () => void;
  onSuspendedClick: () => void;
  onPendingClick: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/90 px-2 py-2 shadow-sm">
      <div className="flex flex-wrap gap-2">
        <AlertPill
          tone="amber"
          title={`${summary.expiringContracts} expiring`}
          preview={activeAlerts.expiring.map((row) => row.fullName).join(", ")}
          onClick={onExpiringClick}
        />
        <AlertPill
          tone="red"
          title={`${summary.missingDocuments} missing docs`}
          preview={activeAlerts.missingCertificates.map((row) => row.fullName).join(", ")}
          onClick={onMissingClick}
        />
        <AlertPill
          tone="slate"
          title={`${activeAlerts.suspended.length} suspended`}
          preview={activeAlerts.suspended.map((row) => row.fullName).join(", ")}
          onClick={onSuspendedClick}
        />
        <AlertPill
          tone="amber"
          title={`${summary.attentionNeeded} pending review`}
          preview={activeAlerts.pendingVerification.map((row) => row.fullName).join(", ")}
          onClick={onPendingClick}
        />
      </div>
    </div>
  );
}

function AlertPill({
  tone,
  title,
  preview,
  onClick,
}: {
  tone: "amber" | "red" | "slate";
  title: string;
  preview: string;
  onClick: () => void;
}) {
  const className =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <button
      type="button"
      className={`max-w-full rounded-lg border px-3 py-1.5 text-left transition hover:shadow-sm ${className}`}
      onClick={onClick}
    >
      <div className="text-xs font-semibold">{title}</div>
      <div className="max-w-[28rem] truncate text-[11px] opacity-80">{preview || "No urgent records in this view."}</div>
    </button>
  );
}
