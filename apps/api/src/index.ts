import { config } from "dotenv";
import { join } from "path";
import { mkdir } from "fs/promises";

config();

await mkdir(join(process.cwd(), "uploads", "logos"), { recursive: true });
await mkdir(join(process.cwd(), "uploads", "tasks"), { recursive: true });

import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { authRoutes } from "./routes/auth.js";
import { usersRoutes } from "./routes/users.js";
import { companiesRoutes } from "./routes/companies.js";
import { employeesRoutes } from "./routes/employees.js";
import { sitesRoutes } from "./routes/sites.js";
import { shiftsRoutes } from "./routes/shifts.js";
import { attendanceRoutes } from "./routes/attendance.js";
import { payrollRoutes } from "./routes/payroll.js";
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
import { whatsappWebhookRoutes } from "./routes/whatsapp-webhook.js";
import { taskProjectsRoutes } from "./routes/task-projects.js";
import { tasksRoutes } from "./routes/tasks.js";
import { taskCommentsRoutes } from "./routes/task-comments.js";
import { taskAttachmentsRoutes } from "./routes/task-attachments.js";
import { taskRemindersRoutes } from "./routes/task-reminders.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? true,
  credentials: true,
});

await app.register(helmet as never, {
  contentSecurityPolicy: false,
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

await app.register(multipart, {
  limits: { fileSize: 10 * 1024 * 1024 },
});

await app.register(fastifyStatic, {
  root: join(process.cwd(), "uploads"),
  prefix: "/uploads/",
});

app.get("/health", async () => ({ status: "ok" }));

app.register(whatsappWebhookRoutes);
app.register(authRoutes, { prefix: "/auth" });
app.register(usersRoutes, { prefix: "/users" });
app.register(companiesRoutes, { prefix: "/companies" });
app.register(employeesRoutes, { prefix: "/employees" });
app.register(sitesRoutes, { prefix: "/sites" });
app.register(shiftsRoutes, { prefix: "/shifts" });
app.register(attendanceRoutes, { prefix: "/attendance" });
app.register(payrollRoutes, { prefix: "/payroll" });
app.register(payRulesRoutes, { prefix: "/payroll/pay-rules" });
app.register(groupPayRulesRoutes, { prefix: "/payroll" });
app.register(groupEarningsRulesRoutes, { prefix: "/payroll" });
app.register(groupDeductionRulesRoutes, { prefix: "/payroll" });
app.register(payGradesRoutes, { prefix: "/payroll/pay-grades" });
app.register(employeeGroupsRoutes, { prefix: "/employee-groups" });
app.register(earningsRulesRoutes, { prefix: "/payroll/earnings-rules" });
app.register(deductionRulesRoutes, { prefix: "/payroll/deduction-rules" });
app.register(publicHolidaysRoutes, { prefix: "/payroll/public-holidays" });
app.register(timesheetsRoutes, { prefix: "/payroll/timesheets" });
app.register(leaveRecordsRoutes, { prefix: "/payroll/leave-records" });
app.register(leaveRequestsRoutes, { prefix: "/payroll/leave-requests" });
app.register(dashboardRoutes, { prefix: "/dashboard" });
app.register(auditRoutes, { prefix: "/audit" });
app.register(settingsRoutes, { prefix: "/settings" });
app.register(uploadsRoutes, { prefix: "/uploads" });
app.register(searchRoutes, { prefix: "/search" });
app.register(migrationsRoutes, { prefix: "/migrations" });
app.register(reportsRoutes, { prefix: "/reports" });
app.register(taskProjectsRoutes, { prefix: "/task-projects" });
app.register(tasksRoutes, { prefix: "/tasks" });
app.register(taskCommentsRoutes, { prefix: "/task-comments" });
app.register(taskAttachmentsRoutes, { prefix: "/task-attachments" });
app.register(taskRemindersRoutes, { prefix: "/task-reminders" });

const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  console.log(`Plethora API running at http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
