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

describe.runIf(dbReady)("export permissions (integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let opAdminToken: string;
  let financeToken: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({
      data: { name: `Export Perm Co ${runId}` },
    });
    companyId = company.id;

    await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `EXP-${runId}`,
        firstName: "Export",
        lastName: "Target",
        status: "active",
        employeeType: "office",
        idNumber: "9001015800085",
        monthlySalary: 18000,
      },
    });

    const opAdmin = await provisionTestUserWithPreset(
      companyId,
      `export-op-${runId}@plethora-test.local`,
      "Operational Admin",
      PRESET_KEYS.OPERATIONAL_ADMIN
    );
    opAdminToken = opAdmin.accessToken;

    const finance = await provisionTestUserWithPreset(
      companyId,
      `export-fin-${runId}@plethora-test.local`,
      "Finance User",
      PRESET_KEYS.FINANCE
    );
    financeToken = finance.accessToken;
  }, 60_000);

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    }
    await app?.close();
  });

  it("allows operational export without confidential columns", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/migrations/export/employees-operational",
      headers: authHeader(opAdminToken),
    });
    expect(res.statusCode).toBe(200);
    const csv = res.body as string;
    expect(csv).toContain("Employee Number");
    expect(csv).not.toContain("ID Number");
    expect(csv).not.toContain("Bank Account");
  });

  it("blocks confidential export for operational admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/migrations/export/employees-confidential",
      headers: authHeader(opAdminToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows confidential export for finance user", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/migrations/export/employees-confidential",
      headers: authHeader(financeToken),
    });
    expect(res.statusCode).toBe(200);
    const csv = res.body as string;
    expect(csv).toContain("ID Number");
    expect(csv).toContain("9001015800085");
  });
});
