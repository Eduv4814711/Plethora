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
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api.ts:login:beforeFetch',message:'Login attempt',data:{url,emailLen:email?.length,hasPassword:!!password},hypothesisId:'H1,H4,H5',timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, companyId }),
    });
  } catch (fetchErr) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api.ts:login:fetchCatch',message:'Fetch failed',data:{errMsg:fetchErr instanceof Error?fetchErr.message:String(fetchErr)},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const msg = fetchErr instanceof Error ? fetchErr.message : "Network error";
    throw new Error(
      msg.includes("fetch") || msg.includes("Failed") || msg.includes("Network")
        ? "Cannot connect to server. Ensure the API is running (npm run dev:api)."
        : msg
    );
  }
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api.ts:login:afterFetch',message:'Response received',data:{status:res.status,ok:res.ok},hypothesisId:'H2,H3,H4,H5',timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api.ts:login:resNotOk',message:'Error response body',data:{status:res.status,errKeys:Object.keys(err),message:err?.message},hypothesisId:'H2,H3',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const message =
      err?.message ||
      err?.error ||
      (res.status === 401 ? "Invalid email or password" : "Login failed");
    throw new Error(message);
  }
  try {
    const data = await res.json();
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api.ts:login:parseSuccess',message:'Login success',data:{hasUser:!!data?.user},hypothesisId:'H5',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return data;
  } catch (parseErr) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api.ts:login:parseCatch',message:'JSON parse failed',data:{errMsg:parseErr instanceof Error?parseErr.message:String(parseErr)},hypothesisId:'H4,H5',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    throw new Error("Invalid response from server");
  }
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
  { id: "employees", label: "Employees", description: "Clear all employees, assignments, leave records, and deductions" },
  { id: "sites", label: "Sites", description: "Clear sites, posts, and site/post assignments" },
  { id: "shifts", label: "Shifts", description: "Clear shifts and attendance records" },
  { id: "payroll", label: "Payroll", description: "Clear payroll runs, items, and payslips" },
  { id: "timesheets", label: "Timesheets", description: "Clear all timesheet records" },
  { id: "payRules", label: "Pay Rules", description: "Reset to defaults: overtime, sunday, public holiday rates; UIF, PSIRA" },
  { id: "publicHolidays", label: "Public Holidays", description: "Reset to SA public holidays (2025–2026)" },
  { id: "auditLogs", label: "Audit Logs", description: "Clear activity and audit history" },
  { id: "companySettings", label: "Company Settings", description: "Reset company name, business details, and settings to defaults" },
] as const;

export type FactoryResetModuleId = (typeof FACTORY_RESET_MODULES)[number]["id"];

export async function factoryReset(
  token: string,
  modules?: FactoryResetModuleId[]
): Promise<CompanySettings> {
  const res = await fetch(`${API_BASE}/settings/factory-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(modules && modules.length > 0 ? { modules } : {}),
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

export function authFetch(url: string, token: string, init?: RequestInit) {
  const hasBody = init?.body !== undefined && init?.body !== null && init?.body !== "";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  return fetch(`${API_BASE}${url}`, {
    ...init,
    headers,
  });
}

// User management (admin only)
export type UserRole = "admin" | "operations_manager" | "hr_payroll" | "supervisor";

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
  const res = await fetch(`${API_BASE}/migrations/templates/${type}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to download template");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
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
