import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { academyProtect } from "./constants.js";

const schema = z.object({
  alertType: z.string().trim().min(1, "alertType is required"),
  title: z.string().trim().min(1, "title is required"),
  dueDate: z.string().min(1),
  severity: z.enum(["green", "amber", "red"]).optional(),
  status: z.string().optional(),
  relatedId: z.string().trim().min(1, "relatedId cannot be empty").optional().nullable(),
  notes: z.string().optional().nullable(),
});
const patchSchema = schema.partial();

function computeSeverity(dueDate: Date): "green" | "amber" | "red" {
  const now = new Date();
  const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 14) return "red";
  if (diffDays <= 45) return "amber";
  return "green";
}

async function validateRenewalRelatedEntity(
  companyId: string,
  alertType: string,
  relatedId?: string | null
): Promise<boolean> {
  if (!relatedId) return true;

  const normalized = alertType.toLowerCase();
  if (normalized.includes("certificate")) {
    const cert = await prisma.academyCertificate.findFirst({
      where: { id: relatedId, companyId },
      select: { id: true },
    });
    if (cert) return true;
  } else if (
    normalized.includes("instructor") ||
    normalized.includes("accreditation") ||
    normalized.includes("contract")
  ) {
    const inst = await prisma.academyInstructor.findFirst({
      where: { id: relatedId, companyId },
      select: { id: true },
    });
    if (inst) return true;
  } else if (normalized.includes("compliance") || normalized.includes("document")) {
    const doc = await prisma.academyComplianceDocument.findFirst({
      where: { id: relatedId, companyId },
      select: { id: true },
    });
    if (doc) return true;
  }

  // Fallback: check across supported entity types in tenant
  const [cert, inst, compDoc, courseRun, student] = await Promise.all([
    prisma.academyCertificate.findFirst({ where: { id: relatedId, companyId }, select: { id: true } }),
    prisma.academyInstructor.findFirst({ where: { id: relatedId, companyId }, select: { id: true } }),
    prisma.academyComplianceDocument.findFirst({ where: { id: relatedId, companyId }, select: { id: true } }),
    prisma.courseRun.findFirst({ where: { id: relatedId, companyId }, select: { id: true } }),
    prisma.student.findFirst({ where: { id: relatedId, companyId }, select: { id: true } }),
  ]);

  return !!(cert || inst || compDoc || courseRun || student);
}

export async function academyRenewalsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 100, 300);
    const offset = Number(q.offset) || 0;
    const where = {
      companyId,
      ...(q.severity ? { severity: q.severity as "green" | "amber" | "red" } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.alertType ? { alertType: q.alertType } : {}),
    };
    const [alerts, total] = await Promise.all([
      prisma.academyRenewalAlert.findMany({ where, orderBy: [{ dueDate: "asc" }, { severity: "desc" }], take: limit, skip: offset }),
      prisma.academyRenewalAlert.count({ where }),
    ]);
    return { alerts, total, limit, offset };
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const alert = await prisma.academyRenewalAlert.findFirst({ where: { id, companyId } });
    if (!alert) return reply.code(404).send({ error: "Not found", message: "Alert not found" });
    return { alert };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const d = parsed.data;

    if (d.relatedId) {
      const valid = await validateRenewalRelatedEntity(companyId, d.alertType, d.relatedId);
      if (!valid) {
        return reply.code(400).send({
          error: "Validation error",
          message: "relatedId not found in company",
          statusCode: 400,
        });
      }
    }

    const dueDate = new Date(d.dueDate);
    const alert = await prisma.academyRenewalAlert.create({
      data: {
        companyId,
        alertType: d.alertType,
        title: d.title,
        dueDate,
        severity: d.severity ?? computeSeverity(dueDate),
        status: d.status ?? "open",
        relatedId: d.relatedId,
        notes: d.notes,
      },
    });
    await createAuditLog({ userId, companyId, action: "academy.renewal.create", entityType: "AcademyRenewalAlert", entityId: alert.id });
    return reply.code(201).send({ alert });
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const existing = await prisma.academyRenewalAlert.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Not found", message: "Alert not found" });
    const d = parsed.data;

    const alertType = d.alertType ?? existing.alertType;
    if (d.relatedId !== undefined && d.relatedId) {
      const valid = await validateRenewalRelatedEntity(companyId, alertType, d.relatedId);
      if (!valid) {
        return reply.code(400).send({
          error: "Validation error",
          message: "relatedId not found in company",
          statusCode: 400,
        });
      }
    }

    const dueDate = d.dueDate ? new Date(d.dueDate) : existing.dueDate;
    const alert = await prisma.academyRenewalAlert.update({ where: { id }, data: { ...d, dueDate: d.dueDate ? dueDate : undefined, severity: d.severity ?? computeSeverity(dueDate) } });
    await createAuditLog({ userId, companyId, action: "academy.renewal.update", entityType: "AcademyRenewalAlert", entityId: id });
    return { alert };
  });

  app.delete("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const existing = await prisma.academyRenewalAlert.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Not found", message: "Alert not found" });
    await prisma.academyRenewalAlert.delete({ where: { id } });
    await createAuditLog({ userId, companyId, action: "academy.renewal.delete", entityType: "AcademyRenewalAlert", entityId: id });
    return reply.code(204).send();
  });
}
