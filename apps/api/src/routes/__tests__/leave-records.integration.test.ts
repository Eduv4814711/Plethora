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
import { ensureDefaultLeavePolicy } from "../../services/leave-management.service.js";

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
        capabilities: {
          "/employees/leave": ["view", "create", "edit", "delete", "approve", "export"],
          "/payroll": ["view", "create", "edit", "delete", "approve", "export"],
        },
      },
    });
    await prisma.company.update({ where: { id: companyId }, data: { ownerUserId: user.id } });

    accessToken = jwt.sign(
      { sub: user.id, email: user.email, companyId },
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
    const site = await prisma.site.create({
      data: { companyId, name: `Leave Test Site ${runId}` },
    });
    await ensureDefaultLeavePolicy(companyId, user.id);
    await prisma.leaveTypeDefinition.updateMany({
      where: { companyId, code: "sick" },
      data: { requiresDocument: true },
    });
    await prisma.leavePolicyVersion.updateMany({
      where: { companyId, leaveType: { requiresBalance: true } },
      data: {
        reviewStatus: "ACTIVE",
        confirmedBy: user.id,
        confirmedAt: new Date(),
        negativeBalanceAllowed: true,
        accrualMethod: "EVEN_MONTHLY",
        entitlementMinutes: 120 * 60,
      },
    });
    await prisma.leavePolicyVersion.updateMany({
      where: { companyId, leaveType: { requiresBalance: false } },
      data: {
        reviewStatus: "ACTIVE",
        confirmedBy: user.id,
        confirmedAt: new Date(),
        accrualMethod: "NONE",
      },
    });
    const shifts = [];
    for (let day = new Date("2026-08-01T06:00:00.000Z"); day <= new Date("2026-11-30T06:00:00.000Z"); day = new Date(day.getTime() + 86_400_000)) {
      shifts.push({ companyId, employeeId, siteId: site.id, startTime: new Date(day), endTime: new Date(day.getTime() + 12 * 60 * 60 * 1000), shiftType: "day", status: "assigned" as const });
    }
    await prisma.shift.createMany({ data: shifts });
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

  it("POST rejects a range that overlaps an existing leave day", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payroll/leave-records",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: {
        employeeId,
        date: "2026-08-03",
        endDate: "2026-08-05",
        type: "sick",
        hours: 8,
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "LEAVE_OVERLAP",
      message: expect.stringContaining("overlaps existing active leave"),
    });
    const newlyStored = await prisma.leaveRecord.count({
      where: {
        employeeId,
        date: { gte: normalizeLeaveDate("2026-08-04"), lte: normalizeLeaveDate("2026-08-05") },
      },
    });
    expect(newlyStored).toBe(0);
  });

  it("POST returns a validation error for an impossible date", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payroll/leave-records",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: {
        employeeId,
        date: "2026-02-30",
        type: "annual",
        hours: 8,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "Validation error" });
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

  it("rolls back direct capture when the approval decision fails", async () => {
    const leaveDate = "2026-11-20";
    const res = await app.inject({
      method: "POST",
      url: "/payroll/leave-records",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: {
        employeeId,
        date: leaveDate,
        type: "sick",
        hours: 8,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "LEAVE_VALIDATION",
      message: expect.stringContaining("verified supporting document"),
    });
    const date = normalizeLeaveDate(leaveDate);
    expect(await prisma.leaveApplication.count({
      where: { companyId, employeeId, startDate: date, endDate: date },
    })).toBe(0);
    expect(await prisma.leaveLedgerEntry.count({
      where: { companyId, employeeId, effectiveDate: date },
    })).toBe(0);
    expect(await prisma.leaveRecord.count({
      where: { employeeId, date, type: "sick" },
    })).toBe(0);
  });

  it("rolls back legacy approval when the v2 decision fails", async () => {
    const leaveDate = "2026-11-21";
    const request = await prisma.leaveRequest.create({
      data: {
        employeeId,
        date: normalizeLeaveDate(leaveDate),
        type: "sick",
        hours: 8,
        reason: "Medical leave",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/payroll/leave-requests/${request.id}/approve`,
      headers: authHeader(accessToken),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "Approval failed",
      message: expect.stringContaining("verified supporting document"),
    });
    expect(await prisma.leaveRequest.findUnique({ where: { id: request.id } })).toMatchObject({
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
    });
    expect(await prisma.leaveApplication.count({
      where: { companyId, legacyLeaveRequestId: request.id },
    })).toBe(0);
    expect(await prisma.leaveLedgerEntry.count({
      where: { companyId, employeeId, effectiveDate: normalizeLeaveDate(leaveDate) },
    })).toBe(0);
    expect(await prisma.leaveRecord.count({
      where: { employeeId, date: normalizeLeaveDate(leaveDate), type: "sick" },
    })).toBe(0);
  });

  it("commits legacy rejection and its linked v2 application together", async () => {
    const leaveDate = "2026-11-22";
    const request = await prisma.leaveRequest.create({
      data: {
        employeeId,
        date: normalizeLeaveDate(leaveDate),
        type: "unpaid",
        hours: 8,
        reason: "Personal leave",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/payroll/leave-requests/${request.id}/reject`,
      headers: authHeader(accessToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: request.id, status: "rejected" });
    const application = await prisma.leaveApplication.findFirstOrThrow({
      where: { companyId, legacyLeaveRequestId: request.id },
    });
    expect(application.status).toBe("REJECTED");
    const ledger = await prisma.leaveLedgerEntry.findMany({
      where: { applicationId: application.id },
      orderBy: { createdAt: "asc" },
    });
    expect(ledger).toEqual([]);
    expect(await prisma.leaveRecord.count({
      where: { employeeId, date: normalizeLeaveDate(leaveDate) },
    })).toBe(0);
  });
});
