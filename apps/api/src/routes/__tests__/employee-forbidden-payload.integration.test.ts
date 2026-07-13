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

describe.runIf(dbReady)("employee forbidden payload (integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let employeeId: string;
  let accessToken: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({
      data: { name: `Forbidden Payload Co ${runId}` },
    });
    companyId = company.id;

    const opAdmin = await provisionTestUserWithPreset(
      companyId,
      `forbidden-${runId}@plethora-test.local`,
      "Operational Admin",
      PRESET_KEYS.OPERATIONAL_ADMIN
    );
    accessToken = opAdmin.accessToken;

    const employee = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `FB-${runId}`,
        firstName: "Test",
        lastName: "User",
        status: "active",
        employeeType: "office",
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

  it("rejects monthlySalary on operational create", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/employees",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: {
        employeeNumber: `NEW-${runId}`,
        firstName: "New",
        lastName: "Hire",
        employeeType: "office",
        monthlySalary: 15000,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/monthlySalary/i);
  });

  it("rejects idNumber on operational update", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/employees/${employeeId}`,
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { idNumber: "9001015800085" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/idNumber/i);
  });
});
