-- Enforce one attendance clock record per shift (app already validates; DB hardens integrity).
DROP INDEX IF EXISTS "Attendance_shiftId_key";
CREATE UNIQUE INDEX "Attendance_shiftId_key" ON "Attendance"("shiftId");

-- One planned roster cell per site timesheet (guard + work date + shift type).
-- Reliever/manual rows with NULL plannedGuardId are not constrained by this unique index in PostgreSQL.
DROP INDEX IF EXISTS "SiteTimesheetRow_siteTimesheetId_workDate_plannedGuardId_plannedShiftType_key";
CREATE UNIQUE INDEX "SiteTimesheetRow_siteTimesheetId_workDate_plannedGuardId_plannedShiftType_key"
  ON "SiteTimesheetRow"("siteTimesheetId", "workDate", "plannedGuardId", "plannedShiftType");
