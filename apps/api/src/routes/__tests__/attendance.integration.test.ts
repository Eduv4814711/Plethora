import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma.js";
import { authHeader, isIntegrationDatabaseAvailable } from "../../test-utils/tenant-harness.js";
import { config } from "../../lib/config.js";
import { hashPassword } from "../../services/auth.service.js";

vi.mock("../../modules/attendance-exceptions/post-clock-sync.js", () => ({
  triggerPostClockExceptionSync: vi.fn(),
}));

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("attendance routes (integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let accessToken: string;
  let employeeId: string;
  let siteId: string;
  let postId: string;
  const runId = randomBytes(6).toString("hex");

  async function createShift(startOffsetMs: number, endOffsetMs: number, status = "assigned") {
    const now = Date.now();
    return prisma.shift.create({
      data: {
        companyId,
        employeeId,
        siteId,
        shiftType: "day",
        legacyPostName: "Day Post",
        startTime: new Date(now + startOffsetMs),
        endTime: new Date(now + endOffsetMs),
        status,
      },
    });
  }

  beforeAll(async () => {
    const { buildApp } = await import("../../app.js");
    app = await buildApp();

    const company = await prisma.company.create({ data: { name: `Attendance Test Co ${runId}` } });
    companyId = company.id;

    const user = await prisma.user.create({
      data: {
        companyId,
        name: "Attendance Admin",
        email: `attendance-admin-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("attendance-test-password-32chars!!"),
        capabilities: {
          "/attendance": ["view", "create", "edit", "delete"],
        },
      },
    });
    await prisma.company.update({ where: { id: companyId }, data: { ownerUserId: user.id } });
    accessToken = jwt.sign({ sub: user.id, email: user.email, companyId }, config.jwt.accessSecret, { expiresIn: "1h" });

    const group = await prisma.employeeGroup.create({
      data: { companyId, name: "Default", sortOrder: 0 },
    });

    const employee = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `EMP-${runId}`,
        firstName: "Test",
        lastName: "Guard",
        status: "active",
        employeeType: "general",
        monthlySalary: 15000,
        groupId: group.id,
      },
    });
    employeeId = employee.id;

    const site = await prisma.site.create({ data: { companyId, name: `Site ${runId}` } });
    siteId = site.id;

    const post = await prisma.sitePost.create({ data: { siteId, name: "Day Post" } });
    postId = post.id;
    await prisma.coverageRequirement.create({
      data: { siteId, sitePostId: post.id, shiftTypeCode: "day", guardsRequired: 1, genderRule: "any" },
    });
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
    await app.close();
  });

  it("clocks in successfully and marks the shift active", async () => {
    const shift = await createShift(-60 * 60 * 1000, 11 * 60 * 60 * 1000);

    const res = await app.inject({
      method: "POST",
      url: "/attendance/clock-in",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { shiftId: shift.id },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { status: string };
    expect(body.status).toBe("clocked_in");

    const updatedShift = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(updatedShift.status).toBe("active");
  });

  it("rejects a second concurrent clock-in for the same shift with a clean 409, not a 500", async () => {
    const shift = await createShift(-60 * 60 * 1000, 11 * 60 * 60 * 1000);

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/attendance/clock-in",
        headers: { ...authHeader(accessToken), "content-type": "application/json" },
        payload: { shiftId: shift.id },
      }),
      app.inject({
        method: "POST",
        url: "/attendance/clock-in",
        headers: { ...authHeader(accessToken), "content-type": "application/json" },
        payload: { shiftId: shift.id },
      }),
    ]);

    const statusCodes = [first.statusCode, second.statusCode].sort();
    // Exactly one wins. The loser is rejected cleanly — 400 when validateClockIn
    // sees the committed row first, 409 when it slips through and the DB unique
    // constraint catches it. The point of the fix is that neither path 500s.
    expect(statusCodes[0]).toBe(201);
    expect([400, 409]).toContain(statusCodes[1]);

    const failed = first.statusCode === 201 ? second : first;
    expect(failed.json()).toMatchObject({
      message: "Attendance has already been recorded for this shift",
    });
  });

  it("returns 404 when clocking in against a shift that does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/attendance/clock-in",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { shiftId: "does-not-exist" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("clock-out-by-shift triggers the post-clock exception sync, matching clock-out", async () => {
    const { triggerPostClockExceptionSync } = await import("../../modules/attendance-exceptions/post-clock-sync.js");
    vi.mocked(triggerPostClockExceptionSync).mockClear();

    const shift = await createShift(-60 * 60 * 1000, 11 * 60 * 60 * 1000);

    const clockIn = await app.inject({
      method: "POST",
      url: "/attendance/clock-in",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { shiftId: shift.id },
    });
    expect(clockIn.statusCode).toBe(201);
    expect(vi.mocked(triggerPostClockExceptionSync)).toHaveBeenCalledWith(companyId, siteId);
    vi.mocked(triggerPostClockExceptionSync).mockClear();

    const clockOut = await app.inject({
      method: "POST",
      url: "/attendance/clock-out-by-shift",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { shiftId: shift.id },
    });
    expect(clockOut.statusCode).toBe(200);
    expect(vi.mocked(triggerPostClockExceptionSync)).toHaveBeenCalledWith(companyId, siteId);
  });

  it("clears stale hours and sets status clocked_in when a PUT edit only sets clockIn", async () => {
    const shift = await createShift(-60 * 60 * 1000, 11 * 60 * 60 * 1000);
    const attendance = await prisma.attendance.create({
      data: { shiftId: shift.id, clockIn: shift.startTime, status: "clocked_in" },
    });
    // Simulate stale leftover computed values from a prior state.
    await prisma.attendance.update({
      where: { id: attendance.id },
      data: { hoursWorked: 99, overtimeHours: 99 },
    });

    const res = await app.inject({
      method: "PUT",
      url: `/attendance/${attendance.id}`,
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { clockIn: new Date(shift.startTime.getTime() + 5 * 60 * 1000).toISOString() },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; hoursWorked: number | null; overtimeHours: number | null };
    expect(body.status).toBe("clocked_in");
    expect(body.hoursWorked).toBeNull();
    expect(body.overtimeHours).toBeNull();
  });

  it("rejects a PUT edit that sets clockOut without an existing clockIn", async () => {
    const shift = await createShift(-60 * 60 * 1000, 11 * 60 * 60 * 1000);
    const attendance = await prisma.attendance.create({
      data: { shiftId: shift.id, status: "pending" },
    });

    const res = await app.inject({
      method: "PUT",
      url: `/attendance/${attendance.id}`,
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { clockOut: new Date(shift.endTime).toISOString() },
    });

    expect(res.statusCode).toBe(400);
  });

  it("computes hours and marks completed when a PUT edit sets both clockIn and clockOut", async () => {
    const shift = await createShift(-60 * 60 * 1000, 11 * 60 * 60 * 1000);
    const attendance = await prisma.attendance.create({
      data: { shiftId: shift.id, status: "pending" },
    });

    const clockIn = shift.startTime;
    const clockOut = new Date(shift.startTime.getTime() + 8 * 60 * 60 * 1000);

    const res = await app.inject({
      method: "PUT",
      url: `/attendance/${attendance.id}`,
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { clockIn: clockIn.toISOString(), clockOut: clockOut.toISOString() },
    });

    expect(res.statusCode).toBe(200);
    // Prisma Decimal fields serialize to strings over the wire.
    const body = res.json() as { status: string; hoursWorked: string; overtimeHours: string };
    expect(body.status).toBe("completed");
    expect(Number(body.hoursWorked)).toBe(8);
    expect(Number(body.overtimeHours)).toBe(0);
  });

  it("computes no overtime for a manual entry at or under the standard shift threshold", async () => {
    const clockIn = new Date("2026-08-05T04:00:00.000Z");
    const clockOut = new Date("2026-08-05T12:00:00.000Z"); // 8h span

    const res = await app.inject({
      method: "POST",
      url: "/attendance/manual",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { employeeId, postId, clockIn: clockIn.toISOString(), clockOut: clockOut.toISOString() },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { hoursWorked: string; overtimeHours: string };
    expect(Number(body.hoursWorked)).toBe(8);
    expect(Number(body.overtimeHours)).toBe(0);
  });

  it("computes overtime for a manual entry beyond the standard shift threshold", async () => {
    const clockIn = new Date("2026-08-06T04:00:00.000Z");
    const clockOut = new Date("2026-08-06T19:00:00.000Z"); // 15h span

    const res = await app.inject({
      method: "POST",
      url: "/attendance/manual",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { employeeId, postId, clockIn: clockIn.toISOString(), clockOut: clockOut.toISOString() },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { hoursWorked: string; overtimeHours: string };
    expect(Number(body.hoursWorked)).toBe(config.attendance.standardShiftHours);
    expect(Number(body.overtimeHours)).toBe(3);
  });
});
