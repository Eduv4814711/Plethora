import type { FastifyInstance } from "fastify";
import { createWriteStream } from "fs";
import { mkdir, stat } from "fs/promises";
import { join } from "path";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { uploadsRoot } from "../lib/uploads-root.js";

const TASK_ROLES = ["admin", "operations_manager", "hr_payroll", "supervisor"] as const;

const UPLOADS_BASE = join(uploadsRoot, "tasks");
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

    const ext = mimetype.split("/")[1]?.replace("jpeg", "jpg") || "bin";
    const filename = `${randomUUID()}.${ext}`;
    const dir = join(UPLOADS_BASE, user.companyId, taskId);
    await mkdir(dir, { recursive: true });
    const filepath = join(dir, filename);

    try {
      const writeStream = createWriteStream(filepath);
      await pipeline(data.file, writeStream);
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({
        error: "Upload failed",
        message: "Could not save the file",
      });
    }

    let size: number;
    try {
      const st = await stat(filepath);
      size = st.size;
    } catch {
      size = 0;
    }

    if (size > MAX_FILE_SIZE) {
      const { unlink } = await import("fs/promises");
      await unlink(filepath).catch(() => {});
      return reply.code(400).send({
        error: "File too large",
        message: "Maximum file size is 10MB",
      });
    }

    const url = `/uploads/tasks/${user.companyId}/${taskId}/${filename}`;

    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId,
        filename: data.filename || filename,
        mimeType: mimetype,
        size,
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

    const pathParts = attachment.url.split("/");
    const filename = pathParts[pathParts.length - 1];
    const filepath = join(UPLOADS_BASE, user.companyId, attachment.taskId, filename);

    try {
      const { unlink } = await import("fs/promises");
      await unlink(filepath);
    } catch {
      // Ignore if file doesn't exist
    }

    await prisma.taskAttachment.delete({ where: { id } });

    return reply.code(204).send();
  });
}
