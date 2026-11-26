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
  accountType: AccountType;
  jobTitle: string | null;
  isActive: boolean;
  isOwner: boolean;
  companyId: string;
  capabilities: CapabilityMap;
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
    adminGeofenceEnabled?: boolean;
    adminOfficeName?: string | null;
    adminOfficeLatitude?: number | null;
    adminOfficeLongitude?: number | null;
    adminGeofenceRadiusMeters?: number | null;
    obBookMode?: "REQUIRED" | "OPTIONAL_WHEN_DIGITAL" | "OPTIONAL";
    psiraEnforcementMode?: "BLOCK" | "WARN" | "OFF";
    averagingEnabled?: boolean;
    averagingWeeks?: number;
    overnightBoundaryMode?: "shift_start_day" | "midnight_split";
    sundayDoubleRateSplit?: boolean;
    fortnightlyRestEnabled?: boolean;
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
      adminGeofenceEnabled?: boolean;
      adminOfficeName?: string | null;
      adminOfficeLatitude?: number | null;
      adminOfficeLongitude?: number | null;
      adminGeofenceRadiusMeters?: number | null;
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
  { id: "employees", label: "Team", description: "Clear all team members, assignments, and leave records" },
  { id: "sites", label: "Sites", description: "Clear sites, posts, and site/post assignments" },
  { id: "shifts", label: "Shifts", description: "Clear shifts and attendance records" },
  { id: "attendance", label: "Attendance", description: "Clear attendance records only (shifts remain). Optionally for one person." },
  { id: "publicHolidays", label: "Public Holidays", description: "Reset to SA public holidays (2025–2026)" },
  { id: "auditLogs", label: "Audit Logs", description: "Clear activity and audit history" },
  { id: "companySettings", label: "Company Settings", description: "Reset company name, business details, and settings to defaults" },
] as const;

export type FactoryResetModuleId = (typeof FACTORY_RESET_MODULES)[number]["id"];
export type FactoryResetResponse = CompanySettings | { companyDeleted: true };

export async function factoryReset(
  token: string,
  modules?: FactoryResetModuleId[],
  options?: {
    attendanceEmployeeId?: string;
    attendanceFromDate?: string;
    currentPassword: string;
    confirmation: "FACTORY RESET";
  }
): Promise<FactoryResetResponse> {
  const body: Record<string, unknown> = {
    ...(modules && modules.length > 0 ? { modules } : {}),
    currentPassword: options?.currentPassword,
    confirmation: options?.confirmation,
  };
  if (options?.attendanceEmployeeId) body.attendanceEmployeeId = options.attendanceEmployeeId;
  if (options?.attendanceFromDate) body.attendanceFromDate = options.attendanceFromDate;
  const res = await fetch(`${API_BASE}/settings/factory-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
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
    const userHeaders = (init?.headers as Record<string, string> | undefined) ?? {};
    const hasContentType = Object.keys(userHeaders).some((k) => k.toLowerCase() === "content-type");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${t}`,
      ...(hasBody && !isFormData && !hasContentType ? { "Content-Type": "application/json" } : {}),
      ...userHeaders,
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

function responseDownloadName(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall back to the ASCII filename.
    }
  }
  const ascii = disposition.match(/filename="([^"]+)"/i)?.[1];
  return ascii || fallback;
}

export async function downloadPrivateFile(
  token: string,
  downloadUrl: string,
  fallbackFileName: string
): Promise<void> {
  const response = await authFetch(
    downloadUrl.startsWith("/") ? downloadUrl : `/${downloadUrl}`,
    token
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      (error as { message?: string }).message ||
        (error as { error?: string }).error ||
        "File download failed"
    );
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = responseDownloadName(response, fallbackFileName);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Capability-based user access management
export type AccountType = "staff" | "client";
export type Capability =
  | "view"
  | "view_sensitive"
  | "create"
  | "edit"
  | "delete"
  | "approve"
  | "export"
  | "manage_access";
export type CapabilityMap = Record<string, Capability[]>;

export interface UserListItem {
  id: string;
  name: string;
  email: string;
  accountType: AccountType;
  jobTitle: string | null;
  isActive: boolean;
  isOwner: boolean;
  companyId: string;
  createdAt: string;
  capabilities: CapabilityMap;
  setupLink?: string;
}

export interface CapabilityDefinition {
  path: string;
  label: string;
  capabilities: Capability[];
  parent?: string;
}

export interface EffectiveModuleAccess {
  path: string;
  label: string;
  parent?: string;
  granted: Capability[];
  available: Capability[];
  source: "owner" | "explicit" | "none";
}

export interface AccessHistoryEntry {
  id: string;
  action: string;
  timestamp: string;
  actorLabel: string | null;
  metadata: Record<string, unknown> | null;
  user: { id: string; name: string; email: string } | null;
}

export interface EffectiveAccessResponse {
  user: {
    id: string;
    name: string;
    email: string;
    jobTitle: string | null;
    accountType: AccountType;
    isActive: boolean;
    isOwner: boolean;
  };
  modules: EffectiveModuleAccess[];
  history: AccessHistoryEntry[];
}

/**
 * What this person can actually do, computed server-side by the same function
 * the API guards use — so this panel can never overstate someone's access.
 */
export async function getEffectiveAccess(
  token: string,
  userId: string
): Promise<EffectiveAccessResponse> {
  const res = await authFetch(`/users/${userId}/effective-access`, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(err, "Failed to load effective access"));
  }
  return res.json();
}

export function accessReviewCsvUrl(): string {
  return "/users/access-review?format=csv";
}

export async function listUsers(token: string): Promise<{ data: UserListItem[]; total: number }> {
  const res = await authFetch("/users", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to fetch users");
  }
  return res.json();
}

export async function getCapabilityCatalog(token: string): Promise<CapabilityDefinition[]> {
  const res = await authFetch("/users/capability-catalog", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(err, "Failed to fetch capability catalog"));
  }
  const body = (await res.json()) as { data: CapabilityDefinition[] };
  return body.data;
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


export type AccessChangeKind = "CREATE_USER" | "UPDATE_ACCESS" | "DEACTIVATE_USER";
export type AccessChangeStatus = "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED";

export interface CapabilityGrantChange {
  path: string;
  label: string;
  capability: Capability;
}

/** A user-access change proposed by an access manager, awaiting the owner. */
export interface AccessChangeRequest {
  id: string;
  kind: AccessChangeKind;
  status: AccessChangeStatus;
  targetUserId: string | null;
  targetLabel: string;
  requestNote: string | null;
  reviewNote: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  requestedBy: { id: string; name: string; email: string };
  reviewedBy: { id: string; name: string; email: string } | null;
  targetUser: { id: string; name: string; email: string; isActive: boolean } | null;
  diff: { added: CapabilityGrantChange[]; removed: CapabilityGrantChange[] };
  profileChanges: { field: string; from: unknown; to: unknown }[];
}

export interface AccessChangeRequestList {
  data: AccessChangeRequest[];
  pendingCount: number;
  /** True only for the company owner — the only person who may approve. */
  canReview: boolean;
}

/**
 * An access mutation either applied (the owner) or queued for approval (anyone
 * else with manage_access). Callers must handle both.
 */
export type AccessMutationResult<T> =
  | { pending: false; user: T }
  | { pending: true; request: AccessChangeRequest };

export async function listAccessRequests(
  token: string,
  status?: AccessChangeStatus
): Promise<AccessChangeRequestList> {
  const query = status ? `?status=${status}` : "";
  const res = await authFetch(`/access-requests${query}`, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(err, "Failed to load access change requests"));
  }
  return res.json();
}

async function reviewAccessRequest(
  token: string,
  id: string,
  action: "approve" | "decline" | "cancel",
  body: { reviewNote?: string; acknowledgeDrift?: boolean } = {}
): Promise<{ request: AccessChangeRequest; setupLink?: string }> {
  const res = await authFetch(`/access-requests/${id}/${action}`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(
      apiErrorMessage(payload, `Failed to ${action} the access change`)
    ) as Error & { code?: string };
    // "stale" is recoverable: the caller re-sends with acknowledgeDrift.
    error.code = (payload as { code?: string }).code;
    throw error;
  }
  return payload;
}

export function approveAccessRequest(
  token: string,
  id: string,
  options: { reviewNote?: string; acknowledgeDrift?: boolean } = {}
) {
  return reviewAccessRequest(token, id, "approve", options);
}

export function declineAccessRequest(token: string, id: string, reviewNote?: string) {
  return reviewAccessRequest(token, id, "decline", { reviewNote });
}

export function cancelAccessRequest(token: string, id: string) {
  return reviewAccessRequest(token, id, "cancel");
}

export async function createUser(
  token: string,
  data: {
    name: string;
    email: string;
    password?: string;
    sendSetupLink?: boolean;
    accountType: AccountType;
    jobTitle?: string | null;
    isActive?: boolean;
    capabilities: CapabilityMap;
    requestNote?: string;
  }
): Promise<AccessMutationResult<UserListItem>> {
  const res = await authFetch("/users", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.message?.email?.[0] ?? err?.message ?? "Failed to create user";
    throw new Error(typeof msg === "string" ? msg : "Failed to create user");
  }
  const body = await res.json();
  // 202 means the change needs the company owner's approval before it applies.
  if (res.status === 202) return { pending: true, request: body.request };
  return { pending: false, user: body };
}

export async function updateUser(
  token: string,
  id: string,
  data: Partial<{
    name: string;
    email: string;
    password: string;
    accountType: AccountType;
    jobTitle: string | null;
    isActive: boolean;
    capabilities: CapabilityMap;
    requestNote: string;
  }>
): Promise<AccessMutationResult<UserListItem>> {
  const res = await authFetch(`/users/${id}`, token, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(err, "Failed to update user"));
  }
  const body = await res.json();
  if (res.status === 202) return { pending: true, request: body.request };
  return { pending: false, user: body };
}

export async function deleteUser(
  token: string,
  id: string
): Promise<{ pending: boolean; request?: AccessChangeRequest }> {
  const res = await authFetch(`/users/${id}`, token, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to deactivate user");
  }
  if (res.status === 202) {
    const body = await res.json();
    return { pending: true, request: body.request };
  }
  return { pending: false };
}

export interface PasswordResetLink {
  email: string;
  setupLink: string;
  expiresAt: string;
}

/**
 * Issues a single-use link the person uses to set their own password. Their
 * current password keeps working until they use it, so this never locks anyone out.
 */
export async function issuePasswordResetLink(
  token: string,
  id: string
): Promise<PasswordResetLink> {
  const res = await authFetch(`/users/${id}/password-reset-link`, token, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(err, "Failed to create a password reset link"));
  }
  return res.json();
}

export async function transferCompanyOwnership(
  token: string,
  newOwnerUserId: string,
  currentPassword: string
): Promise<void> {
  const res = await authFetch("/users/transfer-ownership", token, {
    method: "POST",
    body: JSON.stringify({ newOwnerUserId, currentPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(err, "Failed to transfer ownership"));
  }
}

// Current tenant company
export interface CompanyListItem {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export async function listCompanies(token: string): Promise<{ data: CompanyListItem[]; total: number; limit: number; offset: number }> {
  const res = await authFetch("/companies", token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to fetch companies");
  }
  return res.json();
}

// Global search
export interface SearchEmployee {
  id: string;
  employeeNumber: string;
  externalPayrollCode?: string | null;
  firstName: string;
  lastName: string;
  status: string;
}

export interface SearchSite {
  id: string;
  name: string;
  location: string | null;
  costCenterCode?: string | null;
}

export interface SearchClient {
  id: string;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
}

export interface SearchIncident {
  id: string;
  incidentNumber: string;
  title?: string | null;
  incidentType: string;
  severity: string;
  status: string;
}

export interface SearchInvoice {
  id: string;
  invoiceNumber: string;
  totalAmount: number;
  status: string;
  dueDate?: string | null;
  client?: { id: string; name: string } | null;
}

export interface SearchResults {
  employees: SearchEmployee[];
  sites: SearchSite[];
  clients?: SearchClient[];
  incidents?: SearchIncident[];
  invoices?: SearchInvoice[];
}

export async function search(token: string, q: string): Promise<SearchResults> {
  const trimmed = q.trim();
  if (trimmed.length < 2) {
    return { employees: [], sites: [], clients: [], incidents: [], invoices: [] };
  }
  const res = await authFetch(`/search?q=${encodeURIComponent(trimmed)}`, token);
  if (!res.ok) {
    return { employees: [], sites: [], clients: [], incidents: [], invoices: [] };
  }
  return res.json();
}

// WhatsApp
export interface WhatsAppContact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  whatsappUrl: string | null;
  jobRole?: string | null;
  employeeType?: string | null;
  lastMessageText?: string | null;
  lastMessageDirection?: "inbound" | "outbound" | null;
  lastMessageAt?: string | null;
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

export interface WhatsAppAiSuggestResponse {
  summary: string;
  suggestions: string[];
  operationalSnapshot: {
    activeDuty: {
      clockedIn: boolean;
      siteName?: string;
      clockedInAt?: string;
    };
    nextShift: {
      date: string;
      startTime: string;
      endTime: string;
      site: string;
      post: string | null;
    } | null;
    recentLeaveRequests: Array<{
      id: string;
      leaveType: string;
      startDate: string;
      endDate: string;
      status: string;
    }>;
    compliance: {
      psiraGrade: string | null;
      psiraNumber: string | null;
      psiraExpiry: string | null;
      armedGuard: boolean;
      firearmCompetency: boolean;
      firearmExpiry: string | null;
    };
  };
  aiUsed: boolean;
}

export async function getWhatsAppContacts(
  token: string,
  params?: { limit?: number; offset?: number; search?: string }
): Promise<{ data: WhatsAppContact[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));
  if (params?.search?.trim()) q.set("search", params.search.trim());
  const res = await authFetch(`/whatsapp/contacts?${q.toString()}`, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Failed to fetch contacts");
  }
  const json = await res.json();
  return { data: json.data ?? [], total: json.total ?? 0 };
}

export async function suggestWhatsAppReplies(
  token: string,
  employeeId: string
): Promise<WhatsAppAiSuggestResponse> {
  const res = await authFetch("/whatsapp/ai-assist", token, {
    method: "POST",
    body: JSON.stringify({ mode: "suggest", employeeId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string; error?: string }).message ?? "Failed to generate AI suggestions");
  }
  return res.json();
}

export async function polishWhatsAppDraft(
  token: string,
  employeeId: string,
  draft: string
): Promise<{ original: string; polished: string; aiUsed: boolean }> {
  const res = await authFetch("/whatsapp/ai-assist", token, {
    method: "POST",
    body: JSON.stringify({ mode: "polish", employeeId, draft }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string; error?: string }).message ?? "Failed to polish draft");
  }
  return res.json();
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

export interface WhatsAppTemplateComponent {
  type: string;
  text?: string;
  format?: string;
  example?: { body_text?: string[][] };
  parameters?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: WhatsAppTemplateComponent[];
}

export async function sendWhatsAppTemplate(
  token: string,
  employeeId: string,
  templateName: string,
  options?: { languageCode?: string; components?: unknown[] }
): Promise<{ success: boolean; error?: string }> {
  const defaultLang = templateName === "hello_world" ? "en_US" : "en";
  const res = await authFetch("/whatsapp/send-template", token, {
    method: "POST",
    body: JSON.stringify({
      employeeId,
      templateName,
      languageCode: options?.languageCode ?? defaultLang,
      components: options?.components,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!res.ok) {
    return { success: false, error: data.error ?? "Failed to send template" };
  }
  return { success: data.success ?? true, error: data.error };
}

export async function getWhatsAppTemplates(token: string): Promise<{ data: WhatsAppTemplate[] }> {
  const res = await authFetch("/whatsapp/templates", token);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(err.error || err.message || "Failed to fetch templates");
  }
  const json = await res.json();
  return { data: json.data ?? [] };
}

// Migration / bulk import
export interface MigrationPreviewResponse {
  employees: { validCount: number; valid: unknown[]; errors: { row: number; field: string; value: string; message: string }[] };
  sites: { validCount: number; valid: unknown[]; errors: { row: number; field: string; value: string; message: string }[] };
  groups: { validCount: number; valid: unknown[]; errors: { row: number; field: string; value: string; message: string }[] };
}

export interface MigrationImportResult {
  employeesCreated: number;
  sitesCreated: number;
  groupsCreated: number;
  groupsSkipped: number;
  errors: { entity: string; row?: number; message: string }[];
}

export async function downloadMigrationTemplate(
  token: string,
  type: "employees" | "sites" | "groups"
): Promise<void> {
  const filename =
    type === "employees"
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
  files: { employees?: File; sites?: File; groups?: File }
): Promise<MigrationPreviewResponse> {
  const formData = new FormData();
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

// Public Holidays
export interface PublicHolidayItem {
  id: string;
  date: string;
  name: string;
  createdAt?: string;
}

export async function listPublicHolidays(
  token: string,
  year?: number
): Promise<{ data: PublicHolidayItem[]; year?: number }> {
  const q = year ? `?year=${year}` : "";
  const res = await authFetch(`/settings/public-holidays${q}`, token);
  if (!res.ok) throw new Error("Failed to load public holidays");
  return res.json();
}

export async function createPublicHoliday(
  token: string,
  data: { date: string; name: string }
): Promise<PublicHolidayItem> {
  const res = await authFetch("/settings/public-holidays", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string; error?: string }).message ||
        (err as { error?: string }).error ||
        "Failed to add public holiday"
    );
  }
  return res.json();
}

export async function deletePublicHoliday(token: string, id: string): Promise<void> {
  const res = await authFetch(`/settings/public-holidays/${id}`, token, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete public holiday");
}
