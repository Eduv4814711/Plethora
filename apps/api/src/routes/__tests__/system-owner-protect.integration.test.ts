import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { PRESET_KEYS, PERMISSIONS } from "../../lib/permissions.js";
import { grantSystemOwner } from "../../services/user-access.service.js";
import {
  authHeader,
  isIntegrationDatabaseAvailable,
  provisionTestAdminUser,
  provisionTestUserWithPreset,
} from "../../test-utils/tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("system owner protect (integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let ownerId: string;
  let ownerToken: string;
  let secondOwnerId: string;
  let nonOwnerId: string;
  let nonOwnerToken: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({
      data: { name: `Owner Protect Co ${runId}` },
    });
    companyId = company.id;

    const owner = await provisionTestAdminUser(
      companyId,
      `protect-owner-${runId}@plethora-test.local`,
      "Protect Owner"
    );
    ownerId = owner.userId;
    ownerToken = owner.accessToken;

    const second = await provisionTestAdminUser(
      companyId,
      `protect-owner2-${runId}@plethora-test.local`,
      "Protect Owner 2"
    );
    secondOwnerId = second.userId;

    const nonOwner = await provisionTestUserWithPreset(
      companyId,
      `protect-op-${runId}@plethora-test.local`,
      "Op Admin",
      PRESET_KEYS.OPERATIONAL_ADMIN
    );
    nonOwnerId = nonOwner.userId;
    nonOwnerToken = nonOwner.accessToken;
  }, 60_000);

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    }
    await app?.close();
  });

  it("PUT with name leaves isSystemOwner true and access still works", async () => {
    const putRes = await app.inject({
      method: "PUT",
      url: `/users/${ownerId}`,
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: { name: "Protect Owner Updated" },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().isSystemOwner).toBe(true);

    const row = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { isSystemOwner: true },
    });
    expect(row?.isSystemOwner).toBe(true);

    const gated = await app.inject({
      method: "GET",
      url: "/users",
      headers: authHeader(ownerToken),
    });
    expect(gated.statusCode).toBe(200);
    expect(gated.json().message).not.toBe("Insufficient permissions for this action");
  });

  it("PUT with email leaves isSystemOwner true", async () => {
    const newEmail = `protect-owner-renamed-${runId}@plethora-test.local`;
    const putRes = await app.inject({
      method: "PUT",
      url: `/users/${ownerId}`,
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: { email: newEmail },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().isSystemOwner).toBe(true);
    const row = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { isSystemOwner: true, email: true },
    });
    expect(row?.isSystemOwner).toBe(true);
    expect(row?.email).toBe(newEmail);
  });

  it("PUT with role admin on owner preserves ownership (no demotion)", async () => {
    const before = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { isSystemOwner: true },
    });
    expect(before?.isSystemOwner).toBe(true);

    const putRes = await app.inject({
      method: "PUT",
      url: `/users/${ownerId}`,
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: { role: "admin", moduleAccess: ["/employees"] },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().isSystemOwner).toBe(true);

    const row = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { isSystemOwner: true, moduleAccess: true },
    });
    expect(row?.isSystemOwner).toBe(true);
    expect(row?.moduleAccess).toBeNull();
  });

  it("PUT with presetKey on a system owner returns 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/users/${ownerId}`,
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: { presetKey: PRESET_KEYS.SUPERVISOR },
    });
    expect(res.statusCode).toBe(400);
    expect(String(res.json().message)).toMatch(/revoke-system-owner/i);
  });

  it("PUT role demotion of system owner returns 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/users/${ownerId}`,
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: { role: "supervisor" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("normal administrator cannot edit a system owner", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/users/${ownerId}`,
      headers: { ...authHeader(nonOwnerToken), "content-type": "application/json" },
      payload: { name: "Hacked Name" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("DELETE of a system owner returns 403", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/users/${secondOwnerId}`,
      headers: authHeader(ownerToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("normal administrator cannot delete a system owner", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/users/${ownerId}`,
      headers: authHeader(nonOwnerToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("revoke of sole remaining owner after demoting peer is blocked at 409", async () => {
    await grantSystemOwner(secondOwnerId);
    const revokeSecond = await app.inject({
      method: "POST",
      url: `/users/${secondOwnerId}/revoke-system-owner`,
      headers: authHeader(ownerToken),
    });
    expect(revokeSecond.statusCode).toBe(200);
    expect(revokeSecond.json().isSystemOwner).toBe(false);

    const revokeLast = await app.inject({
      method: "POST",
      url: `/users/${ownerId}/revoke-system-owner`,
      headers: authHeader(ownerToken),
    });
    expect(revokeLast.statusCode).toBe(409);
  });

  it("grant-system-owner requires actor to be system owner", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/users/${nonOwnerId}/grant-system-owner`,
      headers: authHeader(nonOwnerToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("grant then revoke of non-last owner succeeds", async () => {
    const grant = await app.inject({
      method: "POST",
      url: `/users/${nonOwnerId}/grant-system-owner`,
      headers: authHeader(ownerToken),
    });
    expect(grant.statusCode).toBe(200);
    expect(grant.json().isSystemOwner).toBe(true);

    const revoke = await app.inject({
      method: "POST",
      url: `/users/${nonOwnerId}/revoke-system-owner`,
      headers: authHeader(ownerToken),
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().isSystemOwner).toBe(false);
  });

  it("owner passes sensitive permission gate after setUserPermissions regression path", async () => {
    const { setUserPermissions } = await import("../../services/user-access.service.js");
    const { permissionsForPreset, PRESET_KEYS: KEYS } = await import("../../lib/permissions.js");
    await setUserPermissions(ownerId, permissionsForPreset(KEYS.SUPERVISOR));

    const row = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { isSystemOwner: true, email: true },
    });
    expect(row?.isSystemOwner).toBe(true);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: {
        email: row!.email,
        password: "integration-test-password-32chars!!",
      },
    });
    expect(login.statusCode).toBe(200);
    const body = login.json() as { accessToken: string; user: { isSystemOwner: boolean } };
    expect(body.user.isSystemOwner).toBe(true);

    const gated = await app.inject({
      method: "GET",
      url: "/users",
      headers: authHeader(body.accessToken),
    });
    expect(gated.statusCode).toBe(200);
    expect(JSON.stringify(gated.json())).not.toContain("Insufficient permissions for this action");
  });

  it("non-owner admin PUT still replaces permissions", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/users/${nonOwnerId}`,
      headers: { ...authHeader(ownerToken), "content-type": "application/json" },
      payload: {
        permissions: [PERMISSIONS.USERS_MANAGE, PERMISSIONS.EMPLOYEES_READ_OPERATIONAL],
      },
    });
    expect(res.statusCode).toBe(200);

    const perms = await prisma.userPermission.findMany({
      where: { userId: nonOwnerId },
      select: { permission: true },
    });
    const keys = perms.map((p) => p.permission);
    expect(keys).toContain(PERMISSIONS.USERS_MANAGE);
  });
});
