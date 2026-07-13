import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { authProtect } from "../middleware/auth-protect.js";
import { requireAdmin } from "../middleware/rbac.js";
import { readStreamToBuffer, storage } from "../lib/storage.js";
import { extensionForMime, matchesMagicBytes } from "../lib/upload-validation.js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

export async function uploadsRoutes(app: FastifyInstance) {
  app.post(
    "/logo",
    { preHandler: [...authProtect, requireAdmin()] },
    async (request, reply) => {
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
        fileBuffer = await readStreamToBuffer(data.file, MAX_BYTES);
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
      const key = `logos/${filename}`;

      try {
        await storage.uploadFile({
          key,
          body: fileBuffer,
          contentType: data.mimetype,
        });
      } catch (err) {
        request.log.error({ err, requestId: request.requestId }, "logo upload save failed");
        return reply.code(500).send({
          error: "Upload failed",
          message: "Could not save the file",
        });
      }

      const url = storage.getAssetUrl(key);
      return reply.send({ url });
    }
  );
}
