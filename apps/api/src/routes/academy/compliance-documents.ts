import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { academyProtect } from "./constants.js";

const schema = z.object({
  documentName: z.string().min(1),
  documentType: z.string().min(1),
  issueDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  status: z.enum(["active", "expired", "pending_review", "missing"]).optional(),
  notes: z.string().optional().nullable(),
});
const patchSchema = schema.partial();

function parseDate(v?: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function deriveStatus(expiryDate?: Date | null, explicit?: "active" | "expired" | "pending_review" | "missing") {
  if (explicit) return explicit;
  if (!expiryDate) return "pending_review" as const;
  return expiryDate < new Date() ? ("expired" as const) : ("active" as const);
}

function withoutFilePath<T extends { filePath: string | null }>(document: T): Omit<T, "filePath"> {
  const { filePath: _filePath, ...metadata } = document;
  return metadata;
}

export async function academyComplianceDocumentsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 100, 200);
    const offset = Number(q.offset) || 0;
    const where = {
      companyId,
      ...(q.status ? { status: q.status as "active" | "expired" | "pending_review" | "missing" } : {}),
      ...(q.documentType ? { documentType: q.documentType } : {}),
      ...(q.search ? { documentName: { contains: q.search, mode: "insensitive" as const } } : {}),
    };
    const [documents, total] = await Promise.all([
      prisma.academyComplianceDocument.findMany({ where, include: { verifiedBy: { select: { id: true, name: true } } }, orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }], take: limit, skip: offset }),
      prisma.academyComplianceDocument.count({ where }),
    ]);
    return { documents: documents.map(withoutFilePath), total, limit, offset };
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const document = await prisma.academyComplianceDocument.findFirst({ where: { id, companyId }, include: { verifiedBy: { select: { id: true, name: true } } } });
    if (!document) return reply.code(404).send({ error: "Not found", message: "Document not found" });
    return { document: withoutFilePath(document) };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const d = parsed.data;
    const expiryDate = parseDate(d.expiryDate);
    const doc = await prisma.academyComplianceDocument.create({
      data: {
        companyId,
        documentName: d.documentName,
        documentType: d.documentType,
        issueDate: parseDate(d.issueDate),
        expiryDate,
        status: deriveStatus(expiryDate, d.status),
        notes: d.notes,
      },
    });
    await createAuditLog({ userId, companyId, action: "academy.compliance.create", entityType: "AcademyComplianceDocument", entityId: doc.id });
    return reply.code(201).send({ document: withoutFilePath(doc) });
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const existing = await prisma.academyComplianceDocument.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Not found", message: "Document not found" });
    const d = parsed.data;
    const expiryDate = d.expiryDate === undefined ? existing.expiryDate : parseDate(d.expiryDate);
    const document = await prisma.academyComplianceDocument.update({
      where: { id },
      data: {
        ...d,
        issueDate: d.issueDate === undefined ? undefined : parseDate(d.issueDate),
        expiryDate: d.expiryDate === undefined ? undefined : parseDate(d.expiryDate),
        status: deriveStatus(expiryDate, d.status),
        ...(d.status ? { verifiedByUserId: userId, verifiedDate: new Date() } : {}),
      },
    });
    await createAuditLog({ userId, companyId, action: "academy.compliance.update", entityType: "AcademyComplianceDocument", entityId: id });
    return { document: withoutFilePath(document) };
  });

  app.delete("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const existing = await prisma.academyComplianceDocument.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Not found", message: "Document not found" });
    await prisma.academyComplianceDocument.delete({ where: { id } });
    await createAuditLog({ userId, companyId, action: "academy.compliance.delete", entityType: "AcademyComplianceDocument", entityId: id });
    return reply.code(204).send();
  });
}
