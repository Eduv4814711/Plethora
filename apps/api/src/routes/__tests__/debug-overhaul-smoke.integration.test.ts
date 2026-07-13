import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { config } from "../../lib/config.js";
import { hashPassword } from "../../services/auth.service.js";
import { grantSystemOwner } from "../../services/user-access.service.js";
import {
  authHeader,
  isIntegrationDatabaseAvailable,
  provisionTestUserWithPreset,
} from "../../test-utils/tenant-harness.js";
import { PRESET_KEYS } from "../../lib/permissions.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("debug overhaul smoke (integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let ownerToken: string;
  let opAdminToken: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({
      data: { name: `Debug Smoke Co ${runId}` },
    });
    companyId = company.id;

    const ownerUser = await prisma.user.create({
      data: {
        companyId,
        name: "Owner",
        email: `owner-smoke-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("integration-test-password-32chars!!"),
        role: "admin",
        isSystemOwner: true,
        moduleAccess: null,
      },
    });
    await grantSystemOwner(ownerUser.id);
    const owner = await prisma.user.findUnique({
      where: { id: ownerUser.id },
      select: { accessVersion: true, isSystemOwner: true },
    });
    ownerToken = jwt.sign(
      {
        sub: ownerUser.id,
        email: ownerUser.email,
        companyId,
        role: "admin",
        accessVersion: owner?.accessVersion ?? 1,
        isSystemOwner: true,
        // Intentionally omit moduleAccess — owner bypass + role defaults must still work
      },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );

    const op = await provisionTestUserWithPreset(
      companyId,
      `op-smoke-${runId}@plethora-test.local`,
      "Op Admin",
      PRESET_KEYS.OPERATIONAL_ADMIN
    );
    opAdminToken = op.accessToken;
  }, 90_000);

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    }
    await app?.close();
  });

  it("system owner with null moduleAccess can load dashboard and sites", async () => {
    const dash = await app.inject({
      method: "GET",
      url: "/dashboard?dateRange=month",
      headers: authHeader(ownerToken),
    });
    expect(dash.statusCode).toBe(200);

    const sites = await app.inject({
      method: "GET",
      url: "/sites?limit=100",
      headers: authHeader(ownerToken),
    });
    expect(sites.statusCode).toBe(200);
  });

  it("operational admin can read operational reports but not financial", async () => {
    const ops = await app.inject({
      method: "GET",
      url: "/reports/",
      headers: authHeader(opAdminToken),
    });
    expect(ops.statusCode).toBe(200);

    const fin = await app.inject({
      method: "GET",
      url: "/reports/financial",
      headers: authHeader(opAdminToken),
    });
    expect(fin.statusCode).toBe(403);
  });

  it("operational admin cannot write statutory settings fields", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/settings/",
      headers: { ...authHeader(opAdminToken), "content-type": "application/json" },
      payload: { businessDetails: { taxNumber: "1234567890" } },
    });
    expect(res.statusCode).toBe(403);
  });

  it("capture overview works with attendance module for op admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/rosters/site-timesheets/capture-overview?startDate=2026-07-01&endDate=2026-07-31&shiftType=all",
      headers: authHeader(opAdminToken),
    });
    expect(res.statusCode).toBe(200);
  });
});
