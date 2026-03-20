-- AlterTable
ALTER TABLE "Site" ADD COLUMN "latitude" DECIMAL(10,7),
ADD COLUMN "longitude" DECIMAL(10,7),
ADD COLUMN "geofenceRadiusMeters" INTEGER;

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN "clockInLat" DECIMAL(10,7),
ADD COLUMN "clockInLng" DECIMAL(10,7),
ADD COLUMN "clockOutLat" DECIMAL(10,7),
ADD COLUMN "clockOutLng" DECIMAL(10,7);

-- CreateTable
CREATE TABLE "WhatsAppClockPending" (
    "id" TEXT NOT NULL,
    "waFrom" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppClockPending_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppClockPending_waFrom_key" ON "WhatsAppClockPending"("waFrom");
CREATE INDEX "WhatsAppClockPending_expiresAt_idx" ON "WhatsAppClockPending"("expiresAt");
CREATE INDEX "WhatsAppClockPending_employeeId_idx" ON "WhatsAppClockPending"("employeeId");

ALTER TABLE "WhatsAppClockPending" ADD CONSTRAINT "WhatsAppClockPending_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppClockPending" ADD CONSTRAINT "WhatsAppClockPending_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
