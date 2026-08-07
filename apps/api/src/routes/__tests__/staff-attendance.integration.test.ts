import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { buildApp } from "../../app.js";
import { config } from "../../lib/config.js";
import { prisma } from "../../lib/prisma.js";
import {
  authHeader,
  isIntegrationDatabaseAvailable,
  provisionTenantFixture,
  type TenantFixture,
} from "../../test-utils/tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

const DATE = "2026-08-03";

describe.runIf(dbReady)("office staff attendance (integration)", () => {
  let app: FastifyInstance;
  let fixture: TenantFixture;
  let officeEmployeeId: string;
  let editorToken: string;
  let viewerToken: string;

  async function tokenFor(companyId: string, capabilities: Record<string, string[]>) {
    const user = await prisma.user.create({
      data: {
        companyId,
        name: `Staff Attendance User ${Math.random()}`,
        email: `staff-attendance-${Math.random()}@test.local`,
        passwordHash: "not-used-in-route-tests",
        capabilities,
      },
    });
    return jwt.sign(
      { sub: user.id, email: user.email, companyId },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );
  }

  beforeAll(async () => {
    app = await buildApp();
    fixture = await provisionTenantFixture();

    const officeEmployee = await prisma.employee.create({
      data: {
        companyId: fixture.tenantA.companyId,
        firstName: "Ayanda",
        lastName: "Bell",
        status: "active",
        employeeType: "general",
        jobRole: "HR Manager",
        monthlySalary: 25000,
      },
    });
    officeEmployeeId = officeEmployee.id;

    editorToken = await tokenFor(fixture.tenantA.companyId, {
      "/attendance": ["view", "edit"],
    });
    viewerToken = await tokenFor(fixture.tenantA.companyId, { "/attendance": ["view"] });
  }, 120_000);

  afterAll(async () => {
    await prisma.staffAttendanceDay
      .deleteMany({ where: { companyId: fixture?.tenantA.companyId } })
      .catch(() => undefined);
    await fixture?.teardown();
    await app?.close();
  }, 30_000);

  it("lists office staff for a day and excludes security officers", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/staff-attendance/day?date=${DATE}`,
      headers: authHeader(editorToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.rows.map((row: { employeeId: string }) => row.employeeId);
    expect(ids).toContain(officeEmployeeId);
    // The fixture's guard is a security_officer and belongs on the site timesheet.
    expect(ids).not.toContain(fixture.tenantA.employeeId);
  });

  it("captures and then updates a day for one person", async () => {
    const first = await app.inject({
      method: "PUT",
      url: "/staff-attendance/day",
      headers: authHeader(editorToken),
      payload: {
        date: DATE,
        employeeId: officeEmployeeId,
        status: "present",
        timeIn: "08:00",
        timeOut: "17:00",
      },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "PUT",
      url: "/staff-attendance/day",
      headers: authHeader(editorToken),
      payload: { date: DATE, employeeId: officeEmployeeId, status: "absent" },
    });
    expect(second.statusCode).toBe(200);

    // Upsert on [company, employee, date] — one row per person per day, never two.
    const rows = await prisma.staffAttendanceDay.findMany({
      where: { companyId: fixture.tenantA.companyId, employeeId: officeEmployeeId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("absent");
  });

  it("refuses to record a security officer here", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/staff-attendance/day",
      headers: authHeader(editorToken),
      payload: { date: DATE, employeeId: fixture.tenantA.employeeId, status: "present" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_OFFICE_STAFF");
  });

  it("does not leak another tenant's employee", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/staff-attendance/day",
      headers: authHeader(editorToken),
      payload: { date: DATE, employeeId: fixture.tenantB.employeeId, status: "present" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("EMPLOYEE_NOT_FOUND");
  });

  it("requires edit capability to write", async () => {
    const read = await app.inject({
      method: "GET",
      url: `/staff-attendance/day?date=${DATE}`,
      headers: authHeader(viewerToken),
    });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: "PUT",
      url: "/staff-attendance/day",
      headers: authHeader(viewerToken),
      payload: { date: DATE, employeeId: officeEmployeeId, status: "present" },
    });
    expect(write.statusCode).toBe(403);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: `/staff-attendance/day?date=${DATE}` });
    expect(res.statusCode).toBe(401);
  });

  it("validates the date format", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/staff-attendance/day?date=03-08-2026",
      headers: authHeader(editorToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it("reports per-entry outcomes from a bulk roll call", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/staff-attendance/day/bulk",
      headers: authHeader(editorToken),
      payload: {
        date: "2026-08-04",
        entries: [
          { employeeId: officeEmployeeId, status: "present" },
          { employeeId: fixture.tenantA.employeeId, status: "present" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toEqual([officeEmployeeId]);
    expect(body.failed).toEqual([
      { employeeId: fixture.tenantA.employeeId, code: "NOT_OFFICE_STAFF", message: expect.any(String) },
    ]);
  });
});
