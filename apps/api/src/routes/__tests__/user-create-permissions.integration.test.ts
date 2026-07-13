import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { config } from "../../lib/config.js";
import { hashPassword } from "../../services/auth.service.js";
import { grantSystemOwner } from "../../services/user-access.service.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  authHeader,
  isIntegrationDatabaseAvailable,
} from "../../test-utils/tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("user create assigns preset permissions (integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let ownerToken: string;
  const runId = randomBytes(6).toString("hex");
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({
      data: { name: `User Create Perms Co ${runId}` },
    });
    companyId = company.id;

    const ownerUser = await prisma.user.create({
      data: {
        companyId,
        name: "Owner",
        email: `user-create-owner-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("integration-test-password-32chars!!"),
        role: "admin",
        isSystemOwner: true,
        moduleAccess: null,
      },
    });
    await grantSystemOwner(ownerUser.id);
    const owner = await prisma.user.findUnique({
      where: { id: ownerUser.id },
      select: { accessVersion: true },
    });
    ownerToken = jwt.sign(
      {
        sub: ownerUser.id,
        email: ownerUser.email,
        companyId,
        role: "admin",
        accessVersion: owner?.accessVersion ?? 1,
        isSystemOwner: true,
      },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );
  }, 90_000);

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    }
    await app?.close();
  });

  it("gives a newly created operational admin employees access but not hr-private", async () => {
    const email = `new-op-admin-${runId}@plethora-test.local`;
    const password = `Xx9!kLmN2pQvR4sT-${runId}`;
    const createRes = await app.inject({
      method: "POST",
      url: "/users",
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: {
        name: "New Ops Admin",
        email,
        role: "admin",
        sendSetupLink: false,
        password,
        moduleAccess: ["/", "/employees", "/sites"],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { id: string };
    createdUserIds.push(created.id);

    const perms = await prisma.userPermission.findMany({
      where: { userId: created.id },
      select: { permission: true },
    });
    const permSet = new Set(perms.map((p) => p.permission));
    expect(permSet.has(PERMISSIONS.EMPLOYEES_READ_OPERATIONAL)).toBe(true);
    expect(permSet.has(PERMISSIONS.EMPLOYEES_MANAGE_OPERATIONAL)).toBe(true);
    expect(permSet.has(PERMISSIONS.EMPLOYEES_READ_PRIVATE)).toBe(false);

    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email, password },
    });
    expect(loginRes.statusCode).toBe(200);
    const { accessToken } = loginRes.json() as { accessToken: string };

    const listRes = await app.inject({
      method: "GET",
      url: "/employees",
      headers: authHeader(accessToken),
    });
    expect(listRes.statusCode).toBe(200);

    const employee = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `UC-${runId}`,
        firstName: "Test",
        lastName: "Guard",
        status: "active",
        employeeType: "security",
      },
    });

    const privateRes = await app.inject({
      method: "GET",
      url: `/employees/${employee.id}/hr-private`,
      headers: authHeader(accessToken),
    });
    expect(privateRes.statusCode).toBe(403);
  });
});
