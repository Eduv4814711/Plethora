import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { ALL_PERMISSIONS, PERMISSIONS, PRESET_KEYS, permissionsForPreset } from "../../lib/permissions.js";
import { hashPassword } from "../auth.service.js";
import {
  LastSystemOwnerError,
  SystemOwnerForbiddenError,
  grantSystemOwner,
  hasPermission,
  loadUserAccess,
  revokeSystemOwner,
  setUserPermissions,
} from "../user-access.service.js";
import { resolveEffectiveModuleAccess } from "../../lib/module-access.js";
import { isIntegrationDatabaseAvailable } from "../../test-utils/tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("user-access system owner (unit/db)", () => {
  let companyId: string;
  let otherCompanyId: string;
  let ownerId: string;
  let secondOwnerId: string;
  let otherCompanyUserId: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `Owner Access Co ${runId}` },
    });
    companyId = company.id;

    const other = await prisma.company.create({
      data: { name: `Other Co ${runId}` },
    });
    otherCompanyId = other.id;

    const owner = await prisma.user.create({
      data: {
        companyId,
        name: "Primary Owner",
        email: `owner-primary-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("integration-test-password-32chars!!"),
        role: "admin",
        isSystemOwner: true,
      },
    });
    ownerId = owner.id;
    await grantSystemOwner(ownerId);

    const second = await prisma.user.create({
      data: {
        companyId,
        name: "Second Owner",
        email: `owner-second-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("integration-test-password-32chars!!"),
        role: "admin",
        isSystemOwner: false,
      },
    });
    secondOwnerId = second.id;

    const foreign = await prisma.user.create({
      data: {
        companyId: otherCompanyId,
        name: "Foreign Owner",
        email: `owner-foreign-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("integration-test-password-32chars!!"),
        role: "admin",
        isSystemOwner: true,
      },
    });
    otherCompanyUserId = foreign.id;
    await grantSystemOwner(otherCompanyUserId);
  }, 60_000);

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    }
    if (otherCompanyId) {
      await prisma.company.delete({ where: { id: otherCompanyId } }).catch(() => {});
    }
  });

  it("setUserPermissions on an owner does not clear isSystemOwner (original defect)", async () => {
    const before = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { isSystemOwner: true, accessVersion: true },
    });
    expect(before?.isSystemOwner).toBe(true);

    const result = await setUserPermissions(ownerId, permissionsForPreset(PRESET_KEYS.SUPERVISOR));
    expect(result.isSystemOwner).toBe(true);

    const after = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { isSystemOwner: true, accessVersion: true },
    });
    expect(after?.isSystemOwner).toBe(true);
    expect(after!.accessVersion).toBeGreaterThan(before!.accessVersion);
  });

  it("owner with zero permission rows still has all permissions", async () => {
    await prisma.userPermission.deleteMany({ where: { userId: ownerId } });
    const access = await loadUserAccess(ownerId);
    expect(access?.isSystemOwner).toBe(true);
    expect(access?.permissions.size).toBe(ALL_PERMISSIONS.length);
    expect(hasPermission(access!, PERMISSIONS.USERS_MANAGE)).toBe(true);
    expect(hasPermission(access!, PERMISSIONS.PAYROLL_EXPORT)).toBe(true);
  });

  it("owner with restrictive moduleAccess still resolves every module", async () => {
    await prisma.user.update({
      where: { id: ownerId },
      data: { moduleAccess: ["/employees"] },
    });
    const modules = resolveEffectiveModuleAccess({
      role: "admin",
      moduleAccess: ["/employees"],
      isSystemOwner: true,
    });
    expect(modules).not.toBeNull();
    expect(modules!.length).toBeGreaterThan(1);
    expect(modules).toContain("/payroll");
    await prisma.user.update({
      where: { id: ownerId },
      data: { moduleAccess: null },
    });
  });

  it("revokeSystemOwner of the sole owner is blocked", async () => {
    await expect(revokeSystemOwner(ownerId, { actorUserId: ownerId })).rejects.toBeInstanceOf(
      LastSystemOwnerError
    );
    const still = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { isSystemOwner: true },
    });
    expect(still?.isSystemOwner).toBe(true);
  });

  it("revokeSystemOwner succeeds when another owner exists and increments accessVersion once", async () => {
    await grantSystemOwner(secondOwnerId);
    const before = await prisma.user.findUnique({
      where: { id: secondOwnerId },
      select: { accessVersion: true },
    });
    const revoked = await revokeSystemOwner(secondOwnerId, { actorUserId: ownerId });
    expect(revoked.isSystemOwner).toBe(false);
    expect(revoked.accessVersion).toBe(before!.accessVersion + 1);

    const row = await prisma.user.findUnique({
      where: { id: secondOwnerId },
      select: { isSystemOwner: true },
    });
    expect(row?.isSystemOwner).toBe(false);
  });

  it("setUserPermissions still replaces rows for non-owners", async () => {
    const perms = permissionsForPreset(PRESET_KEYS.SUPERVISOR);
    const result = await setUserPermissions(secondOwnerId, perms);
    expect(result.isSystemOwner).toBe(false);
    expect(result.permissions.has(perms[0]!)).toBe(true);
  });

  it("grantSystemOwner rejects cross-company actor", async () => {
    await expect(
      grantSystemOwner(secondOwnerId, { actorUserId: otherCompanyUserId })
    ).rejects.toBeInstanceOf(SystemOwnerForbiddenError);
  });

  it("non-owner cannot grant ownership", async () => {
    await expect(
      grantSystemOwner(secondOwnerId, { actorUserId: secondOwnerId })
    ).rejects.toBeInstanceOf(SystemOwnerForbiddenError);
  });
});
