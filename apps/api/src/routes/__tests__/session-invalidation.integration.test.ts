import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { PRESET_KEYS } from "../../lib/permissions.js";
import { incrementAccessVersion } from "../../services/user-access.service.js";
import {
  authHeader,
  isIntegrationDatabaseAvailable,
  provisionTestUserWithPreset,
} from "../../test-utils/tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("session invalidation (integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let userId: string;
  let staleToken: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({
      data: { name: `Session Invalidation Co ${runId}` },
    });
    companyId = company.id;

    const user = await provisionTestUserWithPreset(
      companyId,
      `session-${runId}@plethora-test.local`,
      "Session Test User",
      PRESET_KEYS.OPERATIONAL_ADMIN
    );
    userId = user.userId;
    staleToken = user.accessToken;
    await incrementAccessVersion(userId);
  }, 60_000);

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    }
    await app?.close();
  });

  it("returns ACCESS_STALE when token accessVersion is outdated", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/employees",
      headers: authHeader(staleToken),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("ACCESS_STALE");
  });
});
