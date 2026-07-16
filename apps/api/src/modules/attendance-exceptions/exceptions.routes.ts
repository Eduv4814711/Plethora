import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import { accessMiddleware, requirePermission } from "../../middleware/permissions.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import {
  detectExceptionsBodySchema,
  listExceptionsQuerySchema,
  reviewExceptionBodySchema,
} from "./exceptions.schemas.js";
import {
  detectAndPersistExceptions,
  getExceptionAnalytics,
  getPayrollReadiness,
  listExceptions,
  refreshPayrollReadiness,
  reviewException,
} from "./exceptions.service.js";

export async function attendanceExceptionsRoutes(app: FastifyInstance) {
  const readProtect = [authMiddleware, accessMiddleware, requirePermission(PERMISSIONS.ATTENDANCE_READ)];
  const protect = [authMiddleware, accessMiddleware, requirePermission(PERMISSIONS.ATTENDANCE_MANAGE)];

  app.get("/", { preHandler: readProtect }, async (request, reply) => {
    const user = request.user!;
    const parsed = listExceptionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.errors[0]?.message ?? "Invalid query",
      });
    }
    const result = await listExceptions(user.companyId, parsed.data);
    return reply.send(result);
  });

  app.get("/analytics", { preHandler: readProtect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { periodStart?: string; periodEnd?: string };
    const analytics = await getExceptionAnalytics(
      user.companyId,
      q.periodStart ? new Date(q.periodStart) : undefined,
      q.periodEnd ? new Date(q.periodEnd) : undefined
    );
    return reply.send(analytics);
  });

  app.get("/payroll-readiness", { preHandler: readProtect }, async (request, reply) => {
    const user = request.user!;
    const readiness = await getPayrollReadiness(user.companyId);
    return reply.send(readiness ?? { status: "PENDING_ATTENDANCE_REVIEW", openExceptions: 0 });
  });

  app.post("/detect", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const parsed = detectExceptionsBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.errors[0]?.message ?? "Invalid body",
      });
    }
    const result = await detectAndPersistExceptions({
      companyId: user.companyId,
      ...parsed.data,
    });
    return reply.send(result);
  });

  app.post("/payroll-readiness/refresh", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const result = await refreshPayrollReadiness(user.companyId);
    return reply.send(result);
  });

  app.patch("/:id/review", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = reviewExceptionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.errors[0]?.message ?? "Invalid body",
      });
    }
    const updated = await reviewException({
      companyId: user.companyId,
      exceptionId: id,
      userId: user.sub,
      action: parsed.data.action,
      reviewNote: parsed.data.reviewNote,
    });
    if (!updated) {
      return reply.code(404).send({ error: "Not found", message: "Exception not found" });
    }
    return reply.send(updated);
  });
}
