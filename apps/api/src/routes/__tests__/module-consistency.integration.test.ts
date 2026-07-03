import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import {
  authHeader,
  isIntegrationDatabaseAvailable,
  provisionTenantFixture,
  type TenantFixture,
} from "../../test-utils/tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("cross-module consistency fixes (integration)", () => {
  let app: FastifyInstance;
  let fixture: TenantFixture;

  beforeAll(async () => {
    app = await buildApp();
    fixture = await provisionTenantFixture();
  }, 120_000);

  afterAll(async () => {
    await fixture?.teardown();
    await app?.close();
  }, 30_000);

  it("rejects a groupId from another tenant on employee update", async () => {
    const { tenantA, tenantB } = fixture;
    const res = await app.inject({
      method: "PUT",
      url: `/employees/${tenantA.employeeId}`,
      headers: { ...authHeader(tenantA.accessToken), "content-type": "application/json" },
      payload: { groupId: tenantB.employeeGroupId },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message?.groupId).toBeTruthy();
  });

  it("rejects a cross-tenant gradeId on employee create", async () => {
    const { tenantA, tenantB } = fixture;
    const foreignGrade = await prisma.payGrade.create({
      data: { companyId: tenantB.companyId, name: `Foreign ${fixture.runId}`, hourlyRate: 99, sortOrder: 0 },
    });
    const res = await app.inject({
      method: "POST",
      url: "/employees",
      headers: { ...authHeader(tenantA.accessToken), "content-type": "application/json" },
      payload: {
        employeeNumber: `XT-${fixture.runId}`,
        firstName: "Cross",
        lastName: "Tenant",
        status: "active",
        employeeType: "security",
        psiraNumber: "PSIRA123",
        gradeId: foreignGrade.id,
        groupId: tenantA.employeeGroupId,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message?.gradeId).toBeTruthy();
  });

  it("returns the sanitized detail DTO (not the raw DB row) on status transition", async () => {
    const { tenantA } = fixture;
    await prisma.employee.update({
      where: { id: tenantA.employeeId },
      data: { taxDirectiveNumber: "DIRECTIVE-SECRET" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/employees/${tenantA.employeeId}/status`,
      headers: { ...authHeader(tenantA.accessToken), "content-type": "application/json" },
      payload: { status: "suspended" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("suspended");
    // Fields outside the employee DTO selects must not appear in responses.
    expect(body.taxDirectiveNumber).toBeUndefined();

    // Restore status for other tests.
    await prisma.employee.update({
      where: { id: tenantA.employeeId },
      data: { status: "active" },
    });
  });

  it("refuses to delete an employee group that still has members", async () => {
    const { tenantA } = fixture;
    const res = await app.inject({
      method: "DELETE",
      url: `/employee-groups/${tenantA.employeeGroupId}`,
      headers: authHeader(tenantA.accessToken),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Group not empty");
  });

  it("rejects a cross-tenant guard on site timesheet row creation", async () => {
    const { tenantA, tenantB } = fixture;
    const sheet = await prisma.siteTimesheet.create({
      data: {
        companyId: tenantA.companyId,
        siteId: tenantA.siteId,
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        periodEnd: new Date("2026-08-31T00:00:00.000Z"),
        status: "draft",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/rosters/site-timesheets/${sheet.id}/rows`,
      headers: { ...authHeader(tenantA.accessToken), "content-type": "application/json" },
      payload: {
        workDate: "2026-08-05",
        actualGuardId: tenantB.employeeId,
        actualShiftCode: "D",
        actualShiftType: "day",
        attendanceStatus: "present",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("Guard not found.");
  });
});
