import { authFetch, buildApiUrl } from "./api";

export type PayrollExportProvider =
  | "SAGE_BUSINESS_CLOUD_ZA"
  | "SAGE_VIP"
  | "SAGE_300_PEOPLE"
  | "GENERIC_CSV"
  | "JSON_WEBHOOK";

export type PayrollExportBatchStatus = "DRAFT" | "LOCKED" | "EXPORTED" | "VOIDED";

export interface PayCodeMapping {
  regularHours?: string;
  overtimeHours?: string;
  sundayHours?: string;
  publicHolidayHours?: string;
  nightShiftHours?: string;
  annualLeaveHours?: string;
  sickLeaveHours?: string;
  familyLeaveHours?: string;
  studyLeaveHours?: string;
  unpaidLeaveHours?: string;
}

export interface CustomExportColumn {
  header: string;
  fixedValue?: string;
  field?:
    | "periodKey"
    | "companyName"
    | "employeeNumber"
    | "externalPayrollCode"
    | "siteName"
    | "costCenterCode";
}

export interface PayrollExportProfile {
  id: string;
  name: string;
  provider: PayrollExportProvider;
  isDefault: boolean;
  splitBySite: boolean;
  delimiter: string;
  dateFormat: string;
  codeMappingJson: PayCodeMapping;
  customColumnsJson?: CustomExportColumn[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportPeriodOption {
  periodKey: string;
  label: string;
  rosterLabel: string;
  periodStart: string;
  periodEnd: string;
  isCurrent: boolean;
}

export interface ExportReadinessInfo {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  status: "READY" | "PENDING_ATTENDANCE_REVIEW";
  openExceptions: number;
  openCritical: number;
  totalActiveSites: number;
  approvedSiteTimesheets: number;
  unapprovedSiteTimesheets: number;
  pendingLeaveRequests: number;
  missingExternalPayrollCodes: number;
}

export interface ExportLineItem {
  id?: string;
  employeeId: string;
  employeeNumber?: string;
  externalPayrollCode: string;
  employeeFullName: string;
  siteId: string | null;
  siteName?: string | null;
  costCenterCode: string | null;
  basicHours: number | string;
  overtimeHours: number | string;
  sundayHours: number | string;
  publicHolidayHours: number | string;
  nightShiftHours: number | string;
  annualLeaveHours: number | string;
  sickLeaveHours: number | string;
  familyLeaveHours: number | string;
  studyLeaveHours: number | string;
  unpaidLeaveHours: number | string;
  workedShiftsCount: number;
  missingPayrollCode?: boolean;
  employee?: {
    id: string;
    employeeNumber: string;
    externalPayrollCode?: string | null;
    firstName: string;
    lastName: string;
  };
  site?: {
    id: string;
    name: string;
    costCenterCode?: string | null;
  } | null;
}

export interface ExportPreviewResponse {
  period: ExportPeriodOption;
  profile: {
    id: string;
    name: string;
    provider: PayrollExportProvider;
    splitBySite: boolean;
    delimiter: string;
    dateFormat: string;
  };
  readiness: ExportReadinessInfo;
  blockers: string[];
  missingCodeEmployees: Array<{
    employeeId: string;
    employeeNumber: string;
    employeeFullName: string;
  }>;
  summary: {
    employeeCount: number;
    lineCount: number;
    totalBasicHours: number;
    totalOvertimeHours: number;
    totalSundayHours: number;
    totalPublicHolidayHours: number;
    totalNightShiftHours: number;
    totalPaidLeaveHours: number;
    totalUnpaidLeaveHours: number;
  };
  lines: ExportLineItem[];
  renderedPreview: {
    filename: string;
    mimeType: string;
    content: string;
  };
}

export interface PayrollExportBatch {
  id: string;
  profileId: string;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollExportBatchStatus;
  employeeCount: number;
  totalBasicHours: number | string;
  totalOvertimeHours: number | string;
  totalSundayHours: number | string;
  totalPublicHolidayHours: number | string;
  totalNightShiftHours: number | string;
  totalPaidLeaveHours: number | string;
  totalUnpaidLeaveHours: number | string;
  readinessSnapshotJson?: Record<string, unknown> | null;
  overrideReason?: string | null;
  checksumSha256?: string | null;
  lockedAt?: string | null;
  exportedAt?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  createdAt: string;
  profile: {
    id: string;
    name: string;
    provider: PayrollExportProvider;
    delimiter?: string;
    dateFormat?: string;
    splitBySite?: boolean;
  };
  _count?: { lines: number };
  lines?: ExportLineItem[];
}

export interface ExportReadinessResponse {
  period: ExportPeriodOption;
  readiness: ExportReadinessInfo;
  unmappedEmployees: Array<{
    id: string;
    employeeNumber: string;
    firstName: string;
    lastName: string;
    employeeType: string;
  }>;
  existingBatches: Array<{
    id: string;
    status: PayrollExportBatchStatus;
    profileId: string;
    employeeCount: number;
    createdAt: string;
    lockedAt?: string | null;
    exportedAt?: string | null;
    voidedAt?: string | null;
  }>;
}

async function parseResponse<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = err as { message?: string; error?: string; blockers?: string[] };
    const msg =
      typeof e.message === "string"
        ? e.blockers?.length
          ? `${e.message} (${e.blockers.join("; ")})`
          : e.message
        : e.error || fallback;
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function listExportProfiles(token: string): Promise<PayrollExportProfile[]> {
  const res = await authFetch("/payroll-exports/profiles", token);
  const body = await parseResponse<{ profiles: PayrollExportProfile[] }>(
    res,
    "Failed to load export profiles"
  );
  return body.profiles;
}

export async function createExportProfile(
  token: string,
  data: Partial<PayrollExportProfile>
): Promise<PayrollExportProfile> {
  const res = await authFetch("/payroll-exports/profiles", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return parseResponse(res, "Failed to create export profile");
}

export async function updateExportProfile(
  token: string,
  id: string,
  data: Partial<PayrollExportProfile>
): Promise<PayrollExportProfile> {
  const res = await authFetch(`/payroll-exports/profiles/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return parseResponse(res, "Failed to update export profile");
}

export async function deleteExportProfile(token: string, id: string): Promise<void> {
  const res = await authFetch(`/payroll-exports/profiles/${id}`, token, { method: "DELETE" });
  return parseResponse(res, "Failed to delete export profile");
}

export async function listExportPeriods(token: string): Promise<ExportPeriodOption[]> {
  const res = await authFetch("/payroll-exports/periods", token);
  const body = await parseResponse<{ periods: ExportPeriodOption[] }>(
    res,
    "Failed to load export periods"
  );
  return body.periods;
}

export async function getExportReadinessSummary(
  token: string,
  periodKey?: string
): Promise<ExportReadinessResponse> {
  const q = periodKey ? `?periodKey=${encodeURIComponent(periodKey)}` : "";
  const res = await authFetch(`/payroll-exports/readiness${q}`, token);
  return parseResponse(res, "Failed to load export readiness");
}

export async function previewPayrollExport(
  token: string,
  params: { periodKey?: string; profileId?: string; splitBySite?: boolean }
): Promise<ExportPreviewResponse> {
  const res = await authFetch("/payroll-exports/preview", token, {
    method: "POST",
    body: JSON.stringify(params),
  });
  return parseResponse(res, "Failed to preview payroll export");
}

export async function listExportBatches(
  token: string,
  filters?: { periodKey?: string; status?: string }
): Promise<PayrollExportBatch[]> {
  const q = new URLSearchParams();
  if (filters?.periodKey) q.set("periodKey", filters.periodKey);
  if (filters?.status) q.set("status", filters.status);
  const qs = q.toString();
  const res = await authFetch(`/payroll-exports/batches${qs ? `?${qs}` : ""}`, token);
  const body = await parseResponse<{ batches: PayrollExportBatch[] }>(
    res,
    "Failed to load export batches"
  );
  return body.batches;
}

export async function getExportBatchDetail(
  token: string,
  batchId: string
): Promise<PayrollExportBatch> {
  const res = await authFetch(`/payroll-exports/batches/${batchId}`, token);
  return parseResponse(res, "Failed to load batch detail");
}

export async function createExportBatch(
  token: string,
  data: { periodKey?: string; profileId?: string; splitBySite?: boolean; overrideReason?: string }
): Promise<PayrollExportBatch> {
  const res = await authFetch("/payroll-exports/batches", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return parseResponse(res, "Failed to create export batch snapshot");
}

export async function deleteDraftExportBatch(token: string, batchId: string): Promise<void> {
  const res = await authFetch(`/payroll-exports/batches/${batchId}`, token, {
    method: "DELETE",
  });
  return parseResponse(res, "Failed to delete draft batch");
}

export async function lockExportBatch(
  token: string,
  batchId: string,
  overrideReason?: string
): Promise<PayrollExportBatch> {
  const res = await authFetch(`/payroll-exports/batches/${batchId}/lock`, token, {
    method: "POST",
    body: JSON.stringify(overrideReason ? { overrideReason } : {}),
  });
  return parseResponse(res, "Failed to lock export batch");
}

export async function voidExportBatch(
  token: string,
  batchId: string,
  reason: string
): Promise<PayrollExportBatch> {
  const res = await authFetch(`/payroll-exports/batches/${batchId}/void`, token, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
  return parseResponse(res, "Failed to void export batch");
}

async function triggerAuthenticatedDownload(
  url: string,
  token: string,
  fallbackFilename: string
): Promise<void> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string; error?: string }).message ||
        (err as { error?: string }).error ||
        "Download failed"
    );
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition");
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? fallbackFilename;
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

export async function downloadExportBatchFile(
  token: string,
  batchId: string,
  fallbackFilename = `payroll-export-${batchId}.csv`
): Promise<void> {
  await triggerAuthenticatedDownload(
    buildApiUrl(`payroll-exports/batches/${batchId}/download`),
    token,
    fallbackFilename
  );
}

export async function downloadSageEmployeeMasterCsv(token: string): Promise<void> {
  await triggerAuthenticatedDownload(
    buildApiUrl("payroll-exports/employee-master.csv"),
    token,
    "sage-employee-master.csv"
  );
}
