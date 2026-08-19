import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { config } from "../../lib/config.js";
import { prisma } from "../../lib/prisma.js";

const hasDatabase = Boolean(process.env.TEST_DATABASE_URL?.trim() || process.env.CI === "true");
const describeWithDatabase = hasDatabase ? describe : describe.skip;

/**
 * Maker-checker on user access. The invariant under test throughout: a proposal
 * grants nothing. Until the owner approves, User.capabilities must be untouched.
 */
describeWithDatabase("access change requests", () => {
  let app: FastifyInstance;
  let companyId: string;
  let ownerId: string;
  let managerId: string;
  let targetId: string;
  let ownerToken: string;
  let managerToken: string;
  let suffix: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const MANAGER_CAPABILITIES = {
    "/settings/access": ["view", "create", "edit", "delete", "manage_access"],
    "/employees": ["view", "edit"],
    "/payroll": ["view"],
  };

  beforeAll(async () => {
    suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const company = await prisma.company.create({ data: { name: `Maker checker ${suffix}` } });
    companyId = company.id;
    const [owner, manager, target] = await Promise.all([
      prisma.user.create({
        data: {
          companyId,
          name: "Owner",
          email: `mc-owner-${suffix}@test.local`,
          passwordHash: "not-used",
          capabilities: {},
        },
      }),
      prisma.user.create({
        data: {
          companyId,
          name: "Access manager",
          email: `mc-manager-${suffix}@test.local`,
          passwordHash: "not-used",
          capabilities: MANAGER_CAPABILITIES,
        },
      }),
      prisma.user.create({
        data: {
          companyId,
          name: "Target",
          email: `mc-target-${suffix}@test.local`,
          passwordHash: "not-used",
          capabilities: {},
        },
      }),
    ]);
    ownerId = owner.id;
    managerId = manager.id;
    targetId = target.id;
    await prisma.company.update({ where: { id: companyId }, data: { ownerUserId: ownerId } });
    ownerToken = jwt.sign({ sub: ownerId, email: owner.email, companyId }, config.jwt.accessSecret, {
      expiresIn: "1h",
    });
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
      await prisma.company
        .update({ where: { id: companyId }, data: { ownerUserId: null } })
        .catch(() => undefined);
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    }
  });

  beforeEach(async () => {
    await prisma.accessChangeRequest.deleteMany({ where: { companyId } });
    await prisma.user.update({
      where: { id: targetId },
      data: { capabilities: {}, isActive: true, jobTitle: null },
    });
    await prisma.user.update({
      where: { id: managerId },
      data: { capabilities: MANAGER_CAPABILITIES, isActive: true },
    });
  });

  const proposeTargetGrant = async (capabilities: Record<string, string[]>) => {
    const response = await app.inject({
      method: "PUT",
      url: `/users/${targetId}`,
      headers: auth(managerToken),
      payload: { capabilities },
    });
    expect(response.statusCode).toBe(202);
    return response.json().request as { id: string; diff: { added: unknown[] } };
  };

  it("stores a manager's edit as a proposal and grants nothing until approved", async () => {
    const pending = await proposeTargetGrant({ "/employees": ["view"] });

    expect(pending.diff.added).toHaveLength(1);
    const beforeApproval = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { capabilities: true },
    });
    expect(beforeApproval.capabilities).toEqual({});

    const approve = await app.inject({
      method: "POST",
      url: `/access-requests/${pending.id}/approve`,
      headers: auth(ownerToken),
      payload: {},
    });
    expect(approve.statusCode).toBe(200);

    const afterApproval = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { capabilities: true },
    });
    expect(afterApproval.capabilities).toEqual({ "/employees": ["view"] });

    // Both halves of the accountability record: who asked, and who allowed it.
    const applied = await prisma.auditLog.findFirstOrThrow({
      where: { companyId, entityId: targetId, action: "user.access.update" },
      orderBy: { timestamp: "desc" },
    });
    expect(applied.userId).toBe(ownerId);
    expect((applied.metadata as Record<string, unknown>).requestedById).toBe(managerId);
    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: { companyId, action: "user.access.request.approved" },
      })
    ).resolves.toBeTruthy();
  });

  it("applies the owner's own edits immediately, with no request raised", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/users/${targetId}`,
      headers: auth(ownerToken),
      payload: { capabilities: { "/payroll": ["view", "approve"] } },
    });
    expect(response.statusCode).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { capabilities: true },
    });
    expect(row.capabilities).toEqual({ "/payroll": ["view", "approve"] });
    expect(await prisma.accessChangeRequest.count({ where: { companyId } })).toBe(0);
  });

  it("discards the proposal on decline", async () => {
    const pending = await proposeTargetGrant({ "/employees": ["view", "edit"] });
    const decline = await app.inject({
      method: "POST",
      url: `/access-requests/${pending.id}/decline`,
      headers: auth(ownerToken),
      payload: { reviewNote: "Not needed for this role" },
    });
    expect(decline.statusCode).toBe(200);
    expect(decline.json().request.status).toBe("DECLINED");

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { capabilities: true },
    });
    expect(row.capabilities).toEqual({});
  });

  it("still refuses manage_access at submit time — approval is no way around the ceiling", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/users/${targetId}`,
      headers: auth(managerToken),
      payload: { capabilities: { "/settings/access": ["manage_access"] } },
    });
    expect(response.statusCode).toBe(403);
    expect(await prisma.accessChangeRequest.count({ where: { companyId } })).toBe(0);
  });

  it("refuses a capability the manager does not hold", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/users/${targetId}`,
      headers: auth(managerToken),
      payload: { capabilities: { "/payroll": ["view_sensitive"] } },
    });
    expect(response.statusCode).toBe(403);
    expect(await prisma.accessChangeRequest.count({ where: { companyId } })).toBe(0);
  });

  it("allows only one open proposal per target", async () => {
    await proposeTargetGrant({ "/employees": ["view"] });
    const second = await app.inject({
      method: "PUT",
      url: `/users/${targetId}`,
      headers: auth(managerToken),
      payload: { capabilities: { "/employees": ["view", "edit"] } },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().existingRequestId).toBeTruthy();
  });

  it("blocks a stale proposal until the owner acknowledges the drift", async () => {
    const pending = await proposeTargetGrant({ "/employees": ["view"] });

    // The owner changes the same person directly while the request is open.
    await prisma.user.update({
      where: { id: targetId },
      data: { capabilities: { "/payroll": ["view"] } },
    });

    const stale = await app.inject({
      method: "POST",
      url: `/access-requests/${pending.id}/approve`,
      headers: auth(ownerToken),
      payload: {},
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("stale");

    const acknowledged = await app.inject({
      method: "POST",
      url: `/access-requests/${pending.id}/approve`,
      headers: auth(ownerToken),
      payload: { acknowledgeDrift: true },
    });
    expect(acknowledged.statusCode).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { capabilities: true },
    });
    expect(row.capabilities).toEqual({ "/employees": ["view"] });
  });

  it("refuses to apply a proposal from a manager who has since been deactivated", async () => {
    const pending = await proposeTargetGrant({ "/employees": ["view"] });
    await prisma.user.update({ where: { id: managerId }, data: { isActive: false } });

    const response = await app.inject({
      method: "POST",
      url: `/access-requests/${pending.id}/approve`,
      headers: auth(ownerToken),
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("requester_ineligible");
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { capabilities: true },
    });
    expect(row.capabilities).toEqual({});
  });

  it("refuses to apply a proposal the manager could no longer make", async () => {
    const pending = await proposeTargetGrant({ "/employees": ["view", "edit"] });
    // The owner trims the manager's own grants before deciding.
    await prisma.user.update({
      where: { id: managerId },
      data: {
        capabilities: {
          "/settings/access": ["view", "create", "edit", "delete", "manage_access"],
        },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/access-requests/${pending.id}/approve`,
      headers: auth(ownerToken),
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("requester_ineligible");
  });

  it("defers a new account and returns the setup link on approval", async () => {
    const email = `mc-invitee-${suffix}@test.local`;
    const proposal = await app.inject({
      method: "POST",
      url: "/users",
      headers: auth(managerToken),
      payload: {
        name: "Invitee",
        email,
        sendSetupLink: true,
        capabilities: { "/employees": ["view"] },
      },
    });
    expect(proposal.statusCode).toBe(202);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

    const approve = await app.inject({
      method: "POST",
      url: `/access-requests/${proposal.json().request.id}/approve`,
      headers: auth(ownerToken),
      payload: {},
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().setupLink).toContain("/setup-password?token=");

    const created = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(created.capabilities).toEqual({ "/employees": ["view"] });
    await prisma.user.delete({ where: { id: created.id } });
  });

  it("refuses a deferred account creation that carries a password", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/users",
      headers: auth(managerToken),
      payload: {
        name: "Password invitee",
        email: `mc-pw-${suffix}@test.local`,
        sendSetupLink: false,
        password: "Sup3rSecret!pass",
        capabilities: {},
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("defers deactivation and revokes sessions only once approved", async () => {
    const request = await app.inject({
      method: "DELETE",
      url: `/users/${targetId}`,
      headers: auth(managerToken),
    });
    expect(request.statusCode).toBe(202);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: targetId }, select: { isActive: true } }))
        .isActive
    ).toBe(true);

    const approve = await app.inject({
      method: "POST",
      url: `/access-requests/${request.json().request.id}/approve`,
      headers: auth(ownerToken),
      payload: {},
    });
    expect(approve.statusCode).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { isActive: true, capabilities: true },
    });
    expect(row).toEqual({ isActive: false, capabilities: {} });
  });

  it("lets the requester withdraw their own proposal but not review it", async () => {
    const pending = await proposeTargetGrant({ "/employees": ["view"] });

    const selfApprove = await app.inject({
      method: "POST",
      url: `/access-requests/${pending.id}/approve`,
      headers: auth(managerToken),
      payload: {},
    });
    expect(selfApprove.statusCode).toBe(403);

    const cancel = await app.inject({
      method: "POST",
      url: `/access-requests/${pending.id}/cancel`,
      headers: auth(managerToken),
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().request.status).toBe("CANCELLED");

    const reapprove = await app.inject({
      method: "POST",
      url: `/access-requests/${pending.id}/approve`,
      headers: auth(ownerToken),
      payload: {},
    });
    expect(reapprove.statusCode).toBe(409);
    expect(reapprove.json().code).toBe("already_reviewed");
  });

  it("issues a working password reset link without locking the person out", async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { passwordHash: true },
    });

    const response = await app.inject({
      method: "POST",
      url: `/users/${targetId}/password-reset-link`,
      headers: auth(managerToken),
    });
    expect(response.statusCode).toBe(200);
    const token = new URL(response.json().setupLink).searchParams.get("token");
    expect(token).toBeTruthy();

    // Applies immediately — no approval request is raised for a reset.
    expect(await prisma.accessChangeRequest.count({ where: { companyId } })).toBe(0);
    // The existing password is untouched until the link is actually used.
    const during = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { passwordHash: true, capabilities: true },
    });
    expect(during.passwordHash).toBe(before.passwordHash);
    expect(during.capabilities).toEqual({});

    const validate = await app.inject({
      method: "POST",
      url: "/auth/setup-password/validate",
      payload: { token },
    });
    expect(validate.statusCode).toBe(200);
    expect(validate.json().valid).toBe(true);

    const complete = await app.inject({
      method: "POST",
      url: "/auth/setup-password/complete",
      payload: { token, password: "Br4ndNewPass!word" },
    });
    expect(complete.statusCode).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { passwordHash: true, passwordSetupRequired: true },
    });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.passwordSetupRequired).toBe(false);

    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: { companyId, entityId: targetId, action: "user.password.reset_link" },
      })
    ).resolves.toBeTruthy();
  });

  it("re-issuing a reset link kills the previous one", async () => {
    const first = await app.inject({
      method: "POST",
      url: `/users/${targetId}/password-reset-link`,
      headers: auth(managerToken),
    });
    const firstToken = new URL(first.json().setupLink).searchParams.get("token");
    const second = await app.inject({
      method: "POST",
      url: `/users/${targetId}/password-reset-link`,
      headers: auth(managerToken),
    });
    const secondToken = new URL(second.json().setupLink).searchParams.get("token");
    expect(secondToken).not.toBe(firstToken);

    const stale = await app.inject({
      method: "POST",
      url: "/auth/setup-password/validate",
      payload: { token: firstToken },
    });
    expect(stale.statusCode).toBe(400);
  });

  it("stops a manager resetting the owner or a peer access manager", async () => {
    const againstOwner = await app.inject({
      method: "POST",
      url: `/users/${ownerId}/password-reset-link`,
      headers: auth(managerToken),
    });
    expect(againstOwner.statusCode).toBe(403);

    await prisma.user.update({
      where: { id: targetId },
      data: { capabilities: { "/settings/access": ["view", "manage_access"] } },
    });
    const againstPeer = await app.inject({
      method: "POST",
      url: `/users/${targetId}/password-reset-link`,
      headers: auth(managerToken),
    });
    expect(againstPeer.statusCode).toBe(403);

    // The owner is not bound by the peer rule.
    const asOwner = await app.inject({
      method: "POST",
      url: `/users/${targetId}/password-reset-link`,
      headers: auth(ownerToken),
    });
    expect(asOwner.statusCode).toBe(200);
  });

  it("refuses a reset link for a deactivated account", async () => {
    await prisma.user.update({ where: { id: targetId }, data: { isActive: false } });
    const response = await app.inject({
      method: "POST",
      url: `/users/${targetId}/password-reset-link`,
      headers: auth(managerToken),
    });
    expect(response.statusCode).toBe(400);
  });

  it("shows a manager only their own requests, and the owner everything", async () => {
    await proposeTargetGrant({ "/employees": ["view"] });

    const asManager = await app.inject({
      method: "GET",
      url: "/access-requests?status=PENDING",
      headers: auth(managerToken),
    });
    expect(asManager.statusCode).toBe(200);
    expect(asManager.json().canReview).toBe(false);
    expect(asManager.json().data).toHaveLength(1);

    const asOwner = await app.inject({
      method: "GET",
      url: "/access-requests?status=PENDING",
      headers: auth(ownerToken),
    });
    expect(asOwner.json().canReview).toBe(true);
    expect(asOwner.json().pendingCount).toBe(1);
  });
});
