import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authProtect } from "../../middleware/auth-protect.js";
import { requirePermission } from "../../middleware/permissions.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  createApprovalRequest,
  listApprovals,
  reviewApproval,
} from "./approvals.service.js";

const ROLES = [
  "admin",
  "operations_manager",
  "hr_payroll",
  "supervisor",
] as const;

const reviewBodySchema = z.object({
  action: z.enum(["approve", "reject", "query"]),
  comment: z.string().max(2000).optional(),
});

const createBodySchema = z.object({
  approvalType: z.enum([
    "ATTENDANCE_EXCEPTION",
    "MISSED_CLOCK_IN",
    "MISSED_CLOCK_OUT",
    "OVERTIME",
    "LEAVE",
    "SICK_NOTE",
    "SITE_TIMESHEET",
    "INCIDENT",
    "TASK_COMPLETION",
    "PAYROLL_READINESS",
    "DOCUMENT_REVIEW",
    "ACCESS_CHANGE",
    "PAYROLL_APPROVAL",
    "ROSTER_PUBLICATION",
    "SETTINGS_CHANGE",
    "DATA_IMPORT",
    "DESTRUCTIVE_ACTION",
    "DATA_QUALITY_RESOLUTION",
  ]),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  approverId: z.string().optional().nullable(),
  comment: z.string().max(2000).optional(),
  reason: z.string().min(5).max(2000).optional(),
  payload: z.record(z.unknown()).optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
});

export async function approvalsRoutes(app: FastifyInstance) {
  const readProtect = [...authProtect, requirePermission(PERMISSIONS.APPROVALS_READ)];
  const reviewProtect = [...authProtect, requirePermission(PERMISSIONS.APPROVALS_REVIEW)];

  app.get("/", { preHandler: readProtect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as {
      status?: string;
      approvalType?: string;
      mine?: string;
    };
    const result = await listApprovals(user.companyId, {
      status: q.status as never,
      approvalType: q.approvalType as never,
      approverId: q.mine === "true" ? user.sub : undefined,
    });
    return reply.send(result);
  });

  app.post("/", { preHandler: reviewProtect }, async (request, reply) => {
    const user = request.user!;
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.errors[0]?.message ?? "Invalid body",
      });
    }
    const approval = await createApprovalRequest({
      companyId: user.companyId,
      requestedById: user.sub,
      ...parsed.data,
    });
    return reply.code(201).send(approval);
  });

  app.post("/:id/review", { preHandler: reviewProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = reviewBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.errors[0]?.message ?? "Invalid body",
      });
    }
    const result = await reviewApproval({
      companyId: user.companyId,
      approvalId: id,
      reviewerId: user.sub,
      action: parsed.data.action,
      comment: parsed.data.comment,
    });
    if (result.error === "not_found") {
      return reply.code(404).send({ error: "Not found", message: "Approval not found" });
    }
    if (result.error === "self_approve") {
      return reply.code(403).send({
        error: "Forbidden",
        message: "You cannot approve your own request",
      });
    }
    if (result.error === "already_reviewed") {
      return reply.code(409).send({
        error: "Conflict",
        message: "This approval was already reviewed",
        approval: result.approval,
      });
    }
    return reply.send(result.approval);
  });
}
