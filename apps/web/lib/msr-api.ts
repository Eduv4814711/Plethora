import { authFetch, buildApiUrl } from "./api";

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

// ——— Documents ———

export interface ManagedDocument {
  id: string;
  title: string;
  documentType: string;
  category: string;
  status: string;
  fileName: string;
  downloadUrl?: string;
  expiryDate?: string | null;
  createdAt: string;
  site?: { id: string; name: string } | null;
  employee?: { id: string; firstName: string; lastName: string } | null;
}

export async function listDocuments(
  token: string,
  params?: Record<string, string | number | undefined>
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

export async function uploadDocument(
  token: string,
  file: File,
  meta: Record<string, string>
): Promise<ManagedDocument> {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(meta)) {
    if (v) form.append(k, v);
  }
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
  _count?: { sites: number };
}

export async function listClients(token: string): Promise<ClientRecord[]> {
  const res = await authFetch("/clients", token);
  return parseJson(res, "Failed to load clients");
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
  data: { name: string; email?: string; phone?: string; userId?: string }
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
  data: Partial<{ name: string; email: string | null; phone: string | null; userId: string | null; isActive: boolean }>
): Promise<ClientRecord> {
  const res = await authFetch(`/clients/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return parseJson(res, "Failed to update client");
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
