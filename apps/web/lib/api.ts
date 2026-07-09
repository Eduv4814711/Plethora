export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_REQUIREMENTS_HINT =
  "At least 12 characters. Avoid common words, your name, or the company name.";

function apiErrorMessage(err: Record<string, unknown>, fallback: string): string {
  if (typeof err.message === "string" && err.message) return err.message;
  const fieldErrors = err.message as Record<string, string[]> | undefined;
  if (fieldErrors && typeof fieldErrors === "object" && !Array.isArray(fieldErrors)) {
    const passwordErr = fieldErrors.password?.[0];
    if (passwordErr) return passwordErr;
    const first = Object.values(fieldErrors).flat()[0];
    if (first) return first;
  }
  const details = err.details as { fieldErrors?: Record<string, string[]> } | undefined;
  const detailFe = details?.fieldErrors;
  if (detailFe) {
    const first = Object.values(detailFe).flat()[0];
    if (first) return first;
  }
  if (typeof err.error === "string" && err.error) return err.error;
  return fallback;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function normalizeApiOrigin(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "http://localhost:3001";
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) return trimmed;
  const isLocal =
    /^localhost\b/i.test(trimmed) ||
    /^127\.\d+\.\d+\.\d+(?::\d+)?$/i.test(trimmed) ||
    /^\[::1\](?::\d+)?$/i.test(trimmed) ||
    /^::1(?::\d+)?$/i.test(trimmed);
  return `${isLocal ? "http" : "https"}://${trimmed}`;
}

function originAlreadyIncludesPrefix(origin: string, prefix: string): boolean {
  if (!prefix) return false;
  try {
    const pathname = trimSlashes(new URL(origin).pathname);
    return pathname === prefix || pathname.endsWith(`/${prefix}`);
  } catch {
    return trimSlashes(origin) === prefix || trimSlashes(origin).endsWith(`/${prefix}`);
  }
}

/**
 * Browser calls use the Next.js `/api` rewrite so auth cookies stay on the web origin.
 * Server-side fetches (SSR) talk to the API host directly.
 */
function resolveApiOrigin(): string {
  if (typeof window !== "undefined") return "/api";
  return normalizeApiOrigin(process.env.NEXT_PUBLIC_API_URL);
}

export function buildApiUrl(endpointPath: string): string {
  const origin = resolveApiOrigin();
  const configuredPrefix = trimSlashes(process.env.NEXT_PUBLIC_API_PATH_PREFIX ?? "");
  const prefix =
    origin.startsWith("/") || originAlreadyIncludesPrefix(origin, configuredPrefix)
      ? ""
      : configuredPrefix;
  const endpoint = trimSlashes(endpointPath);
  const path = [prefix, endpoint].filter(Boolean).join("/");
  return path ? `${origin}/${path}` : origin;
}

const API_BASE = buildApiUrl("");

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel?: string | null;
  companyId: string;
  /** Non-empty list = admin-assigned modules only; omitted/null = use role defaults */
  moduleAccess?: string[] | null;
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  /** @deprecated Refresh token is stored in an HttpOnly cookie; not returned to clients. */
  refreshToken?: string;
  expiresIn: number;
}

const AUTH_FETCH_INIT: RequestInit = { credentials: "include" };

/** Read CSRF cookie set by the API (non-HttpOnly) for cookie-authenticated requests. */
export function getCsrfTokenFromDocument(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)plethora_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function authJsonHeaders(extra?: Record<string, string>): Record<string, string> {
  const csrf = getCsrfTokenFromDocument();
  return {
    "Content-Type": "application/json",
    ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    ...extra,
  };
}

export interface SetupPasswordValidation {
  valid: boolean;
  email: string;
  name: string;
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
      ...AUTH_FETCH_INIT,
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
    ...AUTH_FETCH_INIT,
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

/**
 * Refresh the access token using the HttpOnly refresh cookie.
 * Pass `legacyRefreshToken` once when migrating from localStorage.
 */
export async function refreshSession(legacyRefreshToken?: string): Promise<LoginResponse> {
  const url = `${API_BASE}/auth/refresh`;
  const res = await fetch(url, {
    ...AUTH_FETCH_INIT,
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify(
      legacyRefreshToken ? { refreshToken: legacyRefreshToken } : {}
    ),
  });
  if (!res.ok) {
    await res.json().catch(() => ({}));
    throw new Error("Token refresh failed");
  }
  return res.json();
}

/** @deprecated Use refreshSession() — refresh token lives in an HttpOnly cookie. */
export async function refreshToken(legacyRefreshToken: string): Promise<LoginResponse> {
  return refreshSession(legacyRefreshToken);
}

export async function logoutSession(accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/logout`, {
    ...AUTH_FETCH_INIT,
    method: "POST",
    headers: authJsonHeaders({ Authorization: `Bearer ${accessToken}` }),
    body: JSON.stringify({}),
  });
  if (!res.ok && res.status !== 401) {
    throw new Error("Logout failed");
  }
}

export async function validateSetupPasswordToken(token: string): Promise<SetupPasswordValidation> {
  const res = await fetch(`${API_BASE}/auth/setup-password/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || err?.message || "Invalid or expired setup link");
  }
  return res.json();
}

export async function completeSetupPassword(token: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/setup-password/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(apiErrorMessage(err, "Failed to set password"));
  }
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
    payPeriodStartDay?: number;
    payPeriodEndDay?: number;
    autoRosterHorizonPeriods?: number;
    rosterPeriodCalendars?: RosterPeriodCalendarConfig[];
    defaultRosterPeriodCalendarId?: string;
  } | null;
}

export type RosterPeriodCalendarConfig = {
  id: string;
  name: string;
  startDay: number;
  endDay: number;
};

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
      payPeriodStartDay?: number;
      payPeriodEndDay?: number;
      autoRosterHorizonPeriods?: number;
      rosterPeriodCalendars?: RosterPeriodCalendarConfig[];
      defaultRosterPeriodCalendarId?: string;
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

export type PayPeriodOption = {
  periodKey: string;
  label: string;
  rosterLabel: string;
  periodStart: string;
  periodEnd: string;
  isCurrent?: boolean;
};

export async function fetchPayPeriods(
  token: string,
  opts?: { around?: string; before?: number; after?: number; periodKey?: string; calendarId?: string }
): Promise<PayPeriodOption[]> {
  const params = new URLSearchParams();
  if (opts?.around) params.set("around", opts.around);
  if (opts?.before != null) params.set("before", String(opts.before));
  if (opts?.after != null) params.set("after", String(opts.after));
  if (opts?.periodKey) params.set("periodKey", opts.periodKey);
  if (opts?.calendarId) params.set("calendarId", opts.calendarId);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/pay-periods${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch pay periods");
  const body = await res.json();
  return body.data ?? [];
}

export async function fetchCurrentPayPeriod(
  token: string,
  opts?: { calendarId?: string }
): Promise<PayPeriodOption> {
  const params = new URLSearchParams();
  if (opts?.calendarId) params.set("calendarId", opts.calendarId);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/pay-periods/current${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch current pay period");
  return res.json();
}

export async function fetchRosterPeriodCalendars(token: string): Promise<{
  defaultCalendarId: string;
  calendars: RosterPeriodCalendarConfig[];
}> {
  const res = await fetch(`${API_BASE}/pay-periods/roster-calendars`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch roster period calendars");
  return res.json();
}

export const FACTORY_RESET_MODULES = [
  { id: "employees", label: "Team", description: "Clear all team members, assignments, leave records, and deductions" },
  { id: "sites", label: "Sites", description: "Clear sites, posts, and site/post assignments" },
  { id: "shifts", label: "Shifts", description: "Clear shifts and attendance records" },
  { id: "attendance", label: "Attendance", description: "Clear attendance records only (shifts remain). Optionally for one person." },
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
    return fetch(`${API_BASE}${url}`, { credentials: "include", ...init, headers });
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
export type UserRole =
  | "admin"
  | "operations_manager"
  | "hr_payroll"
  | "supervisor"
  | "controller"
  | "client";

export interface UserListItem {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  roleLabel?: string | null;
  companyId: string;
  createdAt: string;
  moduleAccess?: unknown;
  setupLink?: string;
}

export async function listUsers(token: string): Promise<{ data: UserListItem[]; total: number }> {
  const res = await authFetch("/users", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to fetch users");
  }
  return res.json();
}

export interface TeamMemberCandidate {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  jobRole: string | null;
  status: string;
  hasUserAccount: boolean;
}

export async function searchTeamMemberCandidates(
  token: string,
  q: string
): Promise<TeamMemberCandidate[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];
  const res = await authFetch(
    `/users/team-member-candidates?q=${encodeURIComponent(trimmed)}`,
    token
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: TeamMemberCandidate[] };
  return body.data ?? [];
}

export async function createUser(
  token: string,
  data: {
    name: string;
    email: string;
    password?: string;
    sendSetupLink?: boolean;
    role: UserRole;
    roleLabel?: string | null;
    moduleAccess?: string[] | null;
  }
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
  data: Partial<{ name: string; email: string; password: string; role: UserRole; roleLabel: string | null; moduleAccess: string[] | null }>
): Promise<UserListItem> {
  const res = await authFetch(`/users/${id}`, token, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.message;
    throw new Error(typeof msg === "string" ? msg : "Failed to update user");
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
  groups: { validCount: number; valid: unknown[]; errors: { row: number; field: string; value: string; message: string }[] };
}

export interface MigrationImportResult {
  companiesCreated: number;
  employeesCreated: number;
  sitesCreated: number;
  groupsCreated: number;
  groupsSkipped: number;
  errors: { entity: string; row?: number; message: string }[];
}

export async function downloadMigrationTemplate(
  token: string,
  type: "company" | "employees" | "sites" | "groups"
): Promise<void> {
  const filename =
    type === "company"
      ? "company-import-template.csv"
      : type === "employees"
        ? "employees-import-template.csv"
        : type === "sites"
          ? "sites-import-template.csv"
          : "employee-groups-import-template.csv";
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

export async function exportEmployeeGroups(token: string): Promise<void> {
  const res = await authFetch("/migrations/export/groups", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Export failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "employee-groups-export.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export async function migrationPreview(
  token: string,
  files: { companies?: File; employees?: File; sites?: File; groups?: File }
): Promise<MigrationPreviewResponse> {
  const formData = new FormData();
  if (files.companies) formData.append("companies", files.companies);
  if (files.employees) formData.append("employees", files.employees);
  if (files.sites) formData.append("sites", files.sites);
  if (files.groups) formData.append("groups", files.groups);

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
  files: { employees?: File; sites?: File; groups?: File }
): Promise<MigrationImportResult> {
  const formData = new FormData();
  if (files.employees) formData.append("employees", files.employees);
  if (files.sites) formData.append("sites", files.sites);
  if (files.groups) formData.append("groups", files.groups);

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
  files: { companies: File; employees?: File; sites?: File; groups?: File }
): Promise<MigrationImportResult> {
  const formData = new FormData();
  formData.append("companies", files.companies);
  if (files.employees) formData.append("employees", files.employees);
  if (files.sites) formData.append("sites", files.sites);
  if (files.groups) formData.append("groups", files.groups);

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
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent" | "critical";

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
  completionPercentage?: number | null;
  siteId?: string | null;
  site?: { id: string; name: string } | null;
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
  params?: {
    projectId?: string;
    status?: TaskStatus;
    assigneeId?: string;
    filter?: "overdue" | "due_today" | "my" | "critical";
    limit?: number;
    offset?: number;
  }
): Promise<{ data: Task[]; total: number; limit: number; offset: number }> {
  const q = new URLSearchParams();
  if (params?.projectId) q.set("projectId", params.projectId);
  if (params?.status) q.set("status", params.status);
  if (params?.assigneeId) q.set("assigneeId", params.assigneeId);
  if (params?.filter) q.set("filter", params.filter);
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
    siteId: string | null;
    completionPercentage: number;
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

// --- Academy Management ---

function academyErrorMessage(err: Record<string, unknown>): string {
  if (typeof err.message === "string" && err.message) return err.message;
  if (typeof err.error === "string" && err.error) return err.error;
  const details = err.details as { fieldErrors?: Record<string, string[]> } | undefined;
  const fe = details?.fieldErrors;
  if (fe) {
    const first = Object.values(fe).flat()[0];
    if (first) return first;
  }
  return "Academy request failed";
}

async function academyRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(`/academy${path}`, token, init);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(academyErrorMessage(err));
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type");
  if (!ct?.includes("application/json")) return undefined as T;
  return res.json();
}

export async function uploadAcademyStudentDocument(
  token: string,
  studentId: string,
  file: File,
  documentType: string
): Promise<{ document: Record<string, unknown> }> {
  const fd = new FormData();
  fd.append("file", file);
  const q = new URLSearchParams({ documentType });
  const res = await authFetch(`/academy/students/${studentId}/documents?${q}`, token, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Upload failed");
  }
  return res.json();
}

export const academyApi = {
  listBranches: (token: string) => academyRequest<{ branches: unknown[] }>(token, "/branches"),
  createBranch: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ branch: unknown }>(token, "/branches", { method: "POST", body: JSON.stringify(body) }),
  deleteBranch: (token: string, id: string) =>
    academyRequest<void>(token, `/branches/${id}`, { method: "DELETE" }),

  listStudents: (token: string, q?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (q && q.trim().length >= 2) params.set("q", q.trim());
    if (limit != null && limit > 0) params.set("limit", String(Math.min(limit, 200)));
    const s = params.toString();
    return academyRequest<{ students: unknown[]; total: number }>(token, `/students${s ? `?${s}` : ""}`);
  },
  createStudent: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ student: unknown }>(token, "/students", { method: "POST", body: JSON.stringify(body) }),
  getStudent: (token: string, id: string) => academyRequest<{ student: unknown }>(token, `/students/${id}`),
  updateStudent: (token: string, id: string, body: Record<string, unknown>) =>
    academyRequest<{ student: unknown }>(token, `/students/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteStudent: (token: string, id: string) => academyRequest<void>(token, `/students/${id}`, { method: "DELETE" }),
  recordStudentAdminFee: (
    token: string,
    id: string,
    body: {
      status: "paid" | "waived" | "unpaid";
      amount?: number | string;
      method?: string | null;
      reference?: string | null;
      notes?: string | null;
    }
  ) =>
    academyRequest<{ student: unknown }>(token, `/students/${id}/admin-fee`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listStudentDocuments: (token: string, studentId: string) =>
    academyRequest<{ documents: unknown[] }>(token, `/students/${studentId}/documents`),
  deleteStudentDocument: (token: string, studentId: string, documentId: string) =>
    academyRequest<{ ok: boolean }>(token, `/students/${studentId}/documents/${documentId}`, {
      method: "DELETE",
    }),

  listCourses: (token: string, activeOnly?: boolean) =>
    academyRequest<{ courses: unknown[] }>(
      token,
      `/courses${activeOnly ? "?active=true" : ""}`
    ),
  createCourse: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ course: unknown }>(token, "/courses", { method: "POST", body: JSON.stringify(body) }),
  updateCourse: (token: string, id: string, body: Record<string, unknown>) =>
    academyRequest<{ course: unknown }>(token, `/courses/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteCourse: (token: string, id: string) => academyRequest<void>(token, `/courses/${id}`, { method: "DELETE" }),

  listCourseRuns: (token: string, courseId?: string, options?: { enrollable?: boolean }) => {
    const q = new URLSearchParams();
    if (courseId) q.set("courseId", courseId);
    if (options?.enrollable) q.set("enrollable", "true");
    const s = q.toString();
    return academyRequest<{ courseRuns: unknown[] }>(token, `/course-runs${s ? `?${s}` : ""}`);
  },
  createCourseRun: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ courseRun: unknown }>(token, "/course-runs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getCourseRun: (token: string, id: string) =>
    academyRequest<{ courseRun: unknown }>(token, `/course-runs/${id}`),
  updateCourseRun: (token: string, id: string, body: Record<string, unknown>) =>
    academyRequest<{ courseRun: unknown }>(token, `/course-runs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listFeePlans: (token: string) => academyRequest<{ feePlans: unknown[] }>(token, "/fee-plans"),
  createFeePlan: (token: string, body: { name: string; notes?: string | null }) =>
    academyRequest<{ feePlan: unknown }>(token, "/fee-plans", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listEnrolments: (token: string, params?: { courseRunId?: string; studentId?: string }) => {
    const q = new URLSearchParams();
    if (params?.courseRunId) q.set("courseRunId", params.courseRunId);
    if (params?.studentId) q.set("studentId", params.studentId);
    const s = q.toString();
    return academyRequest<{ enrolments: unknown[]; total: number }>(token, `/enrolments${s ? `?${s}` : ""}`);
  },
  createEnrolment: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ enrolment: unknown }>(token, "/enrolments", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createEnrolmentsBatch: (token: string, body: { studentId: string; courseRunIds: string[] }) =>
    academyRequest<{ enrolments: unknown[] }>(token, "/enrolments/batch", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteEnrolment: (token: string, id: string) =>
    academyRequest<void>(token, `/enrolments/${id}`, { method: "DELETE" }),
  updateEnrolment: (token: string, id: string, body: Record<string, unknown>) =>
    academyRequest<{ enrolment: unknown }>(token, `/enrolments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  getFinanceDashboard: (token: string) =>
    academyRequest<{ summary: Record<string, unknown>; recentPayments: unknown[] }>(token, "/finance/dashboard"),

  getHubSummary: (token: string) =>
    academyRequest<{
      totalStudents: number;
      activeCourseRunCount: number;
      enrolmentsInCurrentMonth: number;
      outstanding: string;
      overdueInvoiceCount: number;
      summary: {
        totalBilled: string;
        totalCollected: string;
        activeInvoiceCount: number;
      };
      deltas: {
        totalStudents: number | null;
        newEnrolments: number | null;
        activeCourseRuns: number | null;
        newStudents: number | null;
        outstanding: null;
      };
    }>(token, "/hub/summary"),

  getActivity: (token: string, options?: { limit?: number }) => {
    const q = new URLSearchParams();
    if (options?.limit != null && options.limit > 0) q.set("limit", String(options.limit));
    const s = q.toString();
    return academyRequest<{
      items: Array<{
        id: string;
        at: string;
        label: string;
        action: string;
        entityType: string;
        userName: string | null;
        link: string | null;
      }>;
    }>(token, `/activity${s ? `?${s}` : ""}`);
  },
  getProfile: (token: string) => academyRequest<{ profile: unknown | null; readiness: { compliant: boolean; blockers: string[] } }>(token, "/profile"),
  updateProfile: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ profile: unknown; readiness: { compliant: boolean; blockers: string[] } }>(token, "/profile", { method: "PATCH", body: JSON.stringify(body) }),
  listInstructors: (
    token: string,
    params?: {
      status?: string;
      search?: string;
      complianceStatus?: string;
      contractExpiry?: string;
      branchId?: string;
      courseId?: string;
      sort?: string;
      includeArchived?: boolean;
      limit?: number;
      offset?: number;
    }
  ) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.search) q.set("search", params.search);
    if (params?.complianceStatus) q.set("complianceStatus", params.complianceStatus);
    if (params?.contractExpiry) q.set("contractExpiry", params.contractExpiry);
    if (params?.branchId) q.set("branchId", params.branchId);
    if (params?.courseId) q.set("courseId", params.courseId);
    if (params?.sort) q.set("sort", params.sort);
    if (params?.includeArchived) q.set("includeArchived", "true");
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const s = q.toString();
    return academyRequest<{
      instructors: unknown[];
      total: number;
      limit: number;
      offset: number;
      summary: {
        totalInstructors: number;
        activeInstructors: number;
        expiringContracts: number;
        missingDocuments: number;
        suspendedInactive: number;
        psiraComplianceScore: number;
        highRisk: number;
        attentionNeeded: number;
      };
    }>(token, `/instructors${s ? `?${s}` : ""}`);
  },
  getInstructor: (token: string, id: string) =>
    academyRequest<{ instructor: unknown }>(token, `/instructors/${id}`),
  createInstructor: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ instructor: unknown }>(token, "/instructors", { method: "POST", body: JSON.stringify(body) }),
  updateInstructor: (token: string, id: string, body: Record<string, unknown>) =>
    academyRequest<{ instructor: unknown }>(token, `/instructors/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  archiveInstructor: (token: string, id: string) =>
    academyRequest<{ ok: boolean }>(token, `/instructors/${id}/archive`, { method: "POST" }),
  restoreInstructor: (token: string, id: string) =>
    academyRequest<{ ok: boolean }>(token, `/instructors/${id}/restore`, { method: "POST" }),
  bulkInstructorAction: (
    token: string,
    body: {
      ids: string[];
      action: "archive" | "delete" | "assign_branch" | "assign_courses" | "status" | "mark_documents_requested";
      assignedBranchId?: string | null;
      assignedCourseIds?: string[] | null;
      status?: "active" | "inactive" | "suspended" | "contract_ended";
    }
  ) =>
    academyRequest<{ ok: boolean; count: number }>(token, "/instructors/bulk", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteInstructor: (token: string, id: string, options?: { permanent?: boolean }) => {
    const q = new URLSearchParams();
    if (options?.permanent) q.set("permanent", "true");
    const s = q.toString();
    return academyRequest<{ ok: boolean } | void>(token, `/instructors/${id}${s ? `?${s}` : ""}`, {
      method: "DELETE",
    });
  },
  listInstructorDocuments: (token: string, instructorId: string) =>
    academyRequest<{ documents: unknown[] }>(token, `/instructors/${instructorId}/documents`),
  uploadInstructorDocument: (
    token: string,
    instructorId: string,
    file: File,
    metadata: {
      documentType: string;
      issueDate?: string | null;
      expiryDate?: string | null;
      verificationStatus?: "verified" | "pending_review" | "missing" | "expired";
      notes?: string | null;
    }
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    const q = new URLSearchParams();
    q.set("documentType", metadata.documentType);
    if (metadata.issueDate) q.set("issueDate", metadata.issueDate);
    if (metadata.expiryDate) q.set("expiryDate", metadata.expiryDate);
    if (metadata.verificationStatus) q.set("verificationStatus", metadata.verificationStatus);
    if (metadata.notes) q.set("notes", metadata.notes);
    return authFetch(`/academy/instructors/${instructorId}/documents?${q.toString()}`, token, {
      method: "POST",
      body: fd,
    }).then(async (res) => {
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(academyErrorMessage(err));
      }
      return res.json() as Promise<{ document: unknown }>;
    });
  },
  updateInstructorDocument: (
    token: string,
    instructorId: string,
    documentId: string,
    body: {
      documentType?: string | null;
      issueDate?: string | null;
      expiryDate?: string | null;
      verificationStatus?: "verified" | "pending_review" | "missing" | "expired";
      notes?: string | null;
    }
  ) =>
    academyRequest<{ document: unknown }>(
      token,
      `/instructors/${instructorId}/documents/${documentId}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  deleteInstructorDocument: (token: string, instructorId: string, documentId: string) =>
    academyRequest<{ ok: boolean }>(token, `/instructors/${instructorId}/documents/${documentId}`, {
      method: "DELETE",
    }),
  listClassrooms: (token: string, params?: { academyBranchId?: string; status?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.academyBranchId) q.set("academyBranchId", params.academyBranchId);
    if (params?.status) q.set("status", params.status);
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const s = q.toString();
    return academyRequest<{ classrooms: unknown[]; total: number; limit: number; offset: number }>(token, `/classrooms${s ? `?${s}` : ""}`);
  },
  createClassroom: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ classroom: unknown }>(token, "/classrooms", { method: "POST", body: JSON.stringify(body) }),
  updateClassroom: (token: string, id: string, body: Record<string, unknown>) =>
    academyRequest<{ classroom: unknown }>(token, `/classrooms/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteClassroom: (token: string, id: string) => academyRequest<void>(token, `/classrooms/${id}`, { method: "DELETE" }),
  listAttendanceSessions: (token: string, params?: { courseRunId?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.courseRunId) q.set("courseRunId", params.courseRunId);
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const s = q.toString();
    return academyRequest<{ sessions: unknown[]; total: number; limit: number; offset: number }>(token, `/attendance/sessions${s ? `?${s}` : ""}`);
  },
  createAttendanceSession: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ session: unknown }>(token, "/attendance/sessions", { method: "POST", body: JSON.stringify(body) }),
  updateAttendanceSession: (token: string, id: string, body: Record<string, unknown>) =>
    academyRequest<{ session: unknown }>(token, `/attendance/sessions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAttendanceSession: (token: string, id: string) => academyRequest<void>(token, `/attendance/sessions/${id}`, { method: "DELETE" }),
  markAttendance: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ record: unknown }>(token, "/attendance/mark", { method: "POST", body: JSON.stringify(body) }),
  markAttendanceBulk: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ records: unknown[] }>(token, "/attendance/mark-bulk", { method: "POST", body: JSON.stringify(body) }),
  listAssessments: (token: string, params?: { learnerId?: string; courseId?: string; result?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.learnerId) q.set("learnerId", params.learnerId);
    if (params?.courseId) q.set("courseId", params.courseId);
    if (params?.result) q.set("result", params.result);
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const s = q.toString();
    return academyRequest<{ assessments: unknown[]; total: number; limit: number; offset: number }>(token, `/assessments${s ? `?${s}` : ""}`);
  },
  createAssessment: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ assessment: unknown }>(token, "/assessments", { method: "POST", body: JSON.stringify(body) }),
  updateAssessment: (token: string, id: string, body: Record<string, unknown>) =>
    academyRequest<{ assessment: unknown }>(token, `/assessments/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAssessment: (token: string, id: string) => academyRequest<void>(token, `/assessments/${id}`, { method: "DELETE" }),
  listCertificates: (token: string, params?: { learnerId?: string; courseId?: string; status?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.learnerId) q.set("learnerId", params.learnerId);
    if (params?.courseId) q.set("courseId", params.courseId);
    if (params?.status) q.set("status", params.status);
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const s = q.toString();
    return academyRequest<{ certificates: unknown[]; total: number; limit: number; offset: number }>(token, `/certificates${s ? `?${s}` : ""}`);
  },
  createCertificate: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ certificate: unknown }>(token, "/certificates", { method: "POST", body: JSON.stringify(body) }),
  updateCertificate: (token: string, id: string, body: Record<string, unknown>) =>
    academyRequest<{ certificate: unknown }>(token, `/certificates/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCertificate: (token: string, id: string) => academyRequest<void>(token, `/certificates/${id}`, { method: "DELETE" }),
  reprintCertificate: (token: string, id: string) =>
    academyRequest<{ certificate: unknown }>(token, `/certificates/${id}/reprint`, { method: "POST" }),
  revokeCertificate: (token: string, id: string) =>
    academyRequest<{ certificate: unknown }>(token, `/certificates/${id}/revoke`, { method: "POST" }),
  verifyCertificate: (token: string, code: string) =>
    academyRequest<{ valid: boolean; certificate: unknown }>(token, `/certificates/verify/${code}`),
  listComplianceDocuments: (token: string, params?: { status?: string; documentType?: string; search?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.documentType) q.set("documentType", params.documentType);
    if (params?.search) q.set("search", params.search);
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const s = q.toString();
    return academyRequest<{ documents: unknown[]; total: number; limit: number; offset: number }>(token, `/compliance-documents${s ? `?${s}` : ""}`);
  },
  createComplianceDocument: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ document: unknown }>(token, "/compliance-documents", { method: "POST", body: JSON.stringify(body) }),
  updateComplianceDocument: (token: string, id: string, body: Record<string, unknown>) =>
    academyRequest<{ document: unknown }>(token, `/compliance-documents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteComplianceDocument: (token: string, id: string) => academyRequest<void>(token, `/compliance-documents/${id}`, { method: "DELETE" }),
  listPolicies: (token: string, params?: { policyType?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.policyType) q.set("policyType", params.policyType);
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const s = q.toString();
    return academyRequest<{ policies: unknown[]; total: number; limit: number; offset: number }>(token, `/policies${s ? `?${s}` : ""}`);
  },
  createPolicy: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ policy: unknown }>(token, "/policies", { method: "POST", body: JSON.stringify(body) }),
  updatePolicy: (token: string, id: string, body: Record<string, unknown>) =>
    academyRequest<{ policy: unknown }>(token, `/policies/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deletePolicy: (token: string, id: string) => academyRequest<void>(token, `/policies/${id}`, { method: "DELETE" }),
  listRenewals: (token: string, params?: { severity?: string; status?: string; alertType?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.severity) q.set("severity", params.severity);
    if (params?.status) q.set("status", params.status);
    if (params?.alertType) q.set("alertType", params.alertType);
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const s = q.toString();
    return academyRequest<{ alerts: unknown[]; total: number; limit: number; offset: number }>(token, `/renewals${s ? `?${s}` : ""}`);
  },
  createRenewal: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ alert: unknown }>(token, "/renewals", { method: "POST", body: JSON.stringify(body) }),
  updateRenewal: (token: string, id: string, body: Record<string, unknown>) =>
    academyRequest<{ alert: unknown }>(token, `/renewals/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRenewal: (token: string, id: string) => academyRequest<void>(token, `/renewals/${id}`, { method: "DELETE" }),
  getReportsDashboard: (token: string, params?: { from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const s = q.toString();
    return academyRequest<Record<string, unknown>>(token, `/reports/dashboard${s ? `?${s}` : ""}`);
  },
  listAuditLogs: (token: string, params?: { entityType?: string; entityId?: string; action?: string; userId?: string; from?: string; to?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.entityType) q.set("entityType", params.entityType);
    if (params?.entityId) q.set("entityId", params.entityId);
    if (params?.action) q.set("action", params.action);
    if (params?.userId) q.set("userId", params.userId);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const s = q.toString();
    return academyRequest<{ logs: unknown[]; total: number; limit: number; offset: number }>(token, `/audit${s ? `?${s}` : ""}`);
  },

  listInvoices: (
    token: string,
    params?: { studentId?: string; enrolmentId?: string; status?: string; limit?: number; offset?: number }
  ) => {
    const q = new URLSearchParams();
    if (params?.studentId) q.set("studentId", params.studentId);
    if (params?.enrolmentId) q.set("enrolmentId", params.enrolmentId);
    if (params?.status) q.set("status", params.status);
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const s = q.toString();
    return academyRequest<{ invoices: unknown[]; total: number; limit: number; offset: number }>(
      token,
      `/invoices${s ? `?${s}` : ""}`
    );
  },
  getInvoice: (token: string, id: string) => academyRequest<{ invoice: unknown }>(token, `/invoices/${id}`),
  createInvoice: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ invoice: unknown }>(token, "/invoices", { method: "POST", body: JSON.stringify(body) }),
  updateInvoice: (token: string, id: string, body: Record<string, unknown>) =>
    academyRequest<{ invoice: unknown }>(token, `/invoices/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  issueInvoice: (token: string, id: string) =>
    academyRequest<{ invoice: unknown }>(token, `/invoices/${id}/issue`, { method: "POST" }),
  cancelInvoice: (token: string, id: string) =>
    academyRequest<{ invoice: unknown }>(token, `/invoices/${id}/cancel`, { method: "POST" }),

  listPayments: (token: string, params?: { invoiceId?: string; studentId?: string; verificationStatus?: string }) => {
    const q = new URLSearchParams();
    if (params?.invoiceId) q.set("invoiceId", params.invoiceId);
    if (params?.studentId) q.set("studentId", params.studentId);
    if (params?.verificationStatus) q.set("verificationStatus", params.verificationStatus);
    const s = q.toString();
    return academyRequest<{ payments: unknown[] }>(token, `/payments${s ? `?${s}` : ""}`);
  },
  createPayment: (token: string, body: Record<string, unknown>) =>
    academyRequest<{ payment: unknown }>(token, "/payments", { method: "POST", body: JSON.stringify(body) }),
  verifyPayment: (token: string, id: string) =>
    academyRequest<{ payment: unknown }>(token, `/payments/${id}/verify`, { method: "POST" }),
  rejectPayment: (token: string, id: string, remarks?: string | null) =>
    academyRequest<{ payment: unknown }>(token, `/payments/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ remarks: remarks ?? null }),
    }),
  getReceipt: (token: string, id: string) => academyRequest<{ receipt: unknown }>(token, `/receipts/${id}`),
};
