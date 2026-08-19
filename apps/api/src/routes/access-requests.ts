import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccessChangeStatus } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireCapability, requireOwner } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { badRequest } from "../lib/api-response.js";
import { buildPasswordSetupLink } from "../lib/setup-link.js";
import {
  applyUserCreate,
  applyUserDeactivate,
  applyUserUpdate,
  checkUserCreateAllowed,
  checkUserDeactivateAllowed,
  checkUserUpdateAllowed,
  loadAccessActor,
  loadAccessTarget,
  type AccessChangeSource,
  type UserCreatePayload,
  type UserUpdatePayload,
} from "../services/user-access.service.js";
import {
  closeAccessChangeRequest,
  describeAccessChange,
  findAccessChangeRequest,
  hasDrifted,
  listAccessChangeRequests,
  notifyRequester,
  type AccessBeforeState,
} from "../services/access-change.service.js";

/**
 * The owner's side of the access maker-checker. Access managers raise proposals
 * through the normal /users mutations; this module is where the company owner
 * approves or declines them, and it is the only place a proposal is ever applied.
 */

const decisionSchema = z.object({
  reviewNote: z.string().trim().max(500).optional(),
  /** Required to apply a proposal whose target has changed since it was raised. */
  acknowledgeDrift: z.boolean().optional().default(false),
});

const STATUSES = ["PENDING", "APPROVED", "DECLINED", "CANCELLED"] as const;

export async function accessRequestsRoutes(app: FastifyInstance) {
  const viewAccess = [authMiddleware, requireCapability("/settings/access", "view")];
  const ownerOnly = [authMiddleware, requireOwner()];

  app.get("/", { preHandler: viewAccess }, async (request, reply) => {
    const query = request.query as { status?: string; limit?: string };
    const status = (STATUSES as readonly string[]).includes(query.status ?? "")
      ? (query.status as AccessChangeStatus)
      : undefined;

    const items = await listAccessChangeRequests({
      companyId: request.user!.companyId,
      status,
      // Only the owner reviews, so anyone else sees just what they proposed.
      ...(request.user!.isOwner ? {} : { requestedById: request.user!.sub }),
      limit: Math.min(Math.max(Number(query.limit) || 50, 1), 200),
    });

    const pendingCount = await prisma.accessChangeRequest.count({
      where: {
        companyId: request.user!.companyId,
        status: "PENDING",
        ...(request.user!.isOwner ? {} : { requestedById: request.user!.sub }),
      },
    });

    return reply.send({ data: items, pendingCount, canReview: Boolean(request.user!.isOwner) });
  });

  app.post("/:id/approve", { preHandler: ownerOnly }, async (request, reply) => {
    const parsed = decisionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, "Invalid review");
    const companyId = request.user!.companyId;
    const row = await findAccessChangeRequest(companyId, (request.params as { id: string }).id);
    if (!row) return reply.code(404).send({ error: "Access change request not found" });
    if (row.status !== "PENDING") {
      return reply.code(409).send({
        error: "Conflict",
        code: "already_reviewed",
        message: `This request was already ${row.status.toLowerCase()}.`,
      });
    }
    if (row.requestedById === request.user!.sub) {
      return reply.code(403).send({
        error: "Forbidden",
        code: "self_approve",
        message: "You cannot approve your own request",
      });
    }

    // The proposal only stands if whoever raised it could still raise it today.
    const requester = await loadAccessActor(companyId, row.requestedById);
    if (!requester || !requester.isActive) {
      return reply.code(409).send({
        error: "Conflict",
        code: "requester_ineligible",
        message: "The person who raised this request no longer has an active account.",
      });
    }

    const before = (row.beforeState ?? {}) as unknown as AccessBeforeState;
    const target = row.targetUserId ? await loadAccessTarget(companyId, row.targetUserId) : null;
    if (row.targetUserId && !target) {
      return reply.code(409).send({
        error: "Conflict",
        code: "target_missing",
        message: "The account this request targets no longer exists.",
      });
    }
    const drifted = hasDrifted(before, target);
    if (drifted && !parsed.data.acknowledgeDrift) {
      return reply.code(409).send({
        error: "Conflict",
        code: "stale",
        message:
          "This person's access changed after the request was raised. Review the current state before applying it.",
        current: describeAccessChange(row).diff,
      });
    }

    const source: AccessChangeSource = {
      requestId: row.id,
      requestedById: row.requestedById,
      requestedByEmail: row.requestedBy.email,
      ...(drifted ? { driftAcknowledged: true } : {}),
    };

    // Re-run the guards against the requester as they are now: a manager whose
    // own grants were cut must not have their proposal go through regardless.
    if (row.kind === "CREATE_USER") {
      const payload = row.payload as unknown as UserCreatePayload;
      const guard = checkUserCreateAllowed(requester, payload.capabilities);
      if (guard) {
        return reply.code(409).send({
          error: "Conflict",
          code: "requester_ineligible",
          message: `${row.requestedBy.name} can no longer assign this access: ${guard.message}`,
        });
      }
      try {
        const result = await prisma.$transaction(async (tx) => {
          const created = await applyUserCreate(request, tx, {
            companyId,
            payload: { ...payload, sendSetupLink: true, password: undefined },
            source,
          });
          const updatedRequest = await closeAccessChangeRequest(request, tx, {
            row,
            status: "APPROVED",
            reviewNote: parsed.data.reviewNote,
            metadata: { createdUserId: created.user.id },
          });
          return { created, updatedRequest };
        });
        await notifyRequester({ companyId, row, status: "APPROVED", reviewNote: parsed.data.reviewNote });
        return reply.send({
          request: describeAccessChange(result.updatedRequest),
          user: { ...result.created.user, isOwner: false },
          ...(result.created.setupToken
            ? { setupLink: buildPasswordSetupLink(request, result.created.setupToken) }
            : {}),
        });
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
          return reply.code(409).send({
            error: "Conflict",
            code: "email_taken",
            message:
              "That email now belongs to another account. Decline this request and ask for a fresh one.",
          });
        }
        throw error;
      }
    }

    if (row.kind === "DEACTIVATE_USER") {
      const guard = checkUserDeactivateAllowed(requester, target!);
      if (guard) {
        return reply.code(409).send({
          error: "Conflict",
          code: "requester_ineligible",
          message: `${row.requestedBy.name} can no longer make this change: ${guard.message}`,
        });
      }
      const updatedRequest = await prisma.$transaction(async (tx) => {
        await applyUserDeactivate(request, tx, { id: target!.id, existing: target!, source });
        return closeAccessChangeRequest(request, tx, {
          row,
          status: "APPROVED",
          reviewNote: parsed.data.reviewNote,
        });
      });
      await notifyRequester({ companyId, row, status: "APPROVED", reviewNote: parsed.data.reviewNote });
      return reply.send({ request: describeAccessChange(updatedRequest) });
    }

    const payload = row.payload as unknown as UserUpdatePayload;
    const guard = checkUserUpdateAllowed(requester, target!, payload);
    if (guard) {
      return reply.code(409).send({
        error: "Conflict",
        code: "requester_ineligible",
        message: `${row.requestedBy.name} can no longer make this change: ${guard.message}`,
      });
    }
    try {
      const result = await prisma.$transaction(async (tx) => {
        const user = await applyUserUpdate(request, tx, {
          id: target!.id,
          existing: target!,
          payload,
          source,
        });
        const updatedRequest = await closeAccessChangeRequest(request, tx, {
          row,
          status: "APPROVED",
          reviewNote: parsed.data.reviewNote,
        });
        return { user, updatedRequest };
      });
      await notifyRequester({ companyId, row, status: "APPROVED", reviewNote: parsed.data.reviewNote });
      return reply.send({
        request: describeAccessChange(result.updatedRequest),
        user: { ...result.user, isOwner: target!.isOwner },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return reply.code(409).send({
          error: "Conflict",
          code: "email_taken",
          message: "That email now belongs to another account.",
        });
      }
      throw error;
    }
  });

  app.post("/:id/decline", { preHandler: ownerOnly }, async (request, reply) => {
    const parsed = decisionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, "Invalid review");
    const companyId = request.user!.companyId;
    const row = await findAccessChangeRequest(companyId, (request.params as { id: string }).id);
    if (!row) return reply.code(404).send({ error: "Access change request not found" });
    if (row.status !== "PENDING") {
      return reply.code(409).send({
        error: "Conflict",
        code: "already_reviewed",
        message: `This request was already ${row.status.toLowerCase()}.`,
      });
    }

    const updated = await prisma.$transaction(async (tx) =>
      closeAccessChangeRequest(request, tx, {
        row,
        status: "DECLINED",
        reviewNote: parsed.data.reviewNote,
      })
    );
    await notifyRequester({ companyId, row, status: "DECLINED", reviewNote: parsed.data.reviewNote });
    return reply.send({ request: describeAccessChange(updated) });
  });

  /** Withdrawing a proposal: the requester who raised it, or the owner. */
  app.post(
    "/:id/cancel",
    { preHandler: [authMiddleware, requireCapability("/settings/access", "manage_access")] },
    async (request, reply) => {
      const companyId = request.user!.companyId;
      const row = await findAccessChangeRequest(companyId, (request.params as { id: string }).id);
      if (!row) return reply.code(404).send({ error: "Access change request not found" });
      if (row.requestedById !== request.user!.sub && !request.user!.isOwner) {
        return reply.code(403).send({
          error: "Forbidden",
          message: "Only the person who raised this request, or the owner, can withdraw it",
        });
      }
      if (row.status !== "PENDING") {
        return reply.code(409).send({
          error: "Conflict",
          code: "already_reviewed",
          message: `This request was already ${row.status.toLowerCase()}.`,
        });
      }
      const updated = await prisma.$transaction(async (tx) =>
        closeAccessChangeRequest(request, tx, { row, status: "CANCELLED" })
      );
      return reply.send({ request: describeAccessChange(updated) });
    }
  );
}
