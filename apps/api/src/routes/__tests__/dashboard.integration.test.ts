import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { config } from "../../lib/config.js";
import { hashPassword } from "../../services/auth.service.js";
import { authHeader, isIntegrationDatabaseAvailable } from "../../test-utils/tenant-harness.js";
import { detectAndPersistExceptions } from "../../modules/attendance-exceptions/exceptions.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("dashboard attention alerts (PostgreSQL integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let accessToken: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({ data: { name: `Dashboard Test Co ${runId}` } });
    companyId = company.id;
    const user = await prisma.user.create({
      data: {
        companyId,
        name: "Dashboard Admin",
        email: `dashboard-admin-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("dashboard-test-password-32chars!!"),
      },
    });
    await prisma.company.update({ where: { id: companyId }, data: { ownerUserId: user.id } });
    accessToken = jwt.sign({ sub: user.id, email: user.email, companyId }, config.jwt.accessSecret, { expiresIn: "1h" });
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
    await app.close();
  });

  it("does not surface a stale historical unattended shift as a needs-attention alert", async () => {
    const employee = await prisma.employee.create({
      data: { companyId, employeeNumber: `DASH-OLD-${runId}`, firstName: "Old", lastName: "Shift", status: "active", employeeType: "security", hourlyRate: 100 },
    });
    const site = await prisma.site.create({ data: { companyId, name: `Dash Old Site ${runId}` } });
    await prisma.shift.create({
      data: {
        companyId,
        employeeId: employee.id,
        siteId: site.id,
        startTime: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        endTime: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000),
        shiftType: "day",
        status: "assigned",
      },
    });

    const response = await app.inject({ method: "GET", url: "/dashboard", headers: authHeader(accessToken) });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.alerts.some((alert: { type: string }) => alert.type === "attendance_exceptions")).toBe(false);
    expect(body.payrollReadiness?.openExceptions ?? 0).toBe(0);
  });

  it("surfaces open attendance exceptions from the current pay period as a needs-attention alert, even after an earlier dashboard read cached a zero-count readiness row", async () => {
    const employee = await prisma.employee.create({
      data: { companyId, employeeNumber: `DASH-CUR-${runId}`, firstName: "Current", lastName: "Shift", status: "active", employeeType: "security", hourlyRate: 100 },
    });
    const site = await prisma.site.create({ data: { companyId, name: `Dash Current Site ${runId}` } });
    await prisma.shift.create({
      data: {
        companyId,
        employeeId: employee.id,
        siteId: site.id,
        startTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        endTime: new Date(Date.now() - 1 * 60 * 60 * 1000),
        shiftType: "day",
        status: "assigned",
      },
    });
    const scan = await detectAndPersistExceptions({ companyId, lookbackHours: 24 });
    expect(scan.created).toBeGreaterThan(0);

    const response = await app.inject({ method: "GET", url: "/dashboard", headers: authHeader(accessToken) });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const alert = body.alerts.find((a: { type: string }) => a.type === "attendance_exceptions");
    expect(alert).toBeDefined();
    expect(alert.count).toBeGreaterThan(0);
    expect(body.payrollReadiness?.openExceptions).toBeGreaterThan(0);
  });
});
