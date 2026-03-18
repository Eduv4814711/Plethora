// Use /api proxy to avoid CORS - Next.js rewrites /api/* to the backend
const API_BASE = "/api";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  companyId: string;
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function login(
  email: string,
  password: string,
  companyId?: string
): Promise<LoginResponse> {
  const url = `${API_BASE}/auth/login`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, companyId }),
    });
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : "Network error";
    throw new Error(
      msg.includes("fetch") || msg.includes("Failed") || msg.includes("Network")
        ? "Cannot connect to server. Ensure the API is running (npm run dev:api)."
        : msg
    );
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      err?.message ||
      err?.error ||
      (res.status === 401 ? "Invalid email or password" : "Login failed");
    const statusHint = res.status === 404 ? " (API route not found – check API is on port 3001)" : res.status === 502 ? " (API unreachable)" : "";
    throw new Error(message + statusHint);
  }
  try {
    const data = await res.json();
    return data;
  } catch (parseErr) {
    throw new Error("Invalid response from server");
  }
}

export interface OnboardPayload {
  company: { name: string };
  admin: { name: string; email: string; password: string };
}

export async function onboardCompany(payload: OnboardPayload): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      err?.message ||
      err?.error ||
      (res.status === 409 ? "This email is already registered. Sign in or use a different email." : "Sign-up failed");
    throw new Error(message);
  }
  return res.json();
}

export async function refreshToken(refreshToken: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new Error("Token refresh failed");
  return res.json();
}

export interface CompanySettings {
  id: string;
  name: string;
  legalName?: string | null;
  registrationNumber?: string | null;
  taxNumber?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  website?: string | null;
  fax?: string | null;
  psiraRegistration?: string | null;
  uifReference?: string | null;
  payeReference?: string | null;
  sdlReference?: string | null;
  sdlLiableFrom?: string | null;
  monthlyPayrollTotals?: Record<string, number> | null;
  settings?: {
    currency?: string;
    dateFormat?: string;
    timezone?: string;
    payrollPeriod?: "weekly" | "biweekly" | "monthly";
    employeeIdPrefix?: string;
  } | null;
}

export async function getMe(token: string): Promise<AuthUser & { company: CompanySettings }> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

export async function getSettings(token: string): Promise<CompanySettings> {
  const res = await fetch(`${API_BASE}/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function updateSettings(
  token: string,
  data: Partial<{
    name: string;
    businessDetails: Partial<{
      legalName: string;
      registrationNumber: string;
      taxNumber: string;
      address: string;
      phone: string;
      email: string;
      logoUrl: string;
      website: string;
      fax: string;
      psiraRegistration: string;
      uifReference: string;
      payeReference: string;
      sdlReference: string;
    }>;
    businessSettings: Partial<{
      currency: string;
      dateFormat: string;
      timezone: string;
      payrollPeriod: "weekly" | "biweekly" | "monthly";
      employeeIdPrefix: string;
    }>;
  }>
): Promise<CompanySettings> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to update settings");
  }
  return res.json();
}

export const FACTORY_RESET_MODULES = [
  { id: "employees", label: "Team", description: "Clear all team members, assignments, leave records, and deductions" },
  { id: "sites", label: "Sites", description: "Clear sites, posts, and site/post assignments" },
  { id: "shifts", label: "Shifts", description: "Clear shifts and attendance records" },
  { id: "attendance", label: "Attendance", description: "Clear clock-in/out records only (shifts remain). Optionally for one person." },
  { id: "payroll", label: "Payroll", description: "Clear payroll runs, items, and payslips" },
  { id: "timesheets", label: "Timesheets", description: "Clear all timesheet records" },
  { id: "payRules", label: "Pay Rules", description: "Reset to defaults: overtime, sunday, public holiday rates; UIF, PSIRA" },
  { id: "publicHolidays", label: "Public Holidays", description: "Reset to SA public holidays (2025–2026)" },
  { id: "auditLogs", label: "Audit Logs", description: "Clear activity and audit history" },
  { id: "companySettings", label: "Company Settings", description: "Reset company name, business details, and settings to defaults" },
] as const;

export type FactoryResetModuleId = (typeof FACTORY_RESET_MODULES)[number]["id"];
export type FactoryResetResponse = CompanySettings | { companyDeleted: true };

export async function factoryReset(
  token: string,
  modules?: FactoryResetModuleId[],
  options?: { attendanceEmployeeId?: string; attendanceFromDate?: string }
): Promise<FactoryResetResponse> {
  const body: Record<string, unknown> = modules && modules.length > 0 ? { modules } : {};
  if (options?.attendanceEmployeeId) body.attendanceEmployeeId = options.attendanceEmployeeId;
  if (options?.attendanceFromDate) body.attendanceFromDate = options.attendanceFromDate;
  const res = await fetch(`${API_BASE}/settings/factory-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(Object.keys(body).length > 0 ? body : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Factory reset failed");
  }
  return res.json();
}

export async function uploadLogo(token: string, file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/uploads/logo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Upload failed");
  }
  return res.json();
}

/** Callback for refreshing token on 401. Set by AuthProvider. */
let tokenRefreshCallback: (() => Promise<string | null>) | null = null;

export function registerTokenRefreshCallback(cb: () => Promise<string | null>) {
  tokenRefreshCallback = cb;
}

export async function authFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const doFetch = (t: string) => {
    const hasBody = init?.body !== undefined && init?.body !== null && init?.body !== "";
    const isFormData = init?.body instanceof FormData;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${t}`,
      ...(hasBody && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    };
    return fetch(`${API_BASE}${url}`, { ...init, headers });
  };

  let res = await doFetch(token);
  if (res.status === 401 && tokenRefreshCallback) {
    const newToken = await tokenRefreshCallback();
    if (newToken) {
      res = await doFetch(newToken);
    }
  }
  return res;
}

// User management (admin only)
export type UserRole = "admin" | "operations_manager" | "hr_payroll" | "supervisor" | "controller";

export interface UserListItem {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  companyId: string;
  createdAt: string;
}

export async function listUsers(token: string): Promise<{ data: UserListItem[]; total: number }> {
  const res = await authFetch("/users", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to fetch users");
  }
  return res.json();
}

export async function createUser(
  token: string,
  data: { name: string; email: string; password: string; role: UserRole }
): Promise<UserListItem> {
  const res = await authFetch("/users", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.message?.email?.[0] ?? err?.message ?? "Failed to create user";
    throw new Error(typeof msg === "string" ? msg : "Failed to create user");
  }
  return res.json();
}

export async function updateUser(
  token: string,
  id: string,
  data: Partial<{ name: string; email: string; password: string; role: UserRole }>
): Promise<UserListItem> {
  const res = await authFetch(`/users/${id}`, token, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to update user");
  }
  return res.json();
}

export async function deleteUser(token: string, id: string): Promise<void> {
  const res = await authFetch(`/users/${id}`, token, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to delete user");
  }
}

// Companies (multi-tenant registration)
export interface CompanyListItem {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCompanyPayload {
  name: string;
  admin: { name: string; email: string; password: string };
}

export interface CreateCompanyResponse extends CompanyListItem {
  adminUser: { id: string; name: string; email: string; role: string };
}

export async function listCompanies(token: string): Promise<{ data: CompanyListItem[]; total: number; limit: number; offset: number }> {
  const res = await authFetch("/companies", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to fetch companies");
  }
  return res.json();
}

export async function createCompany(token: string, payload: CreateCompanyPayload): Promise<CreateCompanyResponse> {
  const res = await authFetch("/companies", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.message ?? err?.error ?? "Failed to create company";
    const messageStr =
      typeof msg === "string"
        ? msg
        : typeof msg === "object" && msg !== null
          ? Object.entries(msg)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
              .join("; ")
          : "Failed to create company";
    throw new Error(messageStr);
  }
  return res.json();
}

// Global search
export interface SearchEmployee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  status: string;
}

export interface SearchSite {
  id: string;
  name: string;
  location: string | null;
}

export interface SearchResults {
  employees: SearchEmployee[];
  sites: SearchSite[];
}

export async function search(token: string, q: string): Promise<SearchResults> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return { employees: [], sites: [] };
  const res = await authFetch(`/search?q=${encodeURIComponent(trimmed)}`, token);
  if (!res.ok) return { employees: [], sites: [] };
  return res.json();
}

// WhatsApp
export interface WhatsAppContact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  whatsappUrl: string | null;
}

export interface WhatsAppMessage {
  id: string;
  employeeId: string;
  direction: "inbound" | "outbound";
  type: string;
  text: string | null;
  status: string | null;
  sentByUserId: string | null;
  createdAt: string;
}

export async function getWhatsAppContacts(
  token: string,
  params?: { limit?: number; offset?: number }
): Promise<{ data: WhatsAppContact[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));
  const res = await authFetch(`/whatsapp/contacts?${q.toString()}`, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Failed to fetch contacts");
  }
  const json = await res.json();
  return { data: json.data ?? [], total: json.total ?? 0 };
}

export async function getWhatsAppMessages(
  token: string,
  employeeId: string,
  params?: { limit?: number; before?: string }
): Promise<{ data: WhatsAppMessage[]; hasMore: boolean }> {
  const q = new URLSearchParams({ employeeId });
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.before) q.set("before", params.before);
  const res = await authFetch(`/whatsapp/messages?${q.toString()}`, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Failed to fetch messages");
  }
  const json = await res.json();
  return { data: json.data ?? [], hasMore: json.hasMore ?? false };
}

export async function sendWhatsAppMessage(
  token: string,
  employeeId: string,
  message: string
): Promise<{ success: boolean; error?: string; requiresTemplate?: boolean }> {
  const res = await authFetch("/whatsapp/send", token, {
    method: "POST",
    body: JSON.stringify({ employeeId, message }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    requiresTemplate?: boolean;
  };
  if (!res.ok) {
    return {
      success: false,
      error: data.error ?? "Failed to send message",
      requiresTemplate: data.requiresTemplate,
    };
  }
  return { success: data.success ?? true, error: data.error, requiresTemplate: data.requiresTemplate };
}

export async function sendWhatsAppTemplate(
  token: string,
  employeeId: string,
  templateName: string,
  options?: { languageCode?: string; components?: unknown[] }
): Promise<{ success: boolean; error?: string }> {
  const res = await authFetch("/whatsapp/send-template", token, {
    method: "POST",
    body: JSON.stringify({
      employeeId,
      templateName,
      languageCode: options?.languageCode ?? "en",
      components: options?.components,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!res.ok) {
    return { success: false, error: data.error ?? "Failed to send template" };
  }
  return { success: data.success ?? true, error: data.error };
}

export async function getWhatsAppTemplates(token: string): Promise<{ data: { name: string; language: string }[] }> {
  const res = await authFetch("/whatsapp/templates", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Failed to fetch templates");
  }
  const json = await res.json();
  return { data: json.data ?? [] };
}

// Migration / bulk import
export interface MigrationPreviewResponse {
  companies: { validCount: number; valid: unknown[]; errors: { row: number; field: string; value: string; message: string }[] };
  employees: { validCount: number; valid: unknown[]; errors: { row: number; field: string; value: string; message: string }[] };
  sites: { validCount: number; valid: unknown[]; errors: { row: number; field: string; value: string; message: string }[] };
}

export interface MigrationImportResult {
  companiesCreated: number;
  employeesCreated: number;
  sitesCreated: number;
  errors: { entity: string; row?: number; message: string }[];
}

export async function downloadMigrationTemplate(
  token: string,
  type: "company" | "employees" | "sites"
): Promise<void> {
  const filename = type === "company" ? "company-import-template.csv" : type === "employees" ? "employees-import-template.csv" : "sites-import-template.csv";
  const res = await authFetch(`/migrations/templates/${type}`, token);
  if (!res.ok) throw new Error("Failed to download template");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportEmployees(token: string): Promise<void> {
  const res = await authFetch("/migrations/export/employees", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Export failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "employees-export.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportSites(token: string): Promise<void> {
  const res = await authFetch("/migrations/export/sites", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Export failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sites-export.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export async function migrationPreview(
  token: string,
  files: { companies?: File; employees?: File; sites?: File }
): Promise<MigrationPreviewResponse> {
  const formData = new FormData();
  if (files.companies) formData.append("companies", files.companies);
  if (files.employees) formData.append("employees", files.employees);
  if (files.sites) formData.append("sites", files.sites);

  const res = await fetch(`${API_BASE}/migrations/preview`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Preview failed");
  }
  return res.json();
}

export async function migrationImport(
  token: string,
  files: { employees?: File; sites?: File }
): Promise<MigrationImportResult> {
  const formData = new FormData();
  if (files.employees) formData.append("employees", files.employees);
  if (files.sites) formData.append("sites", files.sites);

  const res = await fetch(`${API_BASE}/migrations/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Import failed");
  }
  return res.json();
}

export async function migrationAdminBulkCreate(
  token: string,
  files: { companies: File; employees?: File; sites?: File }
): Promise<MigrationImportResult> {
  const formData = new FormData();
  formData.append("companies", files.companies);
  if (files.employees) formData.append("employees", files.employees);
  if (files.sites) formData.append("sites", files.sites);

  const res = await fetch(`${API_BASE}/migrations/admin/bulk-create`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Bulk create failed");
  }
  return res.json();
}

// Task Manager
export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface TaskProject {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  sortOrder: number;
  _count?: { tasks: number };
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  projectId?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;
  completedAt?: string | null;
  assigneeType?: string | null;
  assigneeId?: string | null;
  assigneeDisplayName?: string | null;
  recurrenceRule?: Record<string, unknown> | null;
  project?: { id: string; name: string; color?: string | null } | null;
  createdBy?: { id: string; name: string; email: string };
  comments?: TaskComment[];
  attachments?: TaskAttachment[];
  reminders?: TaskReminder[];
}

export interface TaskComment {
  id: string;
  body: string;
  userId: string;
  createdAt: string;
  user?: { id: string; name: string; email: string };
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface TaskReminder {
  id: string;
  taskId: string;
  remindAt: string;
  sentAt?: string | null;
}

export async function listTaskProjects(token: string): Promise<{ data: TaskProject[] }> {
  const res = await authFetch("/task-projects", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to fetch projects");
  }
  return res.json();
}

export async function createTaskProject(
  token: string,
  data: { name: string; description?: string; color?: string; sortOrder?: number }
): Promise<TaskProject> {
  const res = await authFetch("/task-projects", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to create project");
  }
  return res.json();
}

export async function getTaskProject(token: string, id: string): Promise<TaskProject & { tasks: Task[] }> {
  const res = await authFetch(`/task-projects/${id}`, token);
  if (!res.ok) {
    if (res.status === 404) throw new Error("Project not found");
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to fetch project");
  }
  return res.json();
}

export async function updateTaskProject(
  token: string,
  id: string,
  data: Partial<{ name: string; description: string | null; color: string | null; sortOrder: number }>
): Promise<TaskProject> {
  const res = await authFetch(`/task-projects/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to update project");
  }
  return res.json();
}

export async function deleteTaskProject(token: string, id: string): Promise<void> {
  const res = await authFetch(`/task-projects/${id}`, token, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to delete project");
  }
}

export interface AssigneeOption {
  id: string;
  type: "user" | "employee";
  displayName: string;
  subtitle: string;
}

export async function listTaskAssignees(
  token: string
): Promise<{ users: AssigneeOption[]; employees: AssigneeOption[] }> {
  const res = await authFetch("/tasks/assignees", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to fetch assignees");
  }
  return res.json();
}

export async function listTasks(
  token: string,
  params?: { projectId?: string; status?: TaskStatus; assigneeId?: string; limit?: number; offset?: number }
): Promise<{ data: Task[]; total: number; limit: number; offset: number }> {
  const q = new URLSearchParams();
  if (params?.projectId) q.set("projectId", params.projectId);
  if (params?.status) q.set("status", params.status);
  if (params?.assigneeId) q.set("assigneeId", params.assigneeId);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));
  const res = await authFetch(`/tasks?${q.toString()}`, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to fetch tasks");
  }
  return res.json();
}

export async function createTask(
  token: string,
  data: {
    title: string;
    description?: string;
    projectId?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
    assigneeType?: "employee" | "user" | null;
    assigneeId?: string | null;
    recurrenceRule?: Record<string, unknown> | null;
  }
): Promise<Task> {
  const res = await authFetch("/tasks", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.message ?? "Failed to create task";
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return res.json();
}

export async function getTask(token: string, id: string): Promise<Task> {
  const res = await authFetch(`/tasks/${id}`, token);
  if (!res.ok) {
    if (res.status === 404) throw new Error("Task not found");
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to fetch task");
  }
  return res.json();
}

export async function updateTask(
  token: string,
  id: string,
  data: Partial<{
    title: string;
    description: string | null;
    projectId: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
    assigneeType: "employee" | "user" | null;
    assigneeId: string | null;
    recurrenceRule: Record<string, unknown> | null;
  }>
): Promise<Task> {
  const res = await authFetch(`/tasks/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to update task");
  }
  return res.json();
}

export async function deleteTask(token: string, id: string): Promise<void> {
  const res = await authFetch(`/tasks/${id}`, token, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to delete task");
  }
}

export async function completeTask(token: string, id: string): Promise<Task> {
  const res = await authFetch(`/tasks/${id}/complete`, token, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to complete task");
  }
  return res.json();
}

export async function reopenTask(token: string, id: string): Promise<Task> {
  const res = await authFetch(`/tasks/${id}/reopen`, token, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to reopen task");
  }
  return res.json();
}

export async function listTaskComments(token: string, taskId: string): Promise<{ data: TaskComment[] }> {
  const res = await authFetch(`/task-comments/tasks/${taskId}/comments`, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to fetch comments");
  }
  return res.json();
}

export async function addTaskComment(token: string, taskId: string, body: string): Promise<TaskComment> {
  const res = await authFetch(`/task-comments/tasks/${taskId}/comments`, token, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to add comment");
  }
  return res.json();
}

export async function uploadTaskAttachment(token: string, taskId: string, file: File): Promise<TaskAttachment> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await authFetch(`/task-attachments/tasks/${taskId}/attachments`, token, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Upload failed");
  }
  return res.json();
}

export async function deleteTaskAttachment(token: string, id: string): Promise<void> {
  const res = await authFetch(`/task-attachments/attachments/${id}`, token, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to delete attachment");
  }
}

export async function addTaskReminder(token: string, taskId: string, remindAt: string): Promise<TaskReminder> {
  const res = await authFetch(`/task-reminders/tasks/${taskId}/reminders`, token, {
    method: "POST",
    body: JSON.stringify({ remindAt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to add reminder");
  }
  return res.json();
}

export async function listUpcomingReminders(token: string): Promise<{ data: (TaskReminder & { task: { id: string; title: string; dueDate?: string | null } })[] }> {
  const res = await authFetch("/task-reminders/reminders/upcoming", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to fetch reminders");
  }
  return res.json();
}

export async function deleteTaskReminder(token: string, id: string): Promise<void> {
  const res = await authFetch(`/task-reminders/reminders/${id}`, token, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to delete reminder");
  }
}
