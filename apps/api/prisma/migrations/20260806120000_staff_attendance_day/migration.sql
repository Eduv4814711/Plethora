-- Daily attendance for office staff. Additive only: no existing table is touched, so
-- payroll aggregation and the attendance/leave gates are unaffected by this migration.

-- CreateEnum
CREATE TYPE "StaffAttendanceStatus" AS ENUM ('present', 'absent', 'leave', 'sick_leave', 'public_holiday', 'off');

-- CreateTable
CREATE TABLE "StaffAttendanceDay" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "status" "StaffAttendanceStatus" NOT NULL,
    "timeIn" TIMESTAMP(3),
    "timeOut" TIMESTAMP(3),
    "hoursWorked" DECIMAL(10,2),
    "notes" TEXT,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffAttendanceDay_companyId_employeeId_workDate_key" ON "StaffAttendanceDay"("companyId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "StaffAttendanceDay_companyId_workDate_idx" ON "StaffAttendanceDay"("companyId", "workDate");

-- CreateIndex
CREATE INDEX "StaffAttendanceDay_employeeId_workDate_idx" ON "StaffAttendanceDay"("employeeId", "workDate");

-- AddForeignKey
ALTER TABLE "StaffAttendanceDay" ADD CONSTRAINT "StaffAttendanceDay_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAttendanceDay" ADD CONSTRAINT "StaffAttendanceDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
