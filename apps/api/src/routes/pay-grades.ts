import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const createPayGradeSchema = z.object({
  name: z.string().min(1),
  hourlyRate: z.number().positive(),
  sortOrder: z.number().int().min(0).optional(),
  groupId: z.string().optional().nullable(),
});

const updatePayGradeSchema = createPayGradeSchema.partial();

export async function payGradesRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "hr_payroll"])];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { groupId?: string };
    const where: { companyId: string; groupId?: null | { equals: string } } = {
      companyId: user.companyId,
    };
    if (q.groupId) {
      where.groupId = { equals: q.groupId };
    } else {
      where.groupId = null;
    }
    const grades = await prisma.payGrade.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return reply.send({ data: grades });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b3473e'},body:JSON.stringify({sessionId:'b3473e',location:'pay-grades.ts:POST:entry',message:'Pay grade create reached',data:{userRole:request.user?.role,companyId:request.user?.companyId},hypothesisId:'H1,H4,H5',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const parsed = createPayGradeSchema.safeParse(request.body);
    if (!parsed.success) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b3473e'},body:JSON.stringify({sessionId:'b3473e',location:'pay-grades.ts:POST:validationFail',message:'Validation failed',data:{errors:parsed.error.flatten().fieldErrors},hypothesisId:'H4',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const groupId = parsed.data.groupId ?? null;
    if (groupId) {
      const group = await prisma.employeeGroup.findFirst({
        where: { id: groupId, companyId },
      });
      if (!group) {
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b3473e'},body:JSON.stringify({sessionId:'b3473e',location:'pay-grades.ts:POST:groupNotFound',message:'Group not found',data:{groupId},hypothesisId:'H4',timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return reply.code(404).send({ error: "Employee group not found" });
      }
    }
    const grade = await prisma.payGrade.create({
      data: {
        companyId,
        groupId,
        name: parsed.data.name,
        hourlyRate: parsed.data.hourlyRate,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "pay_grade.create",
      entityType: "pay_grade",
      entityId: grade.id,
    });

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b3473e'},body:JSON.stringify({sessionId:'b3473e',location:'pay-grades.ts:POST:success',message:'Pay grade created',data:{gradeId:grade.id},hypothesisId:'H5',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return reply.code(201).send(grade);
  });

  app.put("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updatePayGradeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const existing = await prisma.payGrade.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Pay grade not found" });
    }

    const grade = await prisma.payGrade.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.hourlyRate !== undefined && { hourlyRate: parsed.data.hourlyRate }),
        ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "pay_grade.update",
      entityType: "pay_grade",
      entityId: id,
    });

    return reply.send(grade);
  });

  app.delete("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.user!.companyId;

    const existing = await prisma.payGrade.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Pay grade not found" });
    }

    await prisma.payGrade.delete({ where: { id } });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "pay_grade.delete",
      entityType: "pay_grade",
      entityId: id,
    });

    return reply.send({ success: true });
  });
}
