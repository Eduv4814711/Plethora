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
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, companyId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = err?.message || err?.error || (res.status === 401 ? "Invalid email or password" : "Login failed");
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
  settings?: {
    currency?: string;
    dateFormat?: string;
    timezone?: string;
    payrollPeriod?: "weekly" | "biweekly" | "monthly";
  } | null;
  theme?: {
    primaryColor?: string;
    accentColor?: string;
    mode?: "light" | "dark" | "system";
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
    }>;
    businessSettings: Partial<{
      currency: string;
      dateFormat: string;
      timezone: string;
      payrollPeriod: "weekly" | "biweekly" | "monthly";
    }>;
    theme: Partial<{
      primaryColor: string;
      accentColor: string;
      mode: "light" | "dark" | "system";
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
  return fetch(`${API_BASE}${url}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}
