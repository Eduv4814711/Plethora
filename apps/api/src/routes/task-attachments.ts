import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { readStreamToBuffer, storage } from "../lib/storage.js";

const TASK_ROLES = ["admin", "operations_manager", "hr_payroll", "supervisor"] as const;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];

export async function taskAttachmentsRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole([...TASK_ROLES], { module: "/tasks" })];

  app.post("/tasks/:taskId/attachments", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const userId = request.user!.sub!;
    const { taskId } = request.params as { taskId: string };

    const task = await prisma.task.findFirst({
      where: { id: taskId, companyId: user.companyId },
    });

    if (!task) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const data = await request.file();

    if (!data) {
      return reply.code(400).send({
        error: "No file",
        message: "Please select a file to upload",
      });
    }

    const mimetype = data.mimetype;
    if (!ALLOWED_TYPES.includes(mimetype) && !mimetype.startsWith("image/")) {
      return reply.code(400).send({
        error: "Invalid file type",
        message: "Allowed: images, PDF, Word, Excel, text, CSV",
      });
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readStreamToBuffer(data.file, MAX_FILE_SIZE);
    } catch (err) {
      if (err instanceof Error && err.message === "FILE_TOO_LARGE") {
        return reply.code(400).send({
          error: "File too large",
          message: "Maximum file size is 10MB",
        });
      }
      request.log.error(err);
      return reply.code(500).send({
        error: "Upload failed",
        message: "Could not read the file",
      });
    }

    const ext = mimetype.split("/")[1]?.replace("jpeg", "jpg") || "bin";
    const filename = `${randomUUID()}.${ext}`;
    const key = `tasks/${user.companyId}/${taskId}/${filename}`;

    try {
      await storage.uploadFile({
        key,
        body: fileBuffer,
        contentType: mimetype,
      });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({
        error: "Upload failed",
        message: "Could not save the file",
      });
    }

    const url = storage.getAssetUrl(key);

    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId,
        filename: data.filename || filename,
        mimeType: mimetype,
        size: fileBuffer.length,
        url,
        uploadedById: userId,
      },
    });

    return reply.code(201).send(attachment);
  });

  app.delete("/attachments/:id", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const attachment = await prisma.taskAttachment.findFirst({
      where: { id },
      include: { task: true },
    });

    if (!attachment || attachment.task.companyId !== user.companyId) {
      return reply.code(404).send({ error: "Not found", message: "Attachment not found" });
    }

    const key = storage.resolveKeyFromUrl(attachment.url);
    if (key) {
      try {
        await storage.deleteFile(key);
      } catch {
        // Ignore missing objects
      }
    }

    await prisma.taskAttachment.delete({ where: { id } });

    return reply.code(204).send();
  });
}
