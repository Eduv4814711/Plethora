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

describe.runIf(dbReady)("cross-module consistency fixes (integration)", () => {
  let app: FastifyInstance;
  let fixture: TenantFixture;
  let employeeHrToken: string;
  let payrollHrToken: string;

  async function tokenFor(capabilities: Record<string, string[]>) {
    const { tenantA } = fixture;
    const user = await prisma.user.create({
      data: {
        companyId: tenantA.companyId,
        name: `Capability User ${Math.random()}`,
        email: `capability-${Math.random()}@test.local`,
        passwordHash: "not-used-in-route-tests",
        capabilities,
      },
    });
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        companyId: tenantA.companyId,
      },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );
  }

  beforeAll(async () => {
    app = await buildApp();
    fixture = await provisionTenantFixture();
    employeeHrToken = await tokenFor({ "/employees": ["view", "create", "edit"] });
    payrollHrToken = await tokenFor({ "/payroll": ["view", "create", "edit"] });
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
      headers: { ...authHeader(employeeHrToken), "content-type": "application/json" },
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
      headers: { ...authHeader(employeeHrToken), "content-type": "application/json" },
      payload: {
        employeeNumber: `XT-${fixture.runId}`,
        firstName: "Cross",
        lastName: "Tenant",
        status: "active",
        employeeType: "security_officer",
        psiraRegistrationNumber: "PSIRA123",
        gradeId: foreignGrade.id,
        groupId: tenantA.employeeGroupId,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message?.gradeId).toBeTruthy();
  });

  it("does not let a Payroll-only user edit an employee", async () => {
    // Payroll used to reach Team through an anyOfModules fallback. It no longer
    // does: Team access has to be granted explicitly and show in the matrix.
    const { tenantA } = fixture;
    const res = await app.inject({
      method: "PUT",
      url: `/employees/${tenantA.employeeId}`,
      headers: { ...authHeader(payrollHrToken), "content-type": "application/json" },
      payload: { firstName: "Payroll Edit" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("does not let a Payroll grant reach Client Billing", async () => {
    // /payroll/billing is its own catalog module; prefix inheritance is gone.
    const token = await tokenFor({ "/payroll": ["view", "create", "edit", "approve"] });
    const res = await app.inject({
      method: "GET",
      url: "/payroll/billing/invoices",
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(403);
  });

  it("does not let a Settings grant enumerate users through Settings · User Access", async () => {
    // The escalation this closes: /settings:view used to satisfy
    // /settings/access:view, exposing every colleague and their full grant map.
    const token = await tokenFor({ "/settings": ["view", "edit"] });
    const res = await app.inject({
      method: "GET",
      url: "/users",
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(403);
  });

  it("records a denied attempt in the audit log", async () => {
    const token = await tokenFor({ "/tasks": ["view"] });
    const before = new Date();
    const res = await app.inject({
      method: "GET",
      url: "/users",
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(403);

    const denial = await prisma.auditLog.findFirst({
      where: {
        companyId: fixture.tenantA.companyId,
        action: "access.denied",
        timestamp: { gte: before },
      },
      orderBy: { timestamp: "desc" },
    });
    expect(denial).toBeTruthy();
    expect(denial?.outcome).toBe("denied");
    expect((denial?.metadata as { capability?: string } | null)?.capability).toBe("view");
  });

  it(
    "allows employee detail edits for a user assigned Team edit access",
    async () => {
      const { tenantA } = fixture;
      const token = await tokenFor({ "/employees": ["edit"] });
      const update = await app.inject({
        method: "PUT",
        url: `/employees/${tenantA.employeeId}`,
        headers: { ...authHeader(token), "content-type": "application/json" },
        payload: { firstName: "Test" },
      });
      expect(update.statusCode).toBe(200);
    }
  );

  it("allows a user with Team create and edit capabilities to create employees and change status", async () => {
    const { tenantA } = fixture;
    const token = await tokenFor({ "/employees": ["create", "edit"] });
    const create = await app.inject({
      method: "POST",
      url: "/employees",
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: {
        employeeNumber: `TEAM-${fixture.runId}`,
        firstName: "Assigned",
        lastName: "User",
        employeeType: "general",
        monthlySalary: 15000,
        groupId: tenantA.employeeGroupId,
      },
    });
    expect(create.statusCode).toBe(201);

    const status = await app.inject({
      method: "POST",
      url: `/employees/${tenantA.employeeId}/status`,
      headers: { ...authHeader(token), "content-type": "application/json" },
      payload: { status: "suspended" },
    });
    expect(status.statusCode).toBe(200);

    await prisma.employee.update({
      where: { id: tenantA.employeeId },
      data: { status: "active" },
    });
  });

  it("denies a user without explicit employee edit access", async () => {
    const { tenantA } = fixture;
    const noAccessToken = await tokenFor({});
    const res = await app.inject({
      method: "PUT",
      url: `/employees/${tenantA.employeeId}`,
      headers: { ...authHeader(noAccessToken), "content-type": "application/json" },
      payload: { firstName: "Not Allowed" },
    });
    expect(res.statusCode).toBe(403);
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
      headers: { ...authHeader(payrollHrToken), "content-type": "application/json" },
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
        dutyOnObNumber: "OB-CROSS-TENANT-TEST",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("Guard not found.");
  });
});
