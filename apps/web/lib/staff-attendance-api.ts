import { authFetch } from "./api";

export type StaffAttendanceStatus =
  | "present"
  | "absent"
  | "leave"
  | "sick_leave"
  | "public_holiday"
  | "off";

export type StaffAttendanceRow = {
  employeeId: string;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  jobRole: string | null;
  ordinaryHours: string | null;
  status: StaffAttendanceStatus | null;
  timeIn: string | null;
  timeOut: string | null;
  hoursWorked: number | null;
  notes: string | null;
  onApprovedLeave: boolean;
  approvedLeaveType: string | null;
};

export type StaffAttendanceDay = {
  date: string;
  rows: StaffAttendanceRow[];
  counts: { present: number; absent: number; onLeave: number; notCaptured: number };
  totalGeneralEmployees: number;
};

export type StaffAttendanceEntry = {
  employeeId: string;
  status: StaffAttendanceStatus;
  timeIn?: string | null;
  timeOut?: string | null;
  notes?: string | null;
};

export type StaffAttendanceBulkResult = {
  ok: string[];
  failed: Array<{ employeeId: string; code: string; message: string }>;
};

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string; error?: string }).error ||
        (body as { message?: string }).message ||
        "Request failed"
    );
  }
  return (await res.json()) as T;
}

export async function fetchStaffAttendanceDay(token: string, date: string, q?: string) {
  const params = new URLSearchParams({ date });
  if (q?.trim()) params.set("q", q.trim());
  const res = await authFetch(`/staff-attendance/day?${params}`, token);
  return parseJson<StaffAttendanceDay>(res);
}

export async function setStaffAttendanceDay(
  token: string,
  date: string,
  entry: StaffAttendanceEntry
) {
  const res = await authFetch("/staff-attendance/day", token, {
    method: "PUT",
    body: JSON.stringify({ date, ...entry }),
  });
  return parseJson<{ record: { id: string } }>(res);
}

/** Resolves even when some people are rejected — inspect `failed`. */
export async function bulkSetStaffAttendanceDay(
  token: string,
  date: string,
  entries: StaffAttendanceEntry[]
) {
  const res = await authFetch("/staff-attendance/day/bulk", token, {
    method: "POST",
    body: JSON.stringify({ date, entries }),
  });
  return parseJson<StaffAttendanceBulkResult>(res);
}
