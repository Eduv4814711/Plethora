-- CreateTable
CREATE TABLE "OfficeAttendance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "officeSiteId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "clockInLat" DECIMAL(10,7),
    "clockInLng" DECIMAL(10,7),
    "clockOutLat" DECIMAL(10,7),
    "clockOutLng" DECIMAL(10,7),
    "hoursWorked" DECIMAL(10,2),
    "overtimeHours" DECIMAL(10,2),
    "status" TEXT NOT NULL DEFAULT 'clocked_in',
    "source" TEXT NOT NULL DEFAULT 'whatsapp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficeAttendance_companyId_employeeId_workDate_idx" ON "OfficeAttendance"("companyId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "OfficeAttendance_employeeId_status_clockOut_idx" ON "OfficeAttendance"("employeeId", "status", "clockOut");

-- CreateIndex
CREATE INDEX "OfficeAttendance_officeSiteId_idx" ON "OfficeAttendance"("officeSiteId");

-- CreateIndex
CREATE INDEX "OfficeAttendance_companyId_createdAt_idx" ON "OfficeAttendance"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "OfficeAttendance" ADD CONSTRAINT "OfficeAttendance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeAttendance" ADD CONSTRAINT "OfficeAttendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeAttendance" ADD CONSTRAINT "OfficeAttendance_officeSiteId_fkey" FOREIGN KEY ("officeSiteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
