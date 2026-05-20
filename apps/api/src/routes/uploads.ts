import type { FastifyInstance } from "fastify";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { pipeline } from "stream/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { authMiddleware } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/rbac.js";
import { uploadsRoot } from "../lib/uploads-root.js";
import { extensionForMime, matchesMagicBytes } from "../lib/upload-validation.js";

const UPLOADS_DIR = join(uploadsRoot, "logos");
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

async function bufferMultipartFile(
  stream: NodeJS.ReadableStream,
  maxBytes: number
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error("FILE_TOO_LARGE");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function uploadsRoutes(app: FastifyInstance) {
  await mkdir(UPLOADS_DIR, { recursive: true });

  app.post(
    "/logo",
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request, reply) => {
      const companyId = request.user!.companyId;
      const data = await request.file();

      if (!data) {
        return reply.code(400).send({
          error: "No file",
          message: "Please select an image file to upload",
        });
      }

      if (!ALLOWED_TYPES.includes(data.mimetype)) {
        return reply.code(400).send({
          error: "Invalid file type",
          message: "Allowed: JPEG, PNG, GIF, WebP",
        });
      }

      let fileBuffer: Buffer;
      try {
        fileBuffer = await bufferMultipartFile(data.file, MAX_BYTES);
      } catch (err) {
        if (err instanceof Error && err.message === "FILE_TOO_LARGE") {
          return reply.code(400).send({ error: "File too large", message: "Max size is 5MB" });
        }
        request.log.error({ err, requestId: request.requestId }, "logo upload read failed");
        return reply.code(500).send({ error: "Upload failed", message: "Could not read the file" });
      }

      if (!matchesMagicBytes(fileBuffer, data.mimetype)) {
        request.log.warn({ requestId: request.requestId, mimetype: data.mimetype }, "logo upload rejected");
        return reply.code(400).send({
          error: "Invalid file",
          message: "File content does not match declared image type",
        });
      }

      const ext = extensionForMime(data.mimetype);
      const filename = `${randomUUID()}.${ext}`;
      const filepath = join(UPLOADS_DIR, filename);

      try {
        const { writeFile } = await import("fs/promises");
        await writeFile(filepath, fileBuffer, { flag: "wx" });
      } catch (err) {
        request.log.error({ err, requestId: request.requestId }, "logo upload save failed");
        return reply.code(500).send({
          error: "Upload failed",
          message: "Could not save the file",
        });
      }

      const url = `/api/uploads/logos/${filename}`;
      return reply.send({ url });
    }
  );
}
