-- Management System Review operational modules
-- Alerts, site enhancements, attendance exceptions, documents, incidents,
-- approvals, notifications, client portal, payroll readiness, task upgrades

-- Extend UserRole with client portal role
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'client';

-- CreateEnum
CREATE TYPE "SiteRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "SiteOperationalStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING', 'SUSPENDED');
CREATE TYPE "AlertPriority" AS ENUM ('CRITICAL', 'MEDIUM', 'LOW');
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');
CREATE TYPE "AlertSourceModule" AS ENUM ('DASHBOARD', 'ATTENDANCE', 'ROSTERING', 'PAYROLL', 'TASKS', 'SITES', 'DOCUMENTS', 'INCIDENTS', 'REPORTS', 'WHATSAPP', 'APPROVALS');
CREATE TYPE "AttendanceExceptionType" AS ENUM ('LATE_ARRIVAL', 'EARLY_DEPARTURE', 'MISSED_CLOCK_IN', 'MISSED_CLOCK_OUT', 'ABSENT', 'OUTSIDE_GEOFENCE', 'UNSCHEDULED_CLOCK_IN', 'PENDING_SUPERVISOR_REVIEW', 'MANUAL_ADJUSTMENT_REQUIRED', 'SHIFT_NOT_FOUND', 'DUPLICATE_CLOCK_EVENT');
CREATE TYPE "ExceptionSeverity" AS ENUM ('CRITICAL', 'MEDIUM', 'LOW');
CREATE TYPE "ExceptionReviewStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED');
CREATE TYPE "DocumentCategory" AS ENUM ('EMPLOYEE', 'SITE', 'CLIENT', 'PAYROLL', 'ATTENDANCE', 'INCIDENT', 'EQUIPMENT', 'COMPLIANCE', 'TASK', 'OTHER');
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'ARCHIVED', 'PENDING_REVIEW');
CREATE TYPE "IncidentType" AS ENUM ('THEFT', 'BREAK_IN', 'ASSAULT', 'GUARD_MISCONDUCT', 'CLIENT_COMPLAINT', 'EQUIPMENT_DAMAGE', 'SITE_EMERGENCY', 'SAFETY_RISK', 'ABSENTEEISM', 'TRESPASSING', 'FIRE', 'MEDICAL_EMERGENCY', 'OTHER');
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "IncidentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED');
CREATE TYPE "SupervisorApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'QUERY_RAISED');
CREATE TYPE "ApprovalType" AS ENUM ('ATTENDANCE_EXCEPTION', 'MISSED_CLOCK_IN', 'MISSED_CLOCK_OUT', 'OVERTIME', 'LEAVE', 'SICK_NOTE', 'SITE_TIMESHEET', 'INCIDENT', 'TASK_COMPLETION', 'PAYROLL_READINESS', 'DOCUMENT_REVIEW');
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'QUERY_RAISED');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'WHATSAPP', 'EMAIL');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');
CREATE TYPE "PayrollReadinessStatus" AS ENUM ('READY', 'PENDING_ATTENDANCE_REVIEW', 'BLOCKED_BY_EXCEPTIONS', 'APPROVED_MANUALLY');

-- AlterEnum TaskStatus / TaskPriority
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'blocked';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE "TaskPriority" ADD VALUE IF NOT EXISTS 'critical';

-- AlterTable Site
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "clientContactEmail" TEXT;
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "contractStartDate" TIMESTAMP(3);
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "contractEndDate" TIMESTAMP(3);
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "supervisorId" TEXT;
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "riskLevel" "SiteRiskLevel" NOT NULL DEFAULT 'LOW';
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "siteStatus" "SiteOperationalStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "siteInstructions" TEXT;
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "clientId" TEXT;

-- AlterTable Task
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "completionPercentage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "recurrenceEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "parentTaskId" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "notificationSettings" JSONB;

-- CreateTable Client
CREATE TABLE IF NOT EXISTS "Client" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "userId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable OperationalAlert
CREATE TABLE IF NOT EXISTS "OperationalAlert" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "priority" "AlertPriority" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "sourceModule" "AlertSourceModule" NOT NULL,
    "dedupeKey" TEXT,
    "sourceId" TEXT,
    "assignedToId" TEXT,
    "siteId" TEXT,
    "employeeId" TEXT,
    "metadata" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OperationalAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable AttendanceException
CREATE TABLE IF NOT EXISTS "AttendanceException" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "shiftId" TEXT,
    "employeeId" TEXT,
    "siteId" TEXT,
    "exceptionType" "AttendanceExceptionType" NOT NULL,
    "severity" "ExceptionSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "minutesLate" INTEGER,
    "minutesEarly" INTEGER,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ExceptionReviewStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceException_pkey" PRIMARY KEY ("id")
);

-- CreateTable Incident
CREATE TABLE IF NOT EXISTS "Incident" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "incidentNumber" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "assignedSupervisorId" TEXT,
    "incidentDateTime" TIMESTAMP(3) NOT NULL,
    "incidentType" "IncidentType" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "peopleInvolved" TEXT,
    "witnesses" TEXT,
    "clientVisible" BOOLEAN NOT NULL DEFAULT false,
    "status" "IncidentStatus" NOT NULL DEFAULT 'DRAFT',
    "supervisorApprovalStatus" "SupervisorApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "supervisorNote" TEXT,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpTaskId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable IncidentAttachment
CREATE TABLE IF NOT EXISTS "IncidentAttachment" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IncidentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable ManagedDocument
CREATE TABLE IF NOT EXISTS "ManagedDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "employeeId" TEXT,
    "siteId" TEXT,
    "clientId" TEXT,
    "incidentId" TEXT,
    "taskId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable ApprovalRequest
CREATE TABLE IF NOT EXISTS "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "approvalType" "ApprovalType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approverId" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable AppNotification
CREATE TABLE IF NOT EXISTS "AppNotification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "dedupeKey" TEXT,
    "sourceModule" TEXT,
    "sourceId" TEXT,
    "linkUrl" TEXT,
    "metadata" JSONB,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable PayrollPeriodReadiness
CREATE TABLE IF NOT EXISTS "PayrollPeriodReadiness" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "PayrollReadinessStatus" NOT NULL DEFAULT 'PENDING_ATTENDANCE_REVIEW',
    "notes" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "openExceptions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollPeriodReadiness_pkey" PRIMARY KEY ("id")
);

-- Indexes & unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS "Client_userId_key" ON "Client"("userId");
CREATE INDEX IF NOT EXISTS "Client_companyId_idx" ON "Client"("companyId");
CREATE INDEX IF NOT EXISTS "Client_userId_idx" ON "Client"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "OperationalAlert_companyId_dedupeKey_key" ON "OperationalAlert"("companyId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "OperationalAlert_companyId_status_priority_idx" ON "OperationalAlert"("companyId", "status", "priority");
CREATE INDEX IF NOT EXISTS "OperationalAlert_companyId_sourceModule_idx" ON "OperationalAlert"("companyId", "sourceModule");
CREATE INDEX IF NOT EXISTS "OperationalAlert_siteId_idx" ON "OperationalAlert"("siteId");
CREATE INDEX IF NOT EXISTS "OperationalAlert_assignedToId_idx" ON "OperationalAlert"("assignedToId");
CREATE INDEX IF NOT EXISTS "OperationalAlert_createdAt_idx" ON "OperationalAlert"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceException_companyId_dedupeKey_key" ON "AttendanceException"("companyId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "AttendanceException_companyId_status_severity_idx" ON "AttendanceException"("companyId", "status", "severity");
CREATE INDEX IF NOT EXISTS "AttendanceException_companyId_exceptionType_idx" ON "AttendanceException"("companyId", "exceptionType");
CREATE INDEX IF NOT EXISTS "AttendanceException_siteId_idx" ON "AttendanceException"("siteId");
CREATE INDEX IF NOT EXISTS "AttendanceException_employeeId_idx" ON "AttendanceException"("employeeId");
CREATE INDEX IF NOT EXISTS "AttendanceException_shiftId_idx" ON "AttendanceException"("shiftId");
CREATE INDEX IF NOT EXISTS "AttendanceException_detectedAt_idx" ON "AttendanceException"("detectedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "Incident_companyId_incidentNumber_key" ON "Incident"("companyId", "incidentNumber");
CREATE INDEX IF NOT EXISTS "Incident_companyId_status_idx" ON "Incident"("companyId", "status");
CREATE INDEX IF NOT EXISTS "Incident_companyId_severity_idx" ON "Incident"("companyId", "severity");
CREATE INDEX IF NOT EXISTS "Incident_siteId_idx" ON "Incident"("siteId");
CREATE INDEX IF NOT EXISTS "Incident_incidentDateTime_idx" ON "Incident"("incidentDateTime");
CREATE INDEX IF NOT EXISTS "Incident_clientVisible_idx" ON "Incident"("clientVisible");

CREATE INDEX IF NOT EXISTS "IncidentAttachment_incidentId_idx" ON "IncidentAttachment"("incidentId");

CREATE INDEX IF NOT EXISTS "ManagedDocument_companyId_category_idx" ON "ManagedDocument"("companyId", "category");
CREATE INDEX IF NOT EXISTS "ManagedDocument_companyId_status_idx" ON "ManagedDocument"("companyId", "status");
CREATE INDEX IF NOT EXISTS "ManagedDocument_employeeId_idx" ON "ManagedDocument"("employeeId");
CREATE INDEX IF NOT EXISTS "ManagedDocument_siteId_idx" ON "ManagedDocument"("siteId");
CREATE INDEX IF NOT EXISTS "ManagedDocument_clientId_idx" ON "ManagedDocument"("clientId");
CREATE INDEX IF NOT EXISTS "ManagedDocument_expiryDate_idx" ON "ManagedDocument"("expiryDate");

CREATE INDEX IF NOT EXISTS "ApprovalRequest_companyId_status_idx" ON "ApprovalRequest"("companyId", "status");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_companyId_approvalType_idx" ON "ApprovalRequest"("companyId", "approvalType");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_approverId_status_idx" ON "ApprovalRequest"("approverId", "status");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_entityType_entityId_idx" ON "ApprovalRequest"("entityType", "entityId");

CREATE UNIQUE INDEX IF NOT EXISTS "AppNotification_companyId_dedupeKey_key" ON "AppNotification"("companyId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "AppNotification_userId_status_idx" ON "AppNotification"("userId", "status");
CREATE INDEX IF NOT EXISTS "AppNotification_companyId_createdAt_idx" ON "AppNotification"("companyId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollPeriodReadiness_companyId_periodStart_periodEnd_key" ON "PayrollPeriodReadiness"("companyId", "periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "PayrollPeriodReadiness_companyId_status_idx" ON "PayrollPeriodReadiness"("companyId", "status");

CREATE INDEX IF NOT EXISTS "Site_companyId_siteStatus_idx" ON "Site"("companyId", "siteStatus");
CREATE INDEX IF NOT EXISTS "Site_supervisorId_idx" ON "Site"("supervisorId");
CREATE INDEX IF NOT EXISTS "Site_clientId_idx" ON "Site"("clientId");
CREATE INDEX IF NOT EXISTS "Site_contractEndDate_idx" ON "Site"("contractEndDate");
CREATE INDEX IF NOT EXISTS "Site_riskLevel_idx" ON "Site"("riskLevel");

CREATE INDEX IF NOT EXISTS "Task_siteId_idx" ON "Task"("siteId");
CREATE INDEX IF NOT EXISTS "Task_priority_idx" ON "Task"("priority");
CREATE INDEX IF NOT EXISTS "Task_parentTaskId_idx" ON "Task"("parentTaskId");

-- Foreign keys
ALTER TABLE "Client" ADD CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Site" ADD CONSTRAINT "Site_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Site" ADD CONSTRAINT "Site_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task" ADD CONSTRAINT "Task_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AttendanceException" ADD CONSTRAINT "AttendanceException_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceException" ADD CONSTRAINT "AttendanceException_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttendanceException" ADD CONSTRAINT "AttendanceException_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttendanceException" ADD CONSTRAINT "AttendanceException_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Incident" ADD CONSTRAINT "Incident_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_assignedSupervisorId_fkey" FOREIGN KEY ("assignedSupervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_followUpTaskId_fkey" FOREIGN KEY ("followUpTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IncidentAttachment" ADD CONSTRAINT "IncidentAttachment_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ManagedDocument" ADD CONSTRAINT "ManagedDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagedDocument" ADD CONSTRAINT "ManagedDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManagedDocument" ADD CONSTRAINT "ManagedDocument_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManagedDocument" ADD CONSTRAINT "ManagedDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManagedDocument" ADD CONSTRAINT "ManagedDocument_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManagedDocument" ADD CONSTRAINT "ManagedDocument_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManagedDocument" ADD CONSTRAINT "ManagedDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AppNotification" ADD CONSTRAINT "AppNotification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppNotification" ADD CONSTRAINT "AppNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollPeriodReadiness" ADD CONSTRAINT "PayrollPeriodReadiness_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
