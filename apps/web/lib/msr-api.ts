import { authFetch, buildApiUrl } from "./api";
import { downloadAttachment } from "./download";

async function parseJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string; error?: string }).message ||
        (err as { error?: string }).error ||
        fallback
    );
  }
  return res.json();
}

// ——— Alerts ———

export type AlertPriority = "CRITICAL" | "MEDIUM" | "LOW";
export type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";

export interface OperationalAlert {
  id: string;
  title: string;
  message: string;
  priority: AlertPriority;
  status: AlertStatus;
  sourceModule: string;
  sourceId?: string | null;
  siteId?: string | null;
  employeeId?: string | null;
  /** Source-specific context (dateKey, shiftType, code, periodStart…) used to build fix links. */
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface AlertCounts {
  critical: number;
  medium: number;
  low: number;
  allOpen: number;
  resolved: number;
  total: number;
}

export async function listAlerts(
  token: string,
  params?: { priority?: AlertPriority; status?: AlertStatus; limit?: number }
): Promise<{ items: OperationalAlert[]; total: number; counts: AlertCounts }> {
  const q = new URLSearchParams();
  if (params?.priority) q.set("priority", params.priority);
  if (params?.status) q.set("status", params.status);
  if (params?.limit) q.set("limit", String(params.limit));
  const res = await authFetch(`/alerts?${q.toString()}`, token);
  return parseJson(res, "Failed to load alerts");
}

export async function getAlertCounts(token: string): Promise<AlertCounts> {
  const res = await authFetch("/alerts/counts", token);
  return parseJson(res, "Failed to load alert counts");
}

export async function acknowledgeAlert(token: string, id: string): Promise<OperationalAlert> {
  const res = await authFetch(`/alerts/${id}/acknowledge`, token, { method: "POST" });
  return parseJson(res, "Failed to acknowledge alert");
}

export async function resolveAlert(token: string, id: string, note?: string): Promise<OperationalAlert> {
  const res = await authFetch(`/alerts/${id}/resolve`, token, {
    method: "POST",
    body: JSON.stringify(note ? { note } : {}),
  });
  return parseJson(res, "Failed to resolve alert");
}

export async function dismissAlert(token: string, id: string): Promise<OperationalAlert> {
  const res = await authFetch(`/alerts/${id}/dismiss`, token, { method: "POST" });
  return parseJson(res, "Failed to dismiss alert");
}

// ——— Approvals ———

export interface ApprovalRequest {
  id: string;
  approvalType: string;
  entityType: string;
  entityId: string;
  status: string;
  comment?: string | null;
  requestedAt: string;
  requestedBy: { id: string; name: string; email: string };
  approver?: { id: string; name: string; email: string } | null;
}

export async function listApprovals(
  token: string,
  params?: { status?: string; mine?: boolean }
): Promise<{ items: ApprovalRequest[]; pendingCount: number }> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.mine) q.set("mine", "true");
  const res = await authFetch(`/approvals?${q.toString()}`, token);
  return parseJson(res, "Failed to load approvals");
}

export async function reviewApproval(
  token: string,
  id: string,
  action: "approve" | "reject" | "query",
  comment?: string
): Promise<ApprovalRequest> {
  const res = await authFetch(`/approvals/${id}/review`, token, {
    method: "POST",
    body: JSON.stringify({ action, comment }),
  });
  return parseJson(res, "Failed to review approval");
}

// ——— Incidents ———

export interface Incident {
  id: string;
  incidentNumber: string;
  title: string;
  description: string;
  incidentType: string;
  severity: string;
  status: string;
  incidentDateTime: string;
  peopleInvolved?: string | null;
  witnesses?: string | null;
  clientVisible?: boolean;
  followUpRequired?: boolean;
  supervisorApprovalStatus?: string;
  attachments?: { id: string; filename: string; downloadUrl?: string; mimeType: string }[];
  site?: { id: string; name: string };
  reportedBy?: { id: string; name: string };
}

export async function listIncidents(
  token: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<{ items: Incident[]; total: number }> {
  const q = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
  }
  const res = await authFetch(`/incidents?${q.toString()}`, token);
  return parseJson(res, "Failed to load incidents");
}

export async function getIncident(token: string, id: string): Promise<Incident> {
  const res = await authFetch(`/incidents/${id}`, token);
  return parseJson(res, "Failed to load incident");
}

export async function createIncident(token: string, data: Record<string, unknown>): Promise<Incident> {
  const res = await authFetch("/incidents", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return parseJson(res, "Failed to create incident");
}

export async function reviewIncident(
  token: string,
  id: string,
  action: "approve" | "reject" | "query" | "close" | "submit",
  note?: string
): Promise<unknown> {
  const res = await authFetch(`/incidents/${id}/review`, token, {
    method: "POST",
    body: JSON.stringify({ action, note }),
  });
  return parseJson(res, "Failed to review incident");
}

// ——— Documents & Compliance ———

export interface DocumentTypeDefinition {
  type: string;
  label: string;
  category: string;
  categoryLabel: string;
  isSensitive?: boolean;
  requiresExpiry?: boolean;
  defaultAuthority?: string;
  description?: string;
}

export interface ExpiryEvaluation {
  state: "VALID" | "EXPIRING_SOON_7D" | "EXPIRING_SOON_30D" | "EXPIRING_SOON_60D" | "EXPIRING_SOON_90D" | "EXPIRED" | "NO_EXPIRY";
  daysUntilExpiry: number | null;
  hasExpired: boolean;
  isExpiringSoon: boolean;
  label: string;
}

export interface ManagedDocument {
  id: string;
  title: string;
  documentType: string;
  category: string;
  documentCategory?: string | null;
  documentNumber?: string | null;
  issuingAuthority?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  doesNotExpire?: boolean;
  isSensitive?: boolean;
  verificationStatus?: string;
  verifiedById?: string | null;
  verifiedAt?: string | null;
  rejectionReason?: string | null;
  notes?: string | null;
  status: string;
  fileName: string;
  downloadUrl?: string;
  createdAt: string;
  updatedAt?: string;
  site?: { id: string; name: string } | null;
  employee?: { id: string; firstName: string; lastName: string; employeeNumber?: string } | null;
  uploadedBy?: { id: string; name: string; email?: string } | null;
  verifiedBy?: { id: string; name: string; email?: string } | null;
  expiryState?: ExpiryEvaluation;
  typeDefinition?: DocumentTypeDefinition;
}

export type OverallComplianceStatus = "COMPLIANT" | "ATTENTION_REQUIRED" | "NON_COMPLIANT";

export interface RequiredDocumentRule {
  type: string;
  label: string;
  category: string;
  reason: string;
  isRequired: boolean;
}

export interface RequirementEvaluation {
  rule: RequiredDocumentRule;
  status: "VERIFIED" | "VALID" | "EXPIRING_SOON" | "EXPIRED" | "PENDING_VERIFICATION" | "REJECTED" | "MISSING";
  documentId?: string;
  documentName?: string;
  fileName?: string;
  verificationStatus?: string;
  issueDate?: string | null;
  expiryDate?: string | null;
  daysUntilExpiry?: number | null;
  expiryLabel?: string;
}

export interface EmployeeComplianceDetail {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  employeeType: string;
  status: string;
  jobRole?: string | null;
  psiraGrade?: string | null;
  psiraRegistrationNumber?: string | null;
  overallStatus: OverallComplianceStatus;
  summary: {
    totalRequired: number;
    verifiedCount: number;
    pendingCount: number;
    expiringCount: number;
    expiredCount: number;
    missingCount: number;
  };
  requirements: RequirementEvaluation[];
  activeCertificates: Array<{
    id: string;
    type: string;
    label: string;
    category: string;
    documentNumber?: string | null;
    issuingAuthority?: string | null;
    verificationStatus: string;
    expiryDate?: string | null;
    expiryLabel?: string;
    hasExpired: boolean;
    isExpiringSoon: boolean;
  }>;
  totalDocumentsCount: number;
}

export interface CompanyComplianceSummary {
  totalEmployees: number;
  fullyCompliantCount: number;
  attentionRequiredCount: number;
  nonCompliantCount: number;
  complianceRatePercent: number;
  documentsExpiringSoonCount: number;
  employeesMissingDocumentsCount: number;
  employeesWithExpiredDocumentsCount: number;
  psiraVerificationPendingCount: number;
}

export async function listDocuments(
  token: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<{ items: ManagedDocument[]; total: number }> {
  const q = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
  }
  const res = await authFetch(`/documents?${q.toString()}`, token);
  return parseJson(res, "Failed to load documents");
}

export async function getDocumentTaxonomy(token: string): Promise<{
  categories: Record<string, { label: string; description: string; isSensitive?: boolean }>;
  taxonomy: DocumentTypeDefinition[];
}> {
  const res = await authFetch("/documents/taxonomy", token);
  return parseJson(res, "Failed to load document taxonomy");
}

export async function getEmployeeDocuments(
  token: string,
  employeeId: string,
  params?: Record<string, string | number | undefined>
): Promise<{ items: ManagedDocument[]; total: number }> {
  const q = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
  }
  const res = await authFetch(`/employees/${employeeId}/documents?${q.toString()}`, token);
  return parseJson(res, "Failed to load employee documents");
}

export async function getEmployeeCompliance(
  token: string,
  employeeId: string
): Promise<EmployeeComplianceDetail> {
  const res = await authFetch(`/employees/${employeeId}/compliance`, token);
  return parseJson(res, "Failed to load employee compliance");
}

export async function getCompanyComplianceSummary(
  token: string
): Promise<CompanyComplianceSummary> {
  const res = await authFetch("/employees/compliance-summary", token);
  return parseJson(res, "Failed to load company compliance summary");
}

export async function getCompanyComplianceReport(
  token: string,
  params?: Record<string, string | number | undefined>
): Promise<{ items: EmployeeComplianceDetail[]; total: number }> {
  const q = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
  }
  const res = await authFetch(`/employees/compliance-report?${q.toString()}`, token);
  return parseJson(res, "Failed to load compliance report");
}

export async function verifyDocument(token: string, documentId: string): Promise<ManagedDocument> {
  const res = await authFetch(`/documents/${documentId}/verify`, token, { method: "POST" });
  return parseJson(res, "Failed to verify document");
}

export async function rejectDocument(
  token: string,
  documentId: string,
  rejectionReason: string
): Promise<ManagedDocument> {
  const res = await authFetch(`/documents/${documentId}/reject`, token, {
    method: "POST",
    body: JSON.stringify({ rejectionReason }),
  });
  return parseJson(res, "Failed to reject document");
}

export async function updateDocumentMetadata(
  token: string,
  documentId: string,
  data: Record<string, unknown>
): Promise<ManagedDocument> {
  const res = await authFetch(`/documents/${documentId}`, token, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return parseJson(res, "Failed to update document metadata");
}

export async function uploadDocument(
  token: string,
  file: File,
  meta: Record<string, string | boolean | undefined>
): Promise<ManagedDocument> {
  const form = new FormData();
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined && v !== null && v !== "") form.append(k, String(v));
  }
  form.append("file", file);
  const csrf =
    typeof document !== "undefined"
      ? document.cookie.match(/(?:^|;\s*)plethora_csrf=([^;]*)/)?.[1]
      : null;
  const res = await fetch(buildApiUrl("documents/upload"), {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}),
    },
    body: form,
  });
  return parseJson(res, "Failed to upload document");
}

// ——— Attendance exceptions ———

export interface AttendanceException {
  id: string;
  exceptionType: string;
  severity: string;
  status: string;
  detectedAt: string;
  reviewNote?: string | null;
  employee?: { id: string; firstName: string; lastName: string };
  site?: { id: string; name: string };
  shift?: { id: string; startTime: string; endTime: string };
}

export async function listAttendanceExceptions(
  token: string,
  params?: Record<string, string | number | undefined>
): Promise<{ items: AttendanceException[]; total: number }> {
  const q = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
  }
  const res = await authFetch(`/attendance-exceptions?${q.toString()}`, token);
  return parseJson(res, "Failed to load exceptions");
}

export async function reviewAttendanceException(
  token: string,
  id: string,
  action: "approve" | "reject" | "resolve" | "under_review" | "mark_absent",
  reviewNote?: string
): Promise<AttendanceException> {
  const res = await authFetch(`/attendance-exceptions/${id}/review`, token, {
    method: "PATCH",
    body: JSON.stringify({ action, reviewNote }),
  });
  return parseJson(res, "Failed to review exception");
}

export async function detectAttendanceExceptions(
  token: string,
  body?: { siteId?: string; lookbackHours?: number }
): Promise<{ scanned: number; created: number }> {
  const res = await authFetch("/attendance-exceptions/detect", token, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
  return parseJson(res, "Failed to detect exceptions");
}

export type AttendanceExceptionAnalytics = {
  total: number;
  openCount: number;
  openCritical: number;
  lateArrivals: number;
  missedClockIns: number;
  missedClockOuts: number;
  earlyDepartures: number;
  absences: number;
  completionRate: number;
  absenteePercentage: number;
  byType: Array<{ type: string; count: number }>;
  bySeverity: Array<{ severity: string; count: number }>;
  bySite: Array<{ siteId: string | null; count: number }>;
  byEmployee: Array<{ employeeId: string | null; count: number }>;
};

export async function getExceptionAnalytics(
  token: string,
  params?: { periodStart?: string; periodEnd?: string }
): Promise<AttendanceExceptionAnalytics> {
  const q = new URLSearchParams();
  if (params?.periodStart) q.set("periodStart", params.periodStart);
  if (params?.periodEnd) q.set("periodEnd", params.periodEnd);
  const res = await authFetch(`/attendance-exceptions/analytics?${q.toString()}`, token);
  return parseJson(res, "Failed to load analytics");
}

export async function getPayrollReadiness(token: string): Promise<{
  status: string;
  openExceptions: number;
}> {
  const res = await authFetch("/attendance-exceptions/payroll-readiness", token);
  return parseJson(res, "Failed to load payroll readiness");
}

export async function uploadIncidentAttachment(
  token: string,
  incidentId: string,
  file: File
): Promise<unknown> {
  const form = new FormData();
  form.append("file", file);
  const csrf =
    typeof document !== "undefined"
      ? document.cookie.match(/(?:^|;\s*)plethora_csrf=([^;]*)/)?.[1]
      : null;
  const res = await fetch(buildApiUrl(`incidents/${incidentId}/attachments`), {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}),
    },
    body: form,
  });
  return parseJson(res, "Failed to upload attachment");
}

// ——— Clients ———

export interface ClientRecord {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  userId?: string | null;
  isActive: boolean;
  billingEmail?: string | null;
  billingAddress?: string | null;
  vatNumber?: string | null;
  registrationNumber?: string | null;
  paymentTermsDays?: number;
  contactPersonName?: string | null;
  contactPersonRole?: string | null;
  contactPersonMobile?: string | null;
  physicalAddress?: string | null;
  notes?: string | null;
  reportRecipients?: string[];
  user?: { id: string; name: string; email: string } | null;
  _count?: { sites: number };
}

export interface ClientSiteSummary {
  id: string;
  name: string;
  siteStatus: string;
  monthlyRevenue: string | null;
  physicalAddress?: string | null;
  serviceType?: string | null;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  contactPersonName?: string | null;
}

export interface ClientDetail extends ClientRecord {
  sites: ClientSiteSummary[];
}

/** Everything the create and update endpoints accept. */
export type ClientWritableFields = {
  name: string;
  email: string | null;
  phone: string | null;
  userId: string | null;
  isActive: boolean;
  billingEmail: string | null;
  billingAddress: string | null;
  vatNumber: string | null;
  registrationNumber: string | null;
  paymentTermsDays: number;
  contactPersonName: string | null;
  contactPersonRole: string | null;
  contactPersonMobile: string | null;
  physicalAddress: string | null;
  notes: string | null;
  /** Replace semantics — always send the whole list. */
  reportRecipients: string[];
};

export async function listClients(token: string): Promise<ClientRecord[]> {
  const res = await authFetch("/clients", token);
  return parseJson(res, "Failed to load clients");
}

export async function getClient(token: string, id: string): Promise<ClientDetail> {
  const res = await authFetch(`/clients/${id}`, token);
  return parseJson(res, "Failed to load client");
}

export interface ClientAccountCandidate {
  id: string;
  name: string;
  email: string;
}

export async function listClientAccountCandidates(
  token: string
): Promise<ClientAccountCandidate[]> {
  const res = await authFetch("/clients/user-candidates", token);
  const body = await parseJson<{ data: ClientAccountCandidate[] }>(
    res,
    "Failed to load client accounts"
  );
  return body.data;
}

export async function createClient(
  token: string,
  data: Partial<ClientWritableFields> & { name: string }
): Promise<ClientRecord> {
  const res = await authFetch("/clients", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return parseJson(res, "Failed to create client");
}

export async function updateClient(
  token: string,
  id: string,
  data: Partial<ClientWritableFields>
): Promise<ClientRecord> {
  const res = await authFetch(`/clients/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return parseJson(res, "Failed to update client");
}

export async function linkClientSites(
  token: string,
  id: string,
  siteIds: string[]
): Promise<{ id: string; name: string; siteStatus: string }[]> {
  const res = await authFetch(`/clients/${id}/sites`, token, {
    method: "POST",
    body: JSON.stringify({ siteIds }),
  });
  const body = await parseJson<{ data: { id: string; name: string; siteStatus: string }[] }>(
    res,
    "Failed to link sites"
  );
  return body.data;
}

export interface LinkableSite {
  id: string;
  name: string;
  clientId: string | null;
}

/**
 * Company sites with just enough shape to offer them for linking.
 * `GET /sites` is paginated (`{ data, total }`, limit capped at 100), so page through —
 * otherwise a company with more than one page silently loses sites from the picker.
 */
export async function listSitesForLinking(token: string): Promise<LinkableSite[]> {
  const pageSize = 100;
  const collected: LinkableSite[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (collected.length < total) {
    const res = await authFetch(`/sites?limit=${pageSize}&offset=${offset}`, token);
    const body = await parseJson<{
      data?: { id: string; name: string; clientId?: string | null }[];
      total?: number;
    }>(res, "Failed to load sites");

    const page = body.data ?? [];
    collected.push(
      ...page.map((site) => ({
        id: site.id,
        name: site.name,
        clientId: site.clientId ?? null,
      }))
    );
    // Stop on a short/empty page too, so a wrong `total` can never spin this forever.
    if (page.length < pageSize) break;
    total = body.total ?? collected.length;
    offset += pageSize;
  }

  return collected;
}

export async function unlinkClientSite(token: string, id: string, siteId: string): Promise<void> {
  const res = await authFetch(`/clients/${id}/sites/${siteId}`, token, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Failed to unlink site");
  }
}

// ——— Month-end client reporting ———

export interface MonthEndSiteRow {
  siteId: string;
  siteName: string;
  timesheetId: string | null;
  timesheetStatus: string;
  rowCount: number;
  totals: {
    dayShifts: number;
    nightShifts: number;
    relieverShifts: number;
    absences: number;
    totalHours: number;
    overtimeHours: number;
    discrepancies: number;
  };
  incidentCount: number;
  exceptionTotal: number;
  warnings: string[];
}

export interface MonthEndSummary {
  client: {
    id: string;
    name: string;
    contactPersonName: string | null;
    contactPersonRole: string | null;
    contactPersonMobile: string | null;
    email: string | null;
    physicalAddress: string | null;
  };
  period: { month: string | null; periodStart: string; periodEnd: string; label: string };
  recipients: string[];
  sites: MonthEndSiteRow[];
  totals: MonthEndSiteRow["totals"] & { incidents: number; exceptions: number };
  otherPeriods: { siteId: string; periodStart: string; periodEnd: string; status: string }[];
  warnings: string[];
}

export async function getClientMonthEndSummary(
  token: string,
  id: string,
  month: string
): Promise<MonthEndSummary> {
  const res = await authFetch(`/clients/${id}/month-end/summary?month=${month}`, token);
  return parseJson(res, "Failed to load month-end summary");
}

export function downloadSiteReportPdf(token: string, id: string, siteId: string, month: string) {
  return downloadAttachment(
    token,
    `/clients/${id}/sites/${siteId}/report.pdf?month=${month}`,
    "site-report.pdf"
  );
}

export function downloadSiteTimesheetPdf(token: string, id: string, siteId: string, month: string) {
  return downloadAttachment(
    token,
    `/clients/${id}/sites/${siteId}/timesheet.pdf?month=${month}`,
    "timesheet.pdf"
  );
}

export function downloadMonthEndPackPdf(
  token: string,
  id: string,
  month: string,
  options: { siteIds?: string[]; includeUnapproved?: boolean } = {}
) {
  const q = new URLSearchParams({ month });
  if (options.siteIds?.length) q.set("siteIds", options.siteIds.join(","));
  if (options.includeUnapproved) q.set("includeUnapproved", "true");
  return downloadAttachment(token, `/clients/${id}/month-end/pack.pdf?${q}`, "month-end-pack.pdf");
}

export function downloadMonthEndTimesheetsCsv(token: string, id: string, month: string) {
  return downloadAttachment(
    token,
    `/clients/${id}/month-end/timesheets.csv?month=${month}`,
    "timesheets.csv"
  );
}

export async function markNotificationRead(token: string, id: string): Promise<void> {
  const res = await authFetch(`/notifications/${id}/read`, token, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Failed to mark notification read");
  }
}

export async function markAllNotificationsRead(token: string): Promise<void> {
  const res = await authFetch("/notifications/read-all", token, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || "Failed to mark all read");
  }
}

export async function getDocument(token: string, id: string): Promise<ManagedDocument> {
  const res = await authFetch(`/documents/${id}`, token);
  return parseJson(res, "Failed to load document");
}

export async function archiveDocument(token: string, id: string): Promise<ManagedDocument> {
  const res = await authFetch(`/documents/${id}/archive`, token, { method: "PATCH" });
  return parseJson(res, "Failed to archive document");
}

export function approvalEntityHref(item: ApprovalRequest): string | null {
  switch (item.entityType) {
    case "AttendanceException":
      return "/attendance/exceptions";
    case "Incident":
      return `/incidents/${item.entityId}`;
    case "ManagedDocument":
      return "/documents";
    case "SiteTimesheet":
      return "/attendance";
    case "Task":
      return `/tasks/${item.entityId}`;
    default:
      return null;
  }
}

// ——— Notifications ———

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  linkUrl?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export async function listNotifications(
  token: string,
  unreadOnly = false
): Promise<{ items: AppNotification[]; unreadCount: number }> {
  const q = new URLSearchParams();
  if (unreadOnly) q.set("unreadOnly", "true");
  const res = await authFetch(`/notifications?${q.toString()}`, token);
  return parseJson(res, "Failed to load notifications");
}

// ——— Client portal ———

export async function getClientPortalDashboard(
  token: string,
  clientId?: string
): Promise<Record<string, unknown>> {
  const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  const res = await authFetch(`/client-portal/dashboard${q}`, token);
  return parseJson(res, "Failed to load client dashboard");
}

export async function getClientPortalSites(token: string, clientId?: string): Promise<unknown[]> {
  const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  const res = await authFetch(`/client-portal/sites${q}`, token);
  return parseJson(res, "Failed to load client sites");
}

export async function getClientPortalIncidents(token: string, clientId?: string): Promise<Incident[]> {
  const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  const res = await authFetch(`/client-portal/incidents${q}`, token);
  return parseJson(res, "Failed to load client incidents");
}

export async function getClientAttendanceSummary(
  token: string,
  params?: { clientId?: string; periodStart?: string; periodEnd?: string }
): Promise<Record<string, unknown>> {
  const q = new URLSearchParams();
  if (params?.clientId) q.set("clientId", params.clientId);
  if (params?.periodStart) q.set("periodStart", params.periodStart);
  if (params?.periodEnd) q.set("periodEnd", params.periodEnd);
  const res = await authFetch(`/client-portal/attendance-summary?${q.toString()}`, token);
  return parseJson(res, "Failed to load attendance summary");
}

// ——— Extended reports ———

export interface ExtendedReportType {
  id: string;
  name: string;
}

export async function listExtendedReportTypes(
  token: string
): Promise<{ types: ExtendedReportType[] }> {
  const res = await authFetch("/reports/extended/types", token);
  return parseJson(res, "Failed to load report types");
}

export function extendedReportDownloadUrl(
  type: string,
  format: "csv" | "excel" | "pdf",
  params?: Record<string, string>
): string {
  const q = new URLSearchParams({ format, ...params });
  return buildApiUrl(`reports/extended/${type}?${q.toString()}`);
}

export async function downloadExtendedReport(
  token: string,
  type: string,
  format: "csv" | "excel" | "pdf",
  params?: Record<string, string>
): Promise<void> {
  const url = extendedReportDownloadUrl(type, format, params);
  const res = await fetch(url, {
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string }).message || "Failed to download report"
    );
  }
  const blob = await res.blob();
  const ext = format === "excel" ? "xlsx" : format;
  const disposition = res.headers.get("Content-Disposition");
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? `${type}.${ext}`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
