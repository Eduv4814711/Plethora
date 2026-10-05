import { buildApiUrl } from "./api";

const API_BASE = buildApiUrl("");

export type ControllerAttendanceStatus =
  | "scheduled"
  | "clocked_in"
  | "clocked_out"
  | "late"
  | "early_departure"
  | "missing_clock_in"
  | "missing_clock_out"
  | "absent"
  | "manually_adjusted"
  | "requires_review";

export type CaptureMethod = "whatsapp" | "manual" | "rest" | "none";

export interface GuardAttendanceItem {
  shiftId: string;
  attendanceId: string | null;
  employeeId: string;
  guardName: string;
  guardPhone: string | null;
  shiftType: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  clockInTime: string | null;
  clockOutTime: string | null;
  hoursWorked: number | null;
  overtimeHours: number | null;
  status: ControllerAttendanceStatus;
  late: boolean;
  earlyDeparture: boolean;
  minutesLate: number | null;
  minutesEarly: number | null;
  manuallyAdjusted: boolean;
  captureMethod: CaptureMethod;
  needsAction: boolean;
  exceptionDescription?: string | null;
  postName?: string | null;
  siteId?: string;
  isReplacement?: boolean;
  originalGuardName?: string | null;
}

export interface SiteAttendanceGroup {
  siteId: string;
  siteName: string;
  supervisorName: string | null;
  guards: GuardAttendanceItem[];
  totalScheduled: number;
  totalClockedIn: number;
  totalClockedOut: number;
  totalMissing: number;
  totalExceptions: number;
}

export interface ShiftWindowGroup {
  shiftType: "day" | "night" | "other";
  shiftLabel: string;
  windowStartTime: string;
  windowEndTime: string;
  sites: SiteAttendanceGroup[];
}

export interface TodayAttendanceResponse {
  date: string;
  timeZone: string;
  totalScheduled: number;
  totalClockedIn: number;
  totalClockedOut: number;
  totalMissing: number;
  totalExceptions: number;
  shifts: ShiftWindowGroup[];
}

export async function fetchTodayAttendance(
  token: string,
  params?: {
    date?: string;
    shiftType?: "day" | "night" | "all";
    siteId?: string;
    q?: string;
  }
): Promise<TodayAttendanceResponse> {
  const query = new URLSearchParams();
  if (params?.date) query.set("date", params.date);
  if (params?.shiftType) query.set("shiftType", params.shiftType);
  if (params?.siteId) query.set("siteId", params.siteId);
  if (params?.q) query.set("q", params.q);

  const qs = query.toString();
  const res = await fetch(`${API_BASE}/attendance/today${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to fetch today's attendance");
  }
  return res.json();
}

export async function quickClockIn(
  token: string,
  payload: {
    shiftId: string;
    timestamp?: string;
    reason?: string;
    latitude?: number;
    longitude?: number;
  }
): Promise<any> {
  const res = await fetch(`${API_BASE}/attendance/quick-clock-in`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to record clock-in");
  }
  return res.json();
}

export async function quickClockOut(
  token: string,
  payload: {
    shiftId: string;
    timestamp?: string;
    reason?: string;
    latitude?: number;
    longitude?: number;
  }
): Promise<any> {
  const res = await fetch(`${API_BASE}/attendance/quick-clock-out`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to record clock-out");
  }
  return res.json();
}

export async function markAbsent(
  token: string,
  payload: {
    shiftId: string;
    reason: string;
  }
): Promise<any> {
  const res = await fetch(`${API_BASE}/attendance/mark-absent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to mark absent");
  }
  return res.json();
}

export async function adjustAttendance(
  token: string,
  attendanceId: string,
  payload: {
    clockIn?: string | null;
    clockOut?: string | null;
    reason: string;
  }
): Promise<any> {
  const res = await fetch(`${API_BASE}/attendance/${encodeURIComponent(attendanceId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to adjust attendance");
  }
  return res.json();
}

export async function replaceGuard(
  token: string,
  payload: {
    shiftId: string;
    replacementEmployeeId: string;
    reason: string;
  }
): Promise<any> {
  const res = await fetch(`${API_BASE}/attendance/replace-guard`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to replace guard");
  }
  return res.json();
}

export interface AvailableGuardOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  status: string;
  phone: string | null;
}

export async function fetchAvailableGuards(token: string): Promise<AvailableGuardOption[]> {
  const res = await fetch(`${API_BASE}/employees?status=active&limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || "Failed to fetch guards list");
  }
  const body = await res.json();
  const list = body.data || body || [];
  return list.map((e: any) => ({
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    employeeNumber: e.employeeNumber,
    status: e.status,
    phone: e.phone ?? null,
  }));
}
