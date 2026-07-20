import { join } from "node:path";

/**
 * Writable base for uploads. Override with UPLOADS_DIR (e.g. Railway volume mount path).
 */
const configuredUploadsRoot =
  process.env.UPLOADS_DIR?.trim() ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();

if (process.env.NODE_ENV === "production" && !configuredUploadsRoot) {
  throw new Error(
    "Persistent uploads are required in production. Attach a Railway Volume or set UPLOADS_DIR."
  );
}

export const uploadsRoot = configuredUploadsRoot || join(process.cwd(), "uploads");
