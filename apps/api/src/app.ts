/**
 * Fastify application factory (`buildApp`).
 */
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import { isLocalStorage } from "./lib/storage.js";
import { uploadsRoot } from "./lib/uploads-root.js";
import { registerRequestId } from "./lib/request-id.js";
import { authRoutes } from "./routes/auth.js";
import { usersRoutes } from "./routes/users.js";
import { accessRequestsRoutes } from "./routes/access-requests.js";
import { companiesRoutes } from "./routes/companies.js";
import { employeesRoutes } from "./routes/employees.js";
import { sitesRoutes } from "./routes/sites.js";
import { rosteringRoutes } from "./modules/rostering/rostering.routes.js";
import { rostersRoutes } from "./modules/rosters/rosters.routes.js";
import { attendanceRoutes } from "./routes/attendance.js";
import { staffAttendanceRoutes } from "./modules/staff-attendance/staff-attendance.routes.js";
import { payrollRoutes } from "./routes/payroll.js";
import { payrollIntelligenceRoutes } from "./routes/payroll-intelligence.js";
import { payRulesRoutes } from "./routes/pay-rules.js";
import { groupPayRulesRoutes } from "./routes/group-pay-rules.js";
import { groupEarningsRulesRoutes } from "./routes/group-earnings-rules.js";
import { groupDeductionRulesRoutes } from "./routes/group-deduction-rules.js";
import { payGradesRoutes } from "./routes/pay-grades.js";
import { payrollPricingRoutes } from "./routes/payroll-pricing.js";
import { employeeGroupsRoutes } from "./routes/employee-groups.js";
import { earningsRulesRoutes } from "./routes/earnings-rules.js";
import { deductionRulesRoutes } from "./routes/deduction-rules.js";
import { publicHolidaysRoutes } from "./routes/public-holidays.js";
import { timesheetsRoutes } from "./routes/timesheets.js";
import { billingRoutes } from "./modules/billing/billing.routes.js";
import { leaveV3Routes } from "./routes/leave-v3.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { auditRoutes } from "./routes/audit.js";
import { settingsRoutes } from "./routes/settings.js";
import { payPeriodsRoutes } from "./routes/pay-periods.js";
import { uploadsRoutes } from "./routes/uploads.js";
import { searchRoutes } from "./routes/search.js";
import { migrationsRoutes } from "./routes/migrations.js";
import { reportsRoutes } from "./routes/reports.js";
import { registerWhatsApp } from "./whatsapp/index.js";
import { taskProjectsRoutes } from "./routes/task-projects.js";
import { tasksRoutes } from "./routes/tasks.js";
import { taskCommentsRoutes } from "./routes/task-comments.js";
import { taskAttachmentsRoutes } from "./routes/task-attachments.js";
import { taskRemindersRoutes } from "./routes/task-reminders.js";
import { academyRoutes } from "./routes/academy/index.js";
import { internalCronRoutes } from "./routes/internal-cron.js";
import { alertsRoutes } from "./modules/alerts/alerts.routes.js";
import { attendanceExceptionsRoutes } from "./modules/attendance-exceptions/exceptions.routes.js";
import { documentsRoutes } from "./modules/documents/documents.routes.js";
import { incidentsRoutes } from "./modules/incidents/incidents.routes.js";
import { approvalsRoutes } from "./modules/approvals/approvals.routes.js";
import { notificationsRoutes } from "./modules/notifications/notifications.routes.js";
import { clientsRoutes, clientPortalRoutes } from "./modules/clients/clients.routes.js";
import { reportsExtendedRoutes } from "./modules/reports-extended/reports-extended.routes.js";
import { corsOriginFromEnv, env } from "./lib/env.js";
import { verifyDatabaseReadiness } from "./lib/db-connectivity.js";

function isValidationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { validation?: unknown; statusCode?: number };
  return e.validation != null || e.statusCode === 400;
}

export async function buildApp(): Promise<FastifyInstance> {
  if (isLocalStorage()) {
    await mkdir(join(uploadsRoot, "logos"), { recursive: true });
    await mkdir(join(uploadsRoot, "tasks"), { recursive: true });
    await mkdir(join(uploadsRoot, "academy"), { recursive: true });
    await mkdir(join(uploadsRoot, "documents"), { recursive: true });
    await mkdir(join(uploadsRoot, "incidents"), { recursive: true });
  }

  const app = Fastify({
    logger: true,
    genReqId: () => randomUUID(),
    requestIdHeader: "x-request-id",
    // Trust Railway's X-Forwarded-* headers when deployed behind its edge proxy.
    trustProxy: env.trustProxy,
  });

  await registerRequestId(app);

  await app.register(cookie);

  await app.register(cors, {
    origin: corsOriginFromEnv(),
    credentials: true,
  });

  await app.register(helmet as never, {
    contentSecurityPolicy: env.isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  await app.register(rateLimit, {
    // Authentication endpoints have their own stricter limits. Keep the
    // application-wide ceiling high enough that staff behind one office NAT do
    // not lock each other out during normal dashboard polling.
    max: 1_000,
    timeWindow: "1 minute",
  });

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  if (isLocalStorage()) {
    await app.register(fastifyStatic, {
      root: join(uploadsRoot, "logos"),
      prefix: "/uploads/logos/",
      allowedPath: (pathName) =>
        /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|gif|webp)$/i.test(
          pathName.replace(/^[\\/]+/, "")
        ),
    });
  }

  app.setErrorHandler((err, request, reply) => {
    const statusCode =
      typeof (err as { statusCode?: number }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;

    if (statusCode >= 500) {
      request.log.error({ err, requestId: request.requestId }, "request failed");
    } else {
      request.log.warn({ err, requestId: request.requestId }, "client error");
    }

    if (isValidationError(err)) {
      const message =
        (err as { message?: string }).message ?? "Validation failed";
      return reply.code(statusCode >= 400 && statusCode < 500 ? statusCode : 400).send({
        error: "Validation error",
        message,
      });
    }

    if (statusCode === 429) {
      return reply.code(429).send({
        error: "Too many requests",
        message: "Rate limit exceeded. Try again later.",
      });
    }

    if (statusCode >= 500 && env.isProduction) {
      return reply.code(500).send({
        error: "Internal server error",
        message: "An unexpected error occurred",
      });
    }

    const message = err instanceof Error ? err.message : "An error occurred";
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : "Request error",
      message,
    });
  });

  const live = async () => ({ status: "ok", service: "plethora-api" });
  app.get("/health", live);
  app.get("/health/live", live);
  app.get("/health/ready", async (_request, reply) => {
    try {
      await verifyDatabaseReadiness();
      return reply.send({ status: "ready", service: "plethora-api" });
    } catch {
      return reply.code(503).send({
        status: "unavailable",
        service: "plethora-api",
      });
    }
  });

  await app.register(registerWhatsApp);
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(usersRoutes, { prefix: "/users" });
  await app.register(accessRequestsRoutes, { prefix: "/access-requests" });
  await app.register(companiesRoutes, { prefix: "/companies" });
  await app.register(employeesRoutes, { prefix: "/employees" });
  await app.register(sitesRoutes, { prefix: "/sites" });
  await app.register(rosteringRoutes, { prefix: "/shifts" });
  await app.register(rostersRoutes, { prefix: "/rosters" });
  await app.register(attendanceRoutes, { prefix: "/attendance" });
  await app.register(staffAttendanceRoutes, { prefix: "/staff-attendance" });
  await app.register(payrollRoutes, { prefix: "/payroll" });
  await app.register(payrollIntelligenceRoutes, { prefix: "/payroll" });
  await app.register(payRulesRoutes, { prefix: "/payroll/pay-rules" });
  await app.register(groupPayRulesRoutes, { prefix: "/payroll" });
  await app.register(groupEarningsRulesRoutes, { prefix: "/payroll" });
  await app.register(groupDeductionRulesRoutes, { prefix: "/payroll" });
  await app.register(payGradesRoutes, { prefix: "/payroll/pay-grades" });
  await app.register(payrollPricingRoutes, { prefix: "/payroll/pricing" });
  await app.register(employeeGroupsRoutes, { prefix: "/employee-groups" });
  await app.register(earningsRulesRoutes, { prefix: "/payroll/earnings-rules" });
  await app.register(deductionRulesRoutes, { prefix: "/payroll/deduction-rules" });
  await app.register(publicHolidaysRoutes, { prefix: "/payroll/public-holidays" });
  await app.register(timesheetsRoutes, { prefix: "/payroll/timesheets" });
  await app.register(billingRoutes, { prefix: "/payroll/billing" });
  await app.register(leaveV3Routes, { prefix: "/leave" });
  await app.register(dashboardRoutes, { prefix: "/dashboard" });
  await app.register(auditRoutes, { prefix: "/audit" });
  await app.register(settingsRoutes, { prefix: "/settings" });
  await app.register(payPeriodsRoutes, { prefix: "/pay-periods" });
  await app.register(uploadsRoutes, { prefix: "/uploads" });
  await app.register(searchRoutes, { prefix: "/search" });
  await app.register(migrationsRoutes, { prefix: "/migrations" });
  await app.register(reportsRoutes, { prefix: "/reports" });
  await app.register(reportsExtendedRoutes, { prefix: "/reports/extended" });
  await app.register(taskProjectsRoutes, { prefix: "/task-projects" });
  await app.register(tasksRoutes, { prefix: "/tasks" });
  await app.register(taskCommentsRoutes, { prefix: "/task-comments" });
  await app.register(taskAttachmentsRoutes, { prefix: "/task-attachments" });
  await app.register(taskRemindersRoutes, { prefix: "/task-reminders" });
  await app.register(alertsRoutes, { prefix: "/alerts" });
  await app.register(attendanceExceptionsRoutes, { prefix: "/attendance-exceptions" });
  await app.register(documentsRoutes, { prefix: "/documents" });
  await app.register(incidentsRoutes, { prefix: "/incidents" });
  await app.register(approvalsRoutes, { prefix: "/approvals" });
  await app.register(notificationsRoutes, { prefix: "/notifications" });
  await app.register(clientsRoutes, { prefix: "/clients" });
  await app.register(clientPortalRoutes, { prefix: "/client-portal" });
  await app.register(academyRoutes, { prefix: "/academy" });
  await app.register(internalCronRoutes, { prefix: "/internal" });

  return app;
}
