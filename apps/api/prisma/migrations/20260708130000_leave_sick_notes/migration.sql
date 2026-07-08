-- CreateTable
CREATE TABLE "LeaveSickNote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveSickNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveSickNote_companyId_idx" ON "LeaveSickNote"("companyId");

-- CreateIndex
CREATE INDEX "LeaveSickNote_employeeId_startDate_endDate_idx" ON "LeaveSickNote"("employeeId", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "LeaveSickNote" ADD CONSTRAINT "LeaveSickNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveSickNote" ADD CONSTRAINT "LeaveSickNote_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
