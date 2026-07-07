import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import {
  authHeader,
  isIntegrationDatabaseAvailable,
} from "../../test-utils/tenant-harness.js";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../../lib/config.js";
import { hashPassword } from "../../services/auth.service.js";
import { normalizeLeaveDate } from "../../services/leave-availability.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("leave records API (integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let accessToken: string;
  let employeeId: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();

    const company = await prisma.company.create({
      data: { name: `Leave Test Co ${runId}` },
    });
    companyId = company.id;

    const user = await prisma.user.create({
      data: {
        companyId,
        name: "Leave Admin",
        email: `leave-admin-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("leave-test-password-32chars!!"),
        role: "admin",
      },
    });

    accessToken = jwt.sign(
      { sub: user.id, email: user.email, companyId, role: user.role },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );

    const employee = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `LV-${runId}`,
        firstName: "Leave",
        lastName: "Tester",
        status: "active",
        employeeType: "security",
      },
    });
    employeeId = employee.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
    await app.close();
  });

  it("POST creates a multi-day leave range", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payroll/leave-records",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: {
        employeeId,
        date: "2026-08-01",
        endDate: "2026-08-03",
        type: "annual",
        hours: 8,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: unknown[]; days: number };
    expect(body.days).toBe(3);
    expect(body.data).toHaveLength(3);

    const stored = await prisma.leaveRecord.findMany({
      where: { employeeId, date: { gte: normalizeLeaveDate("2026-08-01"), lte: normalizeLeaveDate("2026-08-03") } },
      orderBy: { date: "asc" },
    });
    expect(stored).toHaveLength(3);
    expect(stored.every((r) => r.type === "annual")).toBe(true);
  });

  it("DELETE /range removes a single-day leave record (UTC date match)", async () => {
    await prisma.leaveRecord.create({
      data: {
        employeeId,
        date: normalizeLeaveDate("2026-08-10"),
        type: "annual",
        hours: 8,
      },
    });

    const res = await app.inject({
      method: "DELETE",
      url: "/payroll/leave-records/range",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: {
        employeeId,
        type: "annual",
        startDate: "2026-08-10",
        endDate: "2026-08-10",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 1 });

    const remaining = await prisma.leaveRecord.count({
      where: { employeeId, date: normalizeLeaveDate("2026-08-10") },
    });
    expect(remaining).toBe(0);
  });

  it("DELETE /range removes full multi-day range including last day", async () => {
    for (const day of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
      await prisma.leaveRecord.create({
        data: {
          employeeId,
          date: normalizeLeaveDate(day),
          type: "sick",
          hours: 8,
        },
      });
    }

    const res = await app.inject({
      method: "DELETE",
      url: "/payroll/leave-records/range",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: {
        employeeId,
        type: "sick",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 3 });

    const remaining = await prisma.leaveRecord.count({
      where: {
        employeeId,
        type: "sick",
        date: { gte: normalizeLeaveDate("2026-09-01"), lte: normalizeLeaveDate("2026-09-03") },
      },
    });
    expect(remaining).toBe(0);
  });

  it("PUT /range replaces leave type and dates", async () => {
    for (const day of ["2026-10-01", "2026-10-02"]) {
      await prisma.leaveRecord.create({
        data: {
          employeeId,
          date: normalizeLeaveDate(day),
          type: "annual",
          hours: 8,
        },
      });
    }

    const res = await app.inject({
      method: "PUT",
      url: "/payroll/leave-records/range",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: {
        employeeId,
        type: "annual",
        startDate: "2026-10-01",
        endDate: "2026-10-02",
        newStartDate: "2026-10-05",
        newEndDate: "2026-10-06",
        newType: "unpaid",
        hours: 4,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { days: number };
    expect(body.days).toBe(2);

    const oldCount = await prisma.leaveRecord.count({
      where: {
        employeeId,
        type: "annual",
        date: { gte: normalizeLeaveDate("2026-10-01"), lte: normalizeLeaveDate("2026-10-02") },
      },
    });
    expect(oldCount).toBe(0);

    const newRecords = await prisma.leaveRecord.findMany({
      where: {
        employeeId,
        type: "unpaid",
        date: { gte: normalizeLeaveDate("2026-10-05"), lte: normalizeLeaveDate("2026-10-06") },
      },
    });
    expect(newRecords).toHaveLength(2);
    expect(newRecords.every((r) => Number(r.hours) === 4)).toBe(true);
  });

  it("GET lists leave records filtered by date range", async () => {
    await prisma.leaveRecord.create({
      data: {
        employeeId,
        date: normalizeLeaveDate("2026-11-15"),
        type: "annual",
        hours: 8,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/payroll/leave-records?employeeId=${employeeId}&start=2026-11-01&end=2026-11-30`,
      headers: authHeader(accessToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { date: string }[] };
    expect(body.data.some((r) => r.date.startsWith("2026-11-15"))).toBe(true);
  });
});
