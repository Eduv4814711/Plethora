-- Site timesheets make approved site/day actuals the operational source of truth.

CREATE TYPE "SiteTimesheetStatus" AS ENUM ('draft', 'approved', 'locked');
CREATE TYPE "SiteTimesheetAttendance" AS ENUM (
  'pending',
  'present',
  'absent',
  'late',
  'left_early',
  'reliever',
  'shift_swapped',
  'leave',
  'sick_leave',
  'training',
  'off'
);
CREATE TYPE "SiteTimesheetRowStatus" AS ENUM ('pending', 'reviewed', 'approved');

CREATE TABLE "SiteTimesheet" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" "SiteTimesheetStatus" NOT NULL DEFAULT 'draft',
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "unlockedBy" TEXT,
  "unlockedAt" TIMESTAMP(3),
  "unlockReason" TEXT,
  "approvalNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SiteTimesheet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SiteTimesheetRow" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "siteTimesheetId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "workDate" DATE NOT NULL,
  "plannedGuardId" TEXT,
  "actualGuardId" TEXT,
  "plannedShiftCode" TEXT,
  "plannedShiftType" TEXT,
  "actualShiftCode" TEXT,
  "actualShiftType" TEXT,
  "clockIn" TIMESTAMP(3),
  "clockOut" TIMESTAMP(3),
  "hoursWorked" DECIMAL(10,2),
  "overtimeHours" DECIMAL(10,2),
  "attendanceStatus" "SiteTimesheetAttendance" NOT NULL DEFAULT 'pending',
  "approvalStatus" "SiteTimesheetRowStatus" NOT NULL DEFAULT 'pending',
  "comments" TEXT,
  "discrepancyCodes" JSONB,
  "sourceShiftId" TEXT,
  "sourceAttendanceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SiteTimesheetRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteTimesheet_companyId_siteId_periodStart_periodEnd_key"
  ON "SiteTimesheet"("companyId", "siteId", "periodStart", "periodEnd");
CREATE INDEX "SiteTimesheet_companyId_status_idx" ON "SiteTimesheet"("companyId", "status");
CREATE INDEX "SiteTimesheet_siteId_periodStart_periodEnd_idx" ON "SiteTimesheet"("siteId", "periodStart", "periodEnd");
CREATE INDEX "SiteTimesheetRow_companyId_workDate_idx" ON "SiteTimesheetRow"("companyId", "workDate");
CREATE INDEX "SiteTimesheetRow_companyId_actualGuardId_workDate_idx" ON "SiteTimesheetRow"("companyId", "actualGuardId", "workDate");
CREATE INDEX "SiteTimesheetRow_siteTimesheetId_workDate_idx" ON "SiteTimesheetRow"("siteTimesheetId", "workDate");
CREATE INDEX "SiteTimesheetRow_siteId_workDate_idx" ON "SiteTimesheetRow"("siteId", "workDate");

ALTER TABLE "SiteTimesheet"
  ADD CONSTRAINT "SiteTimesheet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SiteTimesheet_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteTimesheetRow"
  ADD CONSTRAINT "SiteTimesheetRow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SiteTimesheetRow_siteTimesheetId_fkey" FOREIGN KEY ("siteTimesheetId") REFERENCES "SiteTimesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SiteTimesheetRow_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SiteTimesheetRow_plannedGuardId_fkey" FOREIGN KEY ("plannedGuardId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "SiteTimesheetRow_actualGuardId_fkey" FOREIGN KEY ("actualGuardId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
