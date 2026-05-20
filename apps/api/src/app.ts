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
import { uploadsRoot } from "./lib/uploads-root.js";
import { registerRequestId } from "./lib/request-id.js";
import { authRoutes } from "./routes/auth.js";
import { usersRoutes } from "./routes/users.js";
import { companiesRoutes } from "./routes/companies.js";
import { employeesRoutes } from "./routes/employees.js";
import { sitesRoutes } from "./routes/sites.js";
import { shiftsRoutes } from "./routes/shifts.js";
import { attendanceRoutes } from "./routes/attendance.js";
import { payrollRoutes } from "./routes/payroll.js";
import { payrollIntelligenceRoutes } from "./routes/payroll-intelligence.js";
import { payRulesRoutes } from "./routes/pay-rules.js";
import { groupPayRulesRoutes } from "./routes/group-pay-rules.js";
import { groupEarningsRulesRoutes } from "./routes/group-earnings-rules.js";
import { groupDeductionRulesRoutes } from "./routes/group-deduction-rules.js";
import { payGradesRoutes } from "./routes/pay-grades.js";
import { employeeGroupsRoutes } from "./routes/employee-groups.js";
import { earningsRulesRoutes } from "./routes/earnings-rules.js";
import { deductionRulesRoutes } from "./routes/deduction-rules.js";
import { publicHolidaysRoutes } from "./routes/public-holidays.js";
import { timesheetsRoutes } from "./routes/timesheets.js";
import { leaveRecordsRoutes } from "./routes/leave-records.js";
import { leaveRequestsRoutes } from "./routes/leave-requests.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { auditRoutes } from "./routes/audit.js";
import { settingsRoutes } from "./routes/settings.js";
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

const MIN_PROD_JWT_LEN = 32;
const isProduction = process.env.NODE_ENV === "production";

/** Values that must never ship in production (dev defaults + .env.example placeholders). */
const FORBIDDEN_JWT_SECRETS = new Set([
  "",
  "dev-secret-change-in-production",
  "dev-refresh-secret",
  "change-this-in-production",
  "change-this-refresh-in-production",
]);

function assertProductionJwt(): void {
  if (!isProduction) return;
  const jwt = process.env.JWT_SECRET?.trim() ?? "";
  const refresh = process.env.JWT_REFRESH_SECRET?.trim() ?? "";
  const weakJwt =
    FORBIDDEN_JWT_SECRETS.has(jwt) || jwt.length < MIN_PROD_JWT_LEN;
  const weakRefresh =
    FORBIDDEN_JWT_SECRETS.has(refresh) || refresh.length < MIN_PROD_JWT_LEN;
  const same = jwt.length > 0 && jwt === refresh;
  if (weakJwt || weakRefresh || same) {
    throw new Error(
      "Invalid production JWT configuration. On Railway: open the API service → Variables and set JWT_SECRET and JWT_REFRESH_SECRET to two different random strings (at least " +
        MIN_PROD_JWT_LEN +
        " characters each). Do not use dev defaults, .env.example placeholders, or the same value for both. " +
        `Details: weakJwt=${weakJwt}, weakRefresh=${weakRefresh}, sameValue=${same}.`
    );
  }
}

function assertProductionCors(): void {
  if (!isProduction) return;
  const raw = process.env.CORS_ORIGIN?.trim() ?? "";
  if (!raw) {
    throw new Error(
      "CORS_ORIGIN is required in production. Set it to your web app origin(s), comma-separated (e.g. https://app.example.com)."
    );
  }
}

function corsOriginFromEnv(): boolean | string | string[] {
  if (!isProduction) {
    const raw = process.env.CORS_ORIGIN;
    if (raw == null || raw.trim() === "") return true;
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return true;
    if (parts.length === 1) return parts[0]!;
    return parts;
  }

  const parts = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 1) return parts[0]!;
  return parts;
}

function isValidationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { validation?: unknown; statusCode?: number };
  return e.validation != null || e.statusCode === 400;
}

export async function buildApp(): Promise<FastifyInstance> {
  assertProductionJwt();
  assertProductionCors();

  await mkdir(join(uploadsRoot, "logos"), { recursive: true });
  await mkdir(join(uploadsRoot, "tasks"), { recursive: true });
  await mkdir(join(uploadsRoot, "academy"), { recursive: true });

  const app = Fastify({
    logger: true,
    genReqId: () => randomUUID(),
    requestIdHeader: "x-request-id",
  });

  await registerRequestId(app);

  await app.register(cors, {
    origin: corsOriginFromEnv(),
    credentials: true,
  });

  await app.register(helmet as never, {
    contentSecurityPolicy: isProduction
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
    max: 100,
    timeWindow: "1 minute",
  });

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  await app.register(fastifyStatic, {
    root: uploadsRoot,
    prefix: "/uploads/",
  });

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

    if (statusCode >= 500 && isProduction) {
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

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(registerWhatsApp);
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(usersRoutes, { prefix: "/users" });
  await app.register(companiesRoutes, { prefix: "/companies" });
  await app.register(employeesRoutes, { prefix: "/employees" });
  await app.register(sitesRoutes, { prefix: "/sites" });
  await app.register(shiftsRoutes, { prefix: "/shifts" });
  await app.register(attendanceRoutes, { prefix: "/attendance" });
  await app.register(payrollRoutes, { prefix: "/payroll" });
  await app.register(payrollIntelligenceRoutes, { prefix: "/payroll" });
  await app.register(payRulesRoutes, { prefix: "/payroll/pay-rules" });
  await app.register(groupPayRulesRoutes, { prefix: "/payroll" });
  await app.register(groupEarningsRulesRoutes, { prefix: "/payroll" });
  await app.register(groupDeductionRulesRoutes, { prefix: "/payroll" });
  await app.register(payGradesRoutes, { prefix: "/payroll/pay-grades" });
  await app.register(employeeGroupsRoutes, { prefix: "/employee-groups" });
  await app.register(earningsRulesRoutes, { prefix: "/payroll/earnings-rules" });
  await app.register(deductionRulesRoutes, { prefix: "/payroll/deduction-rules" });
  await app.register(publicHolidaysRoutes, { prefix: "/payroll/public-holidays" });
  await app.register(timesheetsRoutes, { prefix: "/payroll/timesheets" });
  await app.register(leaveRecordsRoutes, { prefix: "/payroll/leave-records" });
  await app.register(leaveRequestsRoutes, { prefix: "/payroll/leave-requests" });
  await app.register(dashboardRoutes, { prefix: "/dashboard" });
  await app.register(auditRoutes, { prefix: "/audit" });
  await app.register(settingsRoutes, { prefix: "/settings" });
  await app.register(uploadsRoutes, { prefix: "/uploads" });
  await app.register(searchRoutes, { prefix: "/search" });
  await app.register(migrationsRoutes, { prefix: "/migrations" });
  await app.register(reportsRoutes, { prefix: "/reports" });
  await app.register(taskProjectsRoutes, { prefix: "/task-projects" });
  await app.register(tasksRoutes, { prefix: "/tasks" });
  await app.register(taskCommentsRoutes, { prefix: "/task-comments" });
  await app.register(taskAttachmentsRoutes, { prefix: "/task-attachments" });
  await app.register(taskRemindersRoutes, { prefix: "/task-reminders" });
  await app.register(academyRoutes, { prefix: "/academy" });

  return app;
}
