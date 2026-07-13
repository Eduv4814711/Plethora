import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { PERMISSIONS, PRESET_KEYS } from "../../lib/permissions.js";
import {
  authHeader,
  isIntegrationDatabaseAvailable,
  provisionTestUserWithPreset,
} from "../../test-utils/tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("permission escalation guard (integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let opAdminToken: string;
  let targetUserId: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({
      data: { name: `Escalation Co ${runId}` },
    });
    companyId = company.id;

    const opAdmin = await provisionTestUserWithPreset(
      companyId,
      `escalation-admin-${runId}@plethora-test.local`,
      "Operational Admin",
      PRESET_KEYS.OPERATIONAL_ADMIN
    );
    opAdminToken = opAdmin.accessToken;

    const target = await provisionTestUserWithPreset(
      companyId,
      `escalation-target-${runId}@plethora-test.local`,
      "Target User",
      PRESET_KEYS.SUPERVISOR,
      "supervisor"
    );
    targetUserId = target.userId;
  }, 60_000);

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    }
    await app?.close();
  });

  it("blocks operational admin from granting sensitive payroll permissions", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/users/${targetUserId}`,
      headers: { ...authHeader(opAdminToken), "content-type": "application/json" },
      payload: {
        permissions: [PERMISSIONS.PAYROLL_EXPORT, PERMISSIONS.COMPENSATION_READ],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/sensitive/i);
  });
});
