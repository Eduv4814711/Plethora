import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import type { AcademyStudentDocumentType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import {
  academyProtect,
  ACADEMY_DOCUMENT_ALLOWED_TYPES,
  ACADEMY_MAX_FILE_BYTES,
} from "./constants.js";
import { readStreamToBuffer, storage } from "../../lib/storage.js";

const documentTypeSchema = z.enum([
  "id_copy",
  "proof_of_address",
  "passport_permit",
  "qualification",
  "application_form",
  "payment_proof",
  "consent",
  "psira_other",
  "other",
]) satisfies z.ZodType<AcademyStudentDocumentType>;

export async function academyStudentDocumentsRoutes(app: FastifyInstance) {
  app.get("/:studentId/documents", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { studentId } = request.params as { studentId: string };
    const student = await prisma.student.findFirst({
      where: { id: studentId, companyId },
      select: { id: true },
    });
    if (!student) {
      return reply.code(404).send({ error: "Not found", message: "Student not found" });
    }
    const documents = await prisma.studentDocument.findMany({
      where: { studentId, companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { uploadedBy: { select: { id: true, name: true, email: true } } },
    });
    return { documents };
  });

  app.post("/:studentId/documents", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { studentId } = request.params as { studentId: string };

    const student = await prisma.student.findFirst({
      where: { id: studentId, companyId },
      select: { id: true },
    });
    if (!student) {
      return reply.code(404).send({ error: "Not found", message: "Student not found" });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "No file", message: "Please attach a file" });
    }

    const mimetype = data.mimetype;
    if (
      !ACADEMY_DOCUMENT_ALLOWED_TYPES.includes(mimetype as (typeof ACADEMY_DOCUMENT_ALLOWED_TYPES)[number]) &&
      !mimetype.startsWith("image/")
    ) {
      return reply.code(400).send({
        error: "Invalid file type",
        message: "Allowed: images, PDF, Word, Excel, text, CSV",
      });
    }

    const q = request.query as Record<string, string | undefined>;
    let documentType: AcademyStudentDocumentType = "other";
    const rawType = q.documentType;
    if (rawType) {
      const parsed = documentTypeSchema.safeParse(rawType);
      if (parsed.success) documentType = parsed.data;
    }

    const ext = mimetype.split("/")[1]?.replace("jpeg", "jpg") || "bin";
    const filename = `${randomUUID()}.${ext}`;
    const storagePath = `academy/${companyId}/${studentId}/${filename}`;

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readStreamToBuffer(data.file, ACADEMY_MAX_FILE_BYTES);
    } catch (err) {
      if (err instanceof Error && err.message === "FILE_TOO_LARGE") {
        return reply.code(400).send({
          error: "File too large",
          message: "Maximum file size is 10MB",
        });
      }
      request.log.error(err);
      return reply.code(500).send({ error: "Upload failed", message: "Could not read the file" });
    }

    try {
      await storage.uploadFile({
        key: storagePath,
        body: fileBuffer,
        contentType: mimetype,
      });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: "Upload failed", message: "Could not save the file" });
    }

    const size = fileBuffer.length;

    const originalName = data.filename || filename;
    const doc = await prisma.studentDocument.create({
      data: {
        companyId,
        studentId,
        documentType,
        fileName: originalName,
        mimeType: mimetype,
        sizeBytes: size,
        storagePath,
        uploadedByUserId: userId,
      },
    });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.student_document.create",
      entityType: "StudentDocument",
      entityId: doc.id,
      metadata: { studentId, documentType, fileName: originalName },
    });

    return reply.code(201).send({ document: doc });
  });

  app.delete("/:studentId/documents/:documentId", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { studentId, documentId } = request.params as { studentId: string; documentId: string };

    const doc = await prisma.studentDocument.findFirst({
      where: { id: documentId, studentId, companyId, deletedAt: null },
    });
    if (!doc) {
      return reply.code(404).send({ error: "Not found", message: "Document not found" });
    }

    await prisma.studentDocument.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.student_document.soft_delete",
      entityType: "StudentDocument",
      entityId: documentId,
      metadata: { studentId, storagePath: doc.storagePath },
    });

    return { ok: true };
  });
}
