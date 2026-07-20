import { authFetch } from "./api";

export type RosterShiftCode = "D" | "N" | "O" | "L" | "SL" | "TR" | "SB" | "AWOL" | "R" | "blank";

export type RosterWarning = {
  code: string;
  severity: "advisory" | "hard";
  message: string;
  guardId?: string;
  guardName?: string;
  dateKey?: string;
  patternDayIndex?: number;
};

export type RosterGridCell = {
  guardId: string;
  guardName: string;
  patternDayIndex?: number;
  dateKey?: string;
  shiftCode: RosterShiftCode;
  shiftType: string;
  postId?: string | null;
  isLocked?: boolean;
  notes?: string | null;
  source?: string;
  isPatternLinked?: boolean;
  overrideId?: string | null;
};

export type RosterGridRow = {
  guardId: string;
  guardName: string;
  gender?: string | null;
  phone?: string | null;
  isPlaceholder?: boolean;
  placeholderType?: "unknown" | "reliever";
  cells: RosterGridCell[];
  totals: Record<string, number>;
};

export type RosterPeriodGrid = {
  siteId: string;
  siteName: string;
  mode: "pattern" | "live";
  periodStart: string;
  periodEnd: string;
  patternDays?: number[];
  calendarDays: string[];
  rows: RosterGridRow[];
  warnings: RosterWarning[];
  coverageByDay: Record<string, { day: number; night: number; requiredDay: number; requiredNight: number }>;
  activePattern: {
    id: string;
    name: string;
    anchorDate: string;
    cycleLengthDays: number;
    status: string;
  } | null;
};

export type RosterSiteConfig = {
  id: string;
  name: string;
  rosterDayShiftGuardsRequired: number;
  rosterNightShiftGuardsRequired: number;
  rosterDayShiftGender: string | null;
  rosterNightShiftGender: string | null;
  rosterDayShiftStartTime: string | null;
  rosterDayShiftEndTime: string | null;
  rosterNightShiftStartTime: string | null;
  rosterNightShiftEndTime: string | null;
  rosterSiteMode: string | null;
  rosterPeriodStartDay: number | null;
  rosterPeriodEndDay: number | null;
  rosterSiteRules: string | null;
  rosterSheetNotes: string | null;
  rosterRelieverEmployeeIds: string[];
  assignedGuardIds: string[];
  activePattern: RosterPeriodGrid["activePattern"] & { effectiveFrom?: string };
};

export type RosterPatternSummary = {
  id: string;
  siteId: string;
  name: string;
  anchorDate: string;
  cycleLengthDays: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  guardCount: number;
  cellCount: number;
};

export type PublishRosterResponse = {
  success: boolean;
  blocked: boolean;
  message: string;
  publishedCount: number;
  skippedCount: number;
  replacedCount: number;
  warnings: RosterWarning[];
};

export type RosterContinuityState = "not_setup" | "running" | "needs_attention" | "paused";

export type RosterActionPermissions = {
  canManageBaseline: boolean;
  canManageExceptions: boolean;
  canUseAdvancedEditor: boolean;
};

export type RosterContinuityIssue = {
  id: string;
  title: string;
  message: string;
  priority: "CRITICAL" | "MEDIUM" | "LOW";
  metadata?: { dateKey?: string; shiftType?: "day" | "night"; [key: string]: unknown } | null;
  createdAt: string;
};

export type RosterContinuityStatus = {
  siteId: string;
  siteName: string;
  state: RosterContinuityState;
  calendarId: string | null;
  calendar: { id: string; name: string; startDay: number; endDay: number };
  guardCount: number;
  permissions: RosterActionPermissions;
  maintainedThrough: string | null;
  lastReconciledAt: string | null;
  lastStatus: string | null;
  pauseReason: string | null;
  activePattern: {
    id: string;
    name: string;
    cycleLengthDays: number;
    effectiveFrom: string;
  } | null;
  issues: RosterContinuityIssue[];
};

export type RosterContinuityOverviewSite = {
  siteId: string;
  siteName: string;
  state: RosterContinuityState;
  maintainedThrough: string | null;
  lastReconciledAt: string | null;
  lastStatus: string | null;
  guardCount: number;
  issueCount: number;
  criticalIssueCount: number;
  activePatternName: string | null;
  calendar: { id: string; name: string; startDay: number; endDay: number };
  nextIssue: {
    id: string;
    title: string;
    message: string;
    priority: "CRITICAL" | "MEDIUM" | "LOW";
    dateKey: string | null;
    shiftType: "day" | "night" | null;
  } | null;
};

export type RosterContinuityOverview = {
  summary: {
    total: number;
    running: number;
    needsAttention: number;
    paused: number;
    notSetup: number;
  };
  permissions: RosterActionPermissions;
  sites: RosterContinuityOverviewSite[];
};

export type RosterSetupSuggestion = {
  siteId: string;
  siteName: string;
  canActivate: boolean;
  confidencePercent: number;
  source: "roster_grid" | "published_shifts";
  sourcePeriod?: { startDate: string; endDate: string };
  message?: string;
  calendars: { id: string; name: string; startDay: number; endDay: number }[];
  recommendedCalendarId: string;
  calendarConfidence?: "high" | "fallback";
  recommendedEffectiveFrom: string;
  assignedGuards: { id: string; name: string }[];
  pattern: {
    name: string;
    anchorDate: string;
    cycleLengthDays: number;
    cells: {
      guardId: string;
      patternDayIndex: number;
      shiftCode: RosterShiftCode;
    }[];
  } | null;
  issues: string[];
};

export type RosterReplacementSuggestion = {
  employeeId: string;
  name: string;
  score: number;
  reasons: string[];
};

export type SiteTimesheetAttendance =
  | "pending"
  | "present"
  | "absent"
  | "late"
  | "left_early"
  | "reliever"
  | "shift_swapped"
  | "leave"
  | "sick_leave"
  | "training"
  | "off";

export type SiteTimesheetRow = {
  id: string;
  workDate: string;
  dayOfWeek: string;
  plannedGuardId: string | null;
  plannedGuardName: string | null;
  actualGuardId: string | null;
  actualGuardName: string | null;
  employeeNumber: string | null;
  psiraNumber: string | null;
  plannedShiftCode: string | null;
  plannedShiftType: string | null;
  actualShiftCode: string | null;
  actualShiftType: string | null;
  clockIn: string | null;
  clockOut: string | null;
  hoursWorked: number | null;
  overtimeHours: number | null;
  attendanceStatus: SiteTimesheetAttendance;
  approvalStatus: "pending" | "partially_reviewed" | "reviewed" | "approved";
  dutyOnObNumber: string | null;
  dutyOffObNumber: string | null;
  /** @deprecated Use dutyOnObNumber */
  occurrenceBookNumber: string | null;
  comments: string | null;
  discrepancyCodes: string[];
};

export type SiteTimesheet = {
  id: string;
  siteId: string;
  siteName: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "approved" | "locked";
  reviewedBy: string | null;
  reviewedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalNotes: string | null;
  rows: SiteTimesheetRow[];
  totals: {
    dayShifts: number;
    nightShifts: number;
    relieverShifts: number;
    absences: number;
    totalHours: number;
    overtimeHours: number;
    discrepancies: number;
  };
};

export type GuardPickerOption = {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber?: string | null;
  psiraNumber?: string | null;
};

function isSelectableSecurityGuard(
  e: GuardPickerOption & { employeeType?: string; status?: string; jobRole?: string | null }
) {
  return (
    (e.employeeType ?? "security") === "security" &&
    e.status !== "offboarded" &&
    !(e.jobRole ?? "").startsWith("roster_placeholder:")
  );
}

/** Paginates through security guards — the list API caps at 100 per page. */
export async function fetchSecurityGuardOptions(token: string): Promise<GuardPickerOption[]> {
  const limit = 100;
  let offset = 0;
  const all: GuardPickerOption[] = [];
  for (;;) {
    const res = await authFetch(`/employees?limit=${limit}&offset=${offset}&employeeType=security`, token);
    const json = await res.json();
    const batch = (json.data ?? []).filter(isSelectableSecurityGuard);
    all.push(...batch);
    const total = Number(json.total) || 0;
    offset += limit;
    if (offset >= total || batch.length === 0) break;
  }
  return all;
}

type EmployeeListRow = GuardPickerOption & { status?: string };

function toGuardPickerOption(e: EmployeeListRow): GuardPickerOption {
  return {
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    employeeNumber: e.employeeNumber ?? null,
    psiraNumber: e.psiraNumber ?? null,
  };
}

/** Paginates through employees for pickers — the list API caps at 100 per page. */
export async function fetchEmployeePickerOptions(
  token: string,
  options?: { statuses?: string[] }
): Promise<GuardPickerOption[]> {
  const statusFilter = options?.statuses ? new Set(options.statuses) : null;
  const limit = 100;
  let offset = 0;
  const all: GuardPickerOption[] = [];
  for (;;) {
    const res = await authFetch(`/employees?limit=${limit}&offset=${offset}`, token);
    if (!res.ok) break;
    const json = await res.json();
    const rows: EmployeeListRow[] = json.data ?? [];
    const batch = rows
      .filter((e) => !statusFilter || (e.status && statusFilter.has(e.status)))
      .map(toGuardPickerOption);
    all.push(...batch);
    const total = Number(json.total) || 0;
    offset += limit;
    if (offset >= total || rows.length === 0) break;
  }
  return all.sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, undefined, {
      sensitivity: "base",
    })
  );
}

function guardOptionFromTimesheetName(
  id: string | null,
  name: string | null,
  employeeNumber?: string | null,
  psiraNumber?: string | null
): GuardPickerOption | null {
  if (!id || !name?.trim()) return null;
  const parts = name.trim().split(/\s+/);
  return {
    id,
    firstName: parts[0] ?? name,
    lastName: parts.slice(1).join(" ") || "",
    employeeNumber: employeeNumber ?? null,
    psiraNumber: psiraNumber ?? null,
  };
}

/** Ensures scheduled/actual guards on timesheet rows always appear in pickers. */
export function mergeTimesheetGuardOptions(
  guards: GuardPickerOption[],
  rows: SiteTimesheetRow[]
): GuardPickerOption[] {
  const byId = new Map(guards.map((g) => [g.id, g]));
  for (const row of rows) {
    const plannedUsesSharedNumbers = !row.actualGuardId || row.actualGuardId === row.plannedGuardId;
    for (const opt of [
      guardOptionFromTimesheetName(
        row.plannedGuardId,
        row.plannedGuardName,
        plannedUsesSharedNumbers ? row.employeeNumber : null,
        plannedUsesSharedNumbers ? row.psiraNumber : null
      ),
      guardOptionFromTimesheetName(row.actualGuardId, row.actualGuardName, row.employeeNumber, row.psiraNumber),
    ]) {
      if (opt && !byId.has(opt.id)) byId.set(opt.id, opt);
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, undefined, {
      sensitivity: "base",
    })
  );
}

export type SiteTimesheetCaptureOverviewSite = {
  siteId: string;
  siteName: string;
  status: "caught_up" | "needs_capture" | "no_shifts";
  dueDays: number;
  pendingRows: number;
  pendingDayRows: number;
  pendingNightRows: number;
  reviewedRows: number;
  lastCapturedDate: string | null;
  timesheetStatus: "draft" | "approved" | "locked" | "none";
};

export type AttendanceShiftTypeFilter = "day" | "night" | "all";

export type SiteTimesheetCaptureOverview = {
  periodStart: string;
  periodEnd: string;
  captureThrough: string | null;
  asOfDate: string;
  shiftType?: AttendanceShiftTypeFilter;
  sites: SiteTimesheetCaptureOverviewSite[];
  summary: {
    totalSites: number;
    needsCapture: number;
    caughtUp: number;
    noShifts: number;
    pendingDayRows: number;
    pendingNightRows: number;
  };
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  return data as T;
}

export async function fetchSiteRosterConfig(token: string, siteId: string) {
  const res = await authFetch(`/rosters/sites/${siteId}/config`, token);
  return parseJson<RosterSiteConfig>(res);
}

export async function fetchContinuitySetupSuggestion(token: string, siteId: string) {
  return parseJson<RosterSetupSuggestion>(
    await authFetch(`/rosters/sites/${siteId}/setup-suggestion`, token)
  );
}

export async function fetchRosterContinuityOverview(token: string) {
  return parseJson<RosterContinuityOverview>(
    await authFetch("/rosters/continuity-overview", token)
  );
}

export async function fetchRosterContinuityStatus(token: string, siteId: string) {
  return parseJson<RosterContinuityStatus>(
    await authFetch(`/rosters/sites/${siteId}/continuity-status`, token)
  );
}

export async function activateRosterContinuity(
  token: string,
  siteId: string,
  input: { calendarId: string; effectiveFrom: string }
) {
  return parseJson<{ patternId: string; reconciliation: { maintainedThrough: string | null; issues: unknown[] } }>(
    await authFetch(`/rosters/sites/${siteId}/activate-continuity`, token, {
      method: "POST",
      body: JSON.stringify(input),
    })
  );
}

export async function reconcileRosterContinuity(token: string, siteId: string) {
  return parseJson<{ maintainedThrough: string | null; issues: unknown[] }>(
    await authFetch(`/rosters/sites/${siteId}/reconcile`, token, { method: "POST" })
  );
}

export async function pauseRosterContinuity(
  token: string,
  siteId: string,
  paused: boolean,
  reason?: string
) {
  return parseJson<{ ok: true; state: RosterContinuityState }>(
    await authFetch(`/rosters/sites/${siteId}/continuity-pause`, token, {
      method: "POST",
      body: JSON.stringify({ paused, reason }),
    })
  );
}

export async function fetchReplacementSuggestions(token: string, alertId: string) {
  return parseJson<{
    alertId: string;
    dateKey: string;
    shiftType: "day" | "night";
    suggestions: RosterReplacementSuggestion[];
  }>(await authFetch(`/rosters/continuity/issues/${alertId}/replacements`, token));
}

export async function confirmRosterReplacement(
  token: string,
  alertId: string,
  employeeId: string
) {
  return parseJson<{ replacement: RosterReplacementSuggestion }>(
    await authFetch(`/rosters/continuity/issues/${alertId}/replacements`, token, {
      method: "POST",
      body: JSON.stringify({ employeeId }),
    })
  );
}

export async function fetchPatternGrid(
  token: string,
  siteId: string,
  startDate: string,
  endDate: string,
  patternId?: string,
  cycleLengthDays?: number,
  anchorDate?: string
) {
  const q = new URLSearchParams({ siteId, startDate, endDate });
  if (patternId) q.set("patternId", patternId);
  if (cycleLengthDays) q.set("cycleLengthDays", String(cycleLengthDays));
  if (anchorDate) q.set("anchorDate", anchorDate);
  const res = await authFetch(`/rosters/pattern-grid?${q}`, token);
  return parseJson<RosterPeriodGrid>(res);
}

export async function updateSiteAssignedGuards(
  token: string,
  siteId: string,
  assignedGuardIds: string[]
) {
  const res = await authFetch(`/sites/${siteId}`, token, {
    method: "PUT",
    body: JSON.stringify({ assignedGuardIds }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data?.error || data?.message || "Failed to update site guards");
  }
}

export async function addPlaceholderGuardToSite(
  token: string,
  siteId: string,
  type: "unknown" | "reliever"
) {
  const res = await authFetch(`/rosters/sites/${siteId}/placeholder-guards`, token, {
    method: "POST",
    body: JSON.stringify({ type }),
  });
  return parseJson<{ guardId: string; guardName: string; placeholderType: "unknown" | "reliever" }>(res);
}

export async function fetchLiveRoster(
  token: string,
  siteId: string,
  startDate: string,
  endDate: string,
  fillFromPattern = false
) {
  const q = new URLSearchParams({ siteId, startDate, endDate });
  if (fillFromPattern) q.set("fillFromPattern", "true");
  const res = await authFetch(`/rosters/live-roster?${q}`, token);
  return parseJson<RosterPeriodGrid>(res);
}

export async function createPattern(
  token: string,
  body: {
    siteId: string;
    name: string;
    anchorDate: string;
    cycleLengthDays: number;
    effectiveFrom: string;
    cells?: { guardId: string; patternDayIndex: number; shiftCode: RosterShiftCode; isLocked?: boolean }[];
  }
) {
  const res = await authFetch("/rosters/patterns", token, { method: "POST", body: JSON.stringify(body) });
  return parseJson<RosterPatternSummary>(res);
}

export async function updatePattern(
  token: string,
  patternId: string,
  body: {
    name?: string;
    anchorDate?: string;
    cycleLengthDays?: number;
    effectiveFrom?: string;
    cells?: { guardId: string; patternDayIndex: number; shiftCode: RosterShiftCode; isLocked?: boolean }[];
  }
) {
  const res = await authFetch(`/rosters/patterns/${patternId}`, token, { method: "PUT", body: JSON.stringify(body) });
  return parseJson<RosterPatternSummary>(res);
}

export async function activatePattern(
  token: string,
  patternId: string,
  body?: { effectiveFrom?: string; changeReason?: string }
) {
  const res = await authFetch(`/rosters/patterns/${patternId}/activate`, token, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
  return parseJson<RosterPatternSummary>(res);
}

export async function generateRosterFromPattern(
  token: string,
  body: { siteId: string; startDate: string; endDate: string; persist?: boolean }
) {
  const res = await authFetch("/rosters/generate", token, { method: "POST", body: JSON.stringify(body) });
  return parseJson<{ generatedCount: number; grid: RosterPeriodGrid }>(res);
}

export async function applyManualOverride(
  token: string,
  body: {
    siteId: string;
    guardId: string;
    rosterDate: string;
    overrideShiftCode: RosterShiftCode;
    reason?: string;
    doesChangeBasePattern?: boolean;
  }
) {
  const res = await authFetch("/rosters/overrides", token, { method: "POST", body: JSON.stringify(body) });
  return parseJson<{ success: boolean }>(res);
}

export async function applyManualOverridesBulk(
  token: string,
  body: {
    siteId: string;
    changes: {
      guardId: string;
      rosterDate: string;
      overrideShiftCode: RosterShiftCode;
      reason?: string;
      doesChangeBasePattern?: boolean;
    }[];
  }
) {
  const res = await authFetch("/rosters/overrides/bulk", token, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return parseJson<{ success: boolean; savedCount: number }>(res);
}

export async function publishRoster(
  token: string,
  body: { siteId: string; startDate: string; endDate: string; replaceExisting?: boolean }
) {
  const res = await authFetch("/rosters/publish", token, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return parseJson<PublishRosterResponse>(res);
}

export async function fetchSiteTimesheetCaptureOverview(
  token: string,
  startDate: string,
  endDate: string,
  shiftType: AttendanceShiftTypeFilter = "all"
) {
  const q = new URLSearchParams({ startDate, endDate, shiftType });
  const res = await authFetch(`/rosters/site-timesheets/capture-overview?${q}`, token);
  return parseJson<SiteTimesheetCaptureOverview>(res);
}

export async function fetchSiteTimesheet(token: string, siteId: string, startDate: string, endDate: string) {
  const q = new URLSearchParams({ siteId, startDate, endDate });
  const res = await authFetch(`/rosters/site-timesheets?${q}`, token);
  return parseJson<SiteTimesheet>(res);
}

export async function resyncSiteTimesheet(token: string, siteId: string, startDate: string, endDate: string) {
  const res = await authFetch(`/rosters/site-timesheets/resync`, token, {
    method: "POST",
    body: JSON.stringify({ siteId, startDate, endDate }),
  });
  return parseJson<SiteTimesheet>(res);
}

export async function updateSiteTimesheetRow(
  token: string,
  rowId: string,
  body: Partial<
    Pick<
      SiteTimesheetRow,
      | "actualGuardId"
      | "actualShiftCode"
      | "actualShiftType"
      | "clockIn"
      | "clockOut"
      | "hoursWorked"
      | "overtimeHours"
      | "attendanceStatus"
      | "approvalStatus"
      | "dutyOnObNumber"
      | "dutyOffObNumber"
      | "occurrenceBookNumber"
      | "comments"
    >
  >
) {
  const res = await authFetch(`/rosters/site-timesheets/rows/${rowId}`, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return parseJson<{ row: SiteTimesheetRow }>(res);
}

export async function addSiteTimesheetRow(
  token: string,
  timesheetId: string,
  body: {
    workDate: string;
    actualGuardId: string;
    actualShiftCode: string;
    actualShiftType: string;
    attendanceStatus: SiteTimesheetAttendance;
    dutyOnObNumber: string;
    dutyOffObNumber?: string | null;
    /** @deprecated Use dutyOnObNumber */
    occurrenceBookNumber?: string;
    comments?: string | null;
    hoursWorked?: number | null;
    overtimeHours?: number | null;
  }
) {
  const res = await authFetch(`/rosters/site-timesheets/${timesheetId}/rows`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return parseJson<{ row: SiteTimesheetRow }>(res);
}

export async function approveSiteTimesheet(
  token: string,
  timesheetId: string,
  options?: { notes?: string; shiftType?: AttendanceShiftTypeFilter }
) {
  const res = await authFetch(`/rosters/site-timesheets/${timesheetId}/approve`, token, {
    method: "POST",
    body: JSON.stringify({
      notes: options?.notes,
      shiftType: options?.shiftType ?? "all",
    }),
  });
  return parseJson<{
    success: boolean;
    locked: boolean;
    approvedRowCount: number;
    remainingPending: number;
    shiftType: AttendanceShiftTypeFilter;
  }>(res);
}

export async function unlockSiteTimesheet(token: string, timesheetId: string, reason?: string) {
  const res = await authFetch(`/rosters/site-timesheets/${timesheetId}/unlock`, token, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
  return parseJson<{ success: boolean }>(res);
}

export function siteTimesheetCsvUrl(
  siteId: string,
  startDate: string,
  endDate: string,
  shiftType: AttendanceShiftTypeFilter = "all"
) {
  const q = new URLSearchParams({ siteId, startDate, endDate });
  if (shiftType !== "all") q.set("shiftType", shiftType);
  return `/rosters/site-timesheets/export.csv?${q}`;
}

export const SHIFT_CODE_OPTIONS: { code: RosterShiftCode; label: string }[] = [
  { code: "D", label: "Day" },
  { code: "N", label: "Night" },
  { code: "O", label: "Off" },
  { code: "L", label: "Leave" },
  { code: "SL", label: "Sick" },
  { code: "TR", label: "Training" },
  { code: "SB", label: "Standby" },
  { code: "AWOL", label: "AWOL" },
  { code: "R", label: "Replaced" },
  { code: "blank", label: "—" },
];

/** Shift codes shown in the simplified manual roster builder UI. */
export const MANUAL_SHIFT_CODE_OPTIONS: { code: RosterShiftCode; label: string }[] = [
  { code: "D", label: "Day shift" },
  { code: "N", label: "Night shift" },
  { code: "O", label: "Off" },
  { code: "L", label: "Leave" },
  { code: "SL", label: "Sick leave" },
  { code: "TR", label: "Training" },
  { code: "blank", label: "Unassigned" },
];

export const SHIFT_CODE_COLORS: Record<RosterShiftCode, string> = {
  D: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  N: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100",
  O: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  L: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
  SL: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100",
  TR: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100",
  SB: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-100",
  AWOL: "bg-red-200 text-red-950 dark:bg-red-950 dark:text-red-100",
  R: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100",
  blank: "bg-white text-neutral-400 dark:bg-neutral-950 dark:text-neutral-600",
};

export const CYCLE_LENGTH_PRESETS = [3, 6, 7, 9, 12, 14];
