import { join } from "node:path";

/**
 * Writable base for uploads. Override with UPLOADS_DIR (e.g. Railway volume mount path).
 */
export const uploadsRoot =
  process.env.UPLOADS_DIR ?? join(process.cwd(), "uploads");
