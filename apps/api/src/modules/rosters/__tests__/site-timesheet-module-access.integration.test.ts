import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { buildApp } from "../../../app.js";
import { prisma } from "../../../lib/prisma.js";
import { config } from "../../../lib/config.js";
import { hashPassword } from "../../../services/auth.service.js";
import { setUserPermissions } from "../../../services/user-access.service.js";
import { permissionsForPreset, PRESET_KEYS } from "../../../lib/permissions.js";
import { authHeader, isIntegrationDatabaseAvailable } from "../../../test-utils/tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("site timesheet module access (integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let attendanceOnlyToken: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({
      data: { name: `Attendance Module Co ${runId}` },
    });
    companyId = company.id;

    const moduleAccess = ["/", "/attendance"];
    const user = await prisma.user.create({
      data: {
        companyId,
        name: "Attendance Controller",
        email: `attendance-only-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("integration-test-password-32chars!!"),
        role: "controller",
        moduleAccess,
      },
    });
    const access = await setUserPermissions(user.id, permissionsForPreset(PRESET_KEYS.CONTROLLER));
    attendanceOnlyToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        companyId,
        role: user.role,
        accessVersion: access.accessVersion,
        moduleAccess,
      },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );
  }, 60_000);

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    }
    await app?.close();
  });

  it("allows capture-overview for users with /attendance but not /rostering", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/rosters/site-timesheets/capture-overview?startDate=2026-07-01&endDate=2026-07-31&shiftType=all",
      headers: authHeader(attendanceOnlyToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      sites: expect.any(Array),
      summary: expect.objectContaining({
        needsCapture: expect.any(Number),
        caughtUp: expect.any(Number),
      }),
    });
  });

  it("still blocks pure rostering routes without /rostering module", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/rosters/live-roster?siteId=missing&startDate=2026-07-01&endDate=2026-07-31",
      headers: authHeader(attendanceOnlyToken),
    });
    expect(res.statusCode).toBe(403);
  });
});
