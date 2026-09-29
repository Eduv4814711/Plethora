-- AlterTable Employee
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "geofenceExempt" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable StaffAttendanceDay
ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "clockInLat" DECIMAL(10,7);
ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "clockInLng" DECIMAL(10,7);
ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "clockOutLat" DECIMAL(10,7);
ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "clockOutLng" DECIMAL(10,7);
ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "clockInDistanceMeters" INTEGER;
ALTER TABLE "StaffAttendanceDay" ADD COLUMN IF NOT EXISTS "clockOutDistanceMeters" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StaffAttendanceDay_siteId_idx" ON "StaffAttendanceDay"("siteId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StaffAttendanceDay_siteId_fkey'
  ) THEN
    ALTER TABLE "StaffAttendanceDay" ADD CONSTRAINT "StaffAttendanceDay_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AlterTable WhatsAppClockPending
ALTER TABLE "WhatsAppClockPending" ALTER COLUMN "shiftId" DROP NOT NULL;
ALTER TABLE "WhatsAppClockPending" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "WhatsAppClockPending" ADD COLUMN IF NOT EXISTS "failedAttempts" INTEGER NOT NULL DEFAULT 0;
