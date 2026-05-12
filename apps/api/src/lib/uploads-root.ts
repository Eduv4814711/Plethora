import { join } from "node:path";

/**
 * Writable base for uploads. Override with UPLOADS_DIR (e.g. Docker volume path).
 */
export const uploadsRoot =
  process.env.UPLOADS_DIR ?? join(process.cwd(), "uploads");
