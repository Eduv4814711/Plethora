-- Add targeted indexes for high-volume dashboard and academy API reads.
CREATE INDEX "Student_companyId_createdAt_idx" ON "Student"("companyId", "createdAt");
CREATE INDEX "CourseRun_companyId_createdAt_idx" ON "CourseRun"("companyId", "createdAt");
CREATE INDEX "Enrolment_companyId_enrolmentDate_idx" ON "Enrolment"("companyId", "enrolmentDate");
CREATE INDEX "AcademyPayment_companyId_verificationStatus_invoiceId_idx" ON "AcademyPayment"("companyId", "verificationStatus", "invoiceId");
CREATE INDEX "AcademyAttendanceSession_companyId_sessionDate_idx" ON "AcademyAttendanceSession"("companyId", "sessionDate");
CREATE INDEX "AcademyAttendanceSession_courseRunId_idx" ON "AcademyAttendanceSession"("courseRunId");
CREATE INDEX "AcademyAttendanceRecord_companyId_attendanceStatus_idx" ON "AcademyAttendanceRecord"("companyId", "attendanceStatus");
CREATE INDEX "AcademyAttendanceRecord_sessionId_idx" ON "AcademyAttendanceRecord"("sessionId");
