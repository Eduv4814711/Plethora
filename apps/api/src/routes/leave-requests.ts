import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import {
  approveLeaveRequest,
  rejectLeaveRequest,
  LeaveRequestError,
} from "../services/leave-request.service.js";
import { createAuditLog } from "../lib/audit.js";

export async function leaveRequestsRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireRole(["admin", "operations_manager", "hr_payroll"], {
      anyOfModules: ["/employees/leave", "/payroll"],
    }),
  ];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const status = q.status;
    const employeeId = q.employeeId;

    const where: Record<string, unknown> = {
      employee: { companyId: user.companyId },
    };
    if (status) where.status = status;
    if (employeeId) where.employeeId = employeeId;

    const records = await prisma.leaveRequest.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return reply.send({ data: records });
  });

  app.post("/:id/approve", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    try {
      await approveLeaveRequest(id, user.companyId, user.sub);
    } catch (err) {
      if (err instanceof LeaveRequestError) {
        return reply.code(400).send({
          error: "Approval failed",
          message: err.message,
        });
      }
      throw err;
    }

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "leave_request.approve",
      entityType: "leave_request",
      entityId: id,
    });

    const updated = await prisma.leaveRequest.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
      },
    });

    return reply.send(updated);
  });

  app.post("/:id/reject", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    try {
      await rejectLeaveRequest(id, user.companyId, user.sub);
    } catch (err) {
      if (err instanceof LeaveRequestError) {
        return reply.code(400).send({
          error: "Rejection failed",
          message: err.message,
        });
      }
      throw err;
    }

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "leave_request.reject",
      entityType: "leave_request",
      entityId: id,
    });

    const updated = await prisma.leaveRequest.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
      },
    });

    return reply.send(updated);
  });
}
