import type { FastifyInstance } from "fastify";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { pipeline } from "stream/promises";
import { join } from "path";
import { authMiddleware } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/rbac.js";

const UPLOADS_DIR = join(process.cwd(), "uploads", "logos");
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

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

      const ext = data.mimetype.split("/")[1] || "png";
      const filename = `company-${companyId}.${ext}`;
      const filepath = join(UPLOADS_DIR, filename);

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

      const url = `/api/uploads/logos/${filename}`;
      return reply.send({ url });
    }
  );
}
