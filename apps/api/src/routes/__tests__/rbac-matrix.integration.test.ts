import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { PRESET_KEYS } from "../../lib/permissions.js";
import {
  authHeader,
  isIntegrationDatabaseAvailable,
  provisionTestUserWithPreset,
} from "../../test-utils/tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("RBAC matrix (integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let employeeId: string;
  let accessToken: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({
      data: { name: `RBAC Matrix Co ${runId}` },
    });
    companyId = company.id;

    const opAdmin = await provisionTestUserWithPreset(
      companyId,
      `op-admin-${runId}@plethora-test.local`,
      "Operational Admin",
      PRESET_KEYS.OPERATIONAL_ADMIN
    );
    accessToken = opAdmin.accessToken;

    const employee = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `RBAC-${runId}`,
        firstName: "Sensitive",
        lastName: "Employee",
        status: "active",
        employeeType: "office",
        idNumber: "9001015800085",
      },
    });
    employeeId = employee.id;
  }, 60_000);

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    }
    await app?.close();
  });

  it("blocks HR-private employee endpoint", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/employees/${employeeId}/hr-private`,
      headers: authHeader(accessToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("blocks compensation employee endpoint", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/employees/${employeeId}/compensation`,
      headers: authHeader(accessToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("blocks financial reports", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/reports/financial",
      headers: authHeader(accessToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows operational reports", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/reports/",
      headers: authHeader(accessToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it("omits confidential fields from operational employee read", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/employees/${employeeId}`,
      headers: authHeader(accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.idNumber).toBeUndefined();
    expect(body.monthlySalary).toBeUndefined();
    expect(body.compensationSetupPending).toBe(true);
  });
});
