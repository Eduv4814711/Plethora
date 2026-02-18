import { config } from "dotenv";
import { join } from "path";
import { mkdir } from "fs/promises";

config();

await mkdir(join(process.cwd(), "uploads", "logos"), { recursive: true });

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
import { dashboardRoutes } from "./routes/dashboard.js";
import { auditRoutes } from "./routes/audit.js";
import { settingsRoutes } from "./routes/settings.js";
import { uploadsRoutes } from "./routes/uploads.js";
import { searchRoutes } from "./routes/search.js";

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
  limits: { fileSize: 2 * 1024 * 1024 },
});

await app.register(fastifyStatic, {
  root: join(process.cwd(), "uploads"),
  prefix: "/uploads/",
});

app.get("/health", async () => ({ status: "ok" }));

app.register(authRoutes, { prefix: "/auth" });
app.register(usersRoutes, { prefix: "/users" });
app.register(companiesRoutes, { prefix: "/companies" });
app.register(employeesRoutes, { prefix: "/employees" });
app.register(sitesRoutes, { prefix: "/sites" });
app.register(shiftsRoutes, { prefix: "/shifts" });
app.register(attendanceRoutes, { prefix: "/attendance" });
app.register(payrollRoutes, { prefix: "/payroll" });
app.register(dashboardRoutes, { prefix: "/dashboard" });
app.register(auditRoutes, { prefix: "/audit" });
app.register(settingsRoutes, { prefix: "/settings" });
app.register(uploadsRoutes, { prefix: "/uploads" });
app.register(searchRoutes, { prefix: "/search" });

const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  console.log(`Plethora API running at http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
