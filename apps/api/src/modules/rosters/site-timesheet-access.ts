/**
 * Site timesheets are a single record set surfaced inside both the Attendance
 * and Rostering modules, so either grant is sufficient by design. This union is
 * deliberate and is not one of the legacy cross-module fallbacks that were
 * retired in the explicit-grants migration.
 */
export const SITE_TIMESHEET_MODULES = ["/attendance", "/rostering"] as const;
