-- CreateTable
CREATE TABLE "AttendanceEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "shiftId" TEXT,
    "employeeId" TEXT,
    "siteId" TEXT,
    "eventType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "actorUserId" TEXT,
    "whatsappMessageId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEvent_whatsappMessageId_eventType_key" ON "AttendanceEvent"("whatsappMessageId", "eventType");
CREATE INDEX "AttendanceEvent_companyId_createdAt_idx" ON "AttendanceEvent"("companyId", "createdAt");
CREATE INDEX "AttendanceEvent_attendanceId_idx" ON "AttendanceEvent"("attendanceId");
CREATE INDEX "AttendanceEvent_shiftId_idx" ON "AttendanceEvent"("shiftId");
CREATE INDEX "AttendanceEvent_employeeId_createdAt_idx" ON "AttendanceEvent"("employeeId", "createdAt");
