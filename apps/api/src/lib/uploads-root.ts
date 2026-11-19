import { join } from "node:path";

/**
 * Writable base for uploads. Override with UPLOADS_DIR (e.g. Railway volume mount path).
 */
const configuredUploadsRoot =
  process.env.UPLOADS_DIR?.trim() ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();

const storageDriver = process.env.STORAGE_DRIVER?.trim().toLowerCase() || "local";

if (process.env.NODE_ENV === "production" && storageDriver !== "s3" && !configuredUploadsRoot) {
  throw new Error(
    "Persistent uploads are required in production. Set STORAGE_DRIVER=s3 with AWS_S3_BUCKET, attach a Railway Volume, or set UPLOADS_DIR."
  );
}

export const uploadsRoot = configuredUploadsRoot || join(process.cwd(), "uploads");
