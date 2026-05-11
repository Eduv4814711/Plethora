import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Writable base for local uploads. Vercel serverless has a read-only project root;
 * use /tmp (ephemeral). Override with UPLOADS_DIR for Docker or persistent disks.
 */
export const uploadsRoot =
  process.env.UPLOADS_DIR ??
  (process.env.VERCEL === "1" ? join(tmpdir(), "plethora-uploads") : join(process.cwd(), "uploads"));
