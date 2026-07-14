import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { PRESET_KEYS, permissionsForPreset } from "../../lib/permissions.js";
import { hashPassword } from "../auth.service.js";
import {
  LastSystemOwnerError,
  grantSystemOwner,
  revokeSystemOwner,
  setUserPermissions,
} from "../user-access.service.js";
import { isIntegrationDatabaseAvailable } from "../../test-utils/tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("user-access system owner (unit/db)", () => {
  let companyId: string;
  let ownerId: string;
  let secondOwnerId: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `Owner Access Co ${runId}` },
    });
    companyId = company.id;

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
  }, 60_000);

  afterAll(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    }
  });

  it("setUserPermissions on an owner does not clear isSystemOwner", async () => {
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

  it("revokeSystemOwner of the sole owner is blocked", async () => {
    await expect(revokeSystemOwner(ownerId, companyId)).rejects.toBeInstanceOf(LastSystemOwnerError);
    const still = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { isSystemOwner: true },
    });
    expect(still?.isSystemOwner).toBe(true);
  });

  it("revokeSystemOwner succeeds when another owner exists", async () => {
    await grantSystemOwner(secondOwnerId);
    const revoked = await revokeSystemOwner(secondOwnerId, companyId);
    expect(revoked.isSystemOwner).toBe(false);

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
});
