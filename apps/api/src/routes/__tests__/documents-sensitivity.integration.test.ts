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

describe.runIf(dbReady)("documents sensitivity filter (integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let uploaderId: string;
  let opAdminToken: string;
  let hrToken: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({
      data: { name: `Documents Sensitivity Co ${runId}` },
    });
    companyId = company.id;

    const opAdmin = await provisionTestUserWithPreset(
      companyId,
      `docs-op-${runId}@plethora-test.local`,
      "Operational Admin",
      PRESET_KEYS.OPERATIONAL_ADMIN
    );
    opAdminToken = opAdmin.accessToken;
    uploaderId = opAdmin.userId;

    const hr = await provisionTestUserWithPreset(
      companyId,
      `docs-hr-${runId}@plethora-test.local`,
      "HR User",
      PRESET_KEYS.HR
    );
    hrToken = hr.accessToken;

    await prisma.managedDocument.createMany({
      data: [
        {
          companyId,
          uploadedById: uploaderId,
          title: `Operational Doc ${runId}`,
          documentType: "policy",
          category: "COMPLIANCE",
          sensitivity: "INTERNAL_OPERATIONAL",
          fileUrl: "https://example.com/op.pdf",
          fileName: "op.pdf",
          mimeType: "application/pdf",
          size: 100,
        },
        {
          companyId,
          uploadedById: uploaderId,
          title: `HR Doc ${runId}`,
          documentType: "contract",
          category: "EMPLOYEE",
          sensitivity: "HR_CONFIDENTIAL",
          fileUrl: "https://example.com/hr.pdf",
          fileName: "hr.pdf",
          mimeType: "application/pdf",
          size: 100,
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    }
    await app?.close();
  });

  it("returns only operational documents for operational admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/documents",
      headers: authHeader(opAdminToken),
    });
    expect(res.statusCode).toBe(200);
    const titles = (res.json().items as Array<{ title: string }>).map((d) => d.title);
    expect(titles.some((t) => t.includes("Operational Doc"))).toBe(true);
    expect(titles.some((t) => t.includes("HR Doc"))).toBe(false);
  });

  it("returns HR confidential documents for HR user", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/documents",
      headers: authHeader(hrToken),
    });
    expect(res.statusCode).toBe(200);
    const titles = (res.json().items as Array<{ title: string }>).map((d) => d.title);
    expect(titles.some((t) => t.includes("HR Doc"))).toBe(true);
  });
});
