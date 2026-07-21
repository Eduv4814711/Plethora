import type { AttendanceShiftTypeFilter } from "./roster-api";

export type AttendanceRouteState = {
  start: string;
  end: string;
  shiftType: AttendanceShiftTypeFilter;
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseAttendanceDateRange(
  start: string | null | undefined,
  end: string | null | undefined
): Pick<AttendanceRouteState, "start" | "end"> | null {
  if (!start || !end || !DATE_KEY_PATTERN.test(start) || !DATE_KEY_PATTERN.test(end)) {
    return null;
  }
  const parsedStart = new Date(`${start}T00:00:00.000Z`);
  const parsedEnd = new Date(`${end}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedStart.getTime()) ||
    Number.isNaN(parsedEnd.getTime()) ||
    parsedStart.toISOString().slice(0, 10) !== start ||
    parsedEnd.toISOString().slice(0, 10) !== end ||
    start > end
  ) {
    return null;
  }
  return { start, end };
}

export function attendanceQuery(state: AttendanceRouteState): URLSearchParams {
  return new URLSearchParams({
    start: state.start,
    end: state.end,
    shiftType: state.shiftType,
  });
}

export function attendanceSiteHref(siteId: string, state: AttendanceRouteState): string {
  return `/attendance/sites/${encodeURIComponent(siteId)}?${attendanceQuery(state)}`;
}

export function attendanceOverviewHref(state: AttendanceRouteState): string {
  return `/attendance?${attendanceQuery(state)}`;
}
