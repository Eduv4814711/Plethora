import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { config } from "../../lib/config.js";
import { prisma } from "../../lib/prisma.js";

const hasDatabase = Boolean(process.env.TEST_DATABASE_URL?.trim() || process.env.CI === "true");
const describeWithDatabase = hasDatabase ? describe : describe.skip;

describeWithDatabase("user capability delegation", () => {
  let app: FastifyInstance;
  let companyId: string;
  let ownerId: string;
  let managerId: string;
  let targetId: string;
  let ownerToken: string;
  let managerToken: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const company = await prisma.company.create({
      data: { name: `Access ceiling ${suffix}` },
    });
    companyId = company.id;
    const [owner, manager, target] = await Promise.all([
      prisma.user.create({
        data: {
          companyId,
          name: "Owner",
          email: `owner-${suffix}@test.local`,
          passwordHash: "not-used",
          capabilities: {},
        },
      }),
      prisma.user.create({
        data: {
          companyId,
          name: "Access manager",
          email: `manager-${suffix}@test.local`,
          passwordHash: "not-used",
          capabilities: {
            "/settings/access": ["view", "create", "edit", "delete", "manage_access"],
            "/employees": ["view", "edit"],
          },
        },
      }),
      prisma.user.create({
        data: {
          companyId,
          name: "Target",
          email: `target-${suffix}@test.local`,
          passwordHash: "not-used",
          capabilities: {},
        },
      }),
    ]);
    ownerId = owner.id;
    managerId = manager.id;
    targetId = target.id;
    await prisma.company.update({
      where: { id: companyId },
      data: { ownerUserId: ownerId },
    });
    ownerToken = jwt.sign(
      { sub: ownerId, email: owner.email, companyId },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );
    managerToken = jwt.sign(
      { sub: managerId, email: manager.email, companyId },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
    if (companyId) {
      await prisma.company.update({
        where: { id: companyId },
        data: { ownerUserId: null },
      }).catch(() => undefined);
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    }
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it("blocks self-escalation and proxy-user escalation", async () => {
    const self = await app.inject({
      method: "PUT",
      url: `/users/${managerId}`,
      headers: auth(managerToken),
      payload: { capabilities: { "/payroll": ["view"] } },
    });
    expect(self.statusCode).toBe(403);

    const proxy = await app.inject({
      method: "POST",
      url: "/users",
      headers: auth(managerToken),
      payload: {
        name: "Payroll proxy",
        email: `proxy-${Date.now()}@test.local`,
        sendSetupLink: true,
        capabilities: { "/payroll": ["view"] },
      },
    });
    expect(proxy.statusCode).toBe(403);
  });

  it("allows a non-owner to delegate only a subset and never manage_access", async () => {
    const subset = await app.inject({
      method: "PUT",
      url: `/users/${targetId}`,
      headers: auth(managerToken),
      payload: { capabilities: { "/employees": ["view"] } },
    });
    expect(subset.statusCode).toBe(200);

    const accessManager = await app.inject({
      method: "PUT",
      url: `/users/${targetId}`,
      headers: auth(managerToken),
      payload: {
        capabilities: {
          "/employees": ["view"],
          "/settings/access": ["manage_access"],
        },
      },
    });
    expect(accessManager.statusCode).toBe(403);
  });

  it("lets the owner grant any catalog capability and protects peer access managers", async () => {
    const ownerGrant = await app.inject({
      method: "PUT",
      url: `/users/${targetId}`,
      headers: auth(ownerToken),
      payload: {
        capabilities: {
          "/payroll": ["view", "view_sensitive", "approve"],
          "/settings/access": ["view", "edit", "manage_access"],
        },
      },
    });
    expect(ownerGrant.statusCode).toBe(200);

    const peerMutation = await app.inject({
      method: "PUT",
      url: `/users/${targetId}`,
      headers: auth(managerToken),
      payload: { name: "Changed by peer" },
    });
    expect(peerMutation.statusCode).toBe(403);

    const peerDelete = await app.inject({
      method: "DELETE",
      url: `/users/${targetId}`,
      headers: auth(managerToken),
    });
    expect(peerDelete.statusCode).toBe(403);
  });

  it("deactivates accounts without deleting their historical user record", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/users/${targetId}`,
      headers: auth(ownerToken),
    });
    expect(response.statusCode).toBe(204);

    const retained = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { isActive: true, capabilities: true },
    });
    expect(retained).toEqual({ isActive: false, capabilities: {} });
    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: {
          companyId,
          entityId: targetId,
          action: "user.deactivate",
        },
      })
    ).resolves.toBeTruthy();
  });
});
