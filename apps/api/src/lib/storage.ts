import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { uploadsRoot } from "./uploads-root.js";

export type StorageDriver = "local";

export interface UploadFileOptions {
  key: string;
  body: Buffer;
  contentType?: string;
  cacheControl?: string;
}

export interface StorageService {
  readonly driver: StorageDriver;
  uploadFile(options: UploadFileOptions): Promise<void>;
  deleteFile(key: string): Promise<void>;
  getPublicUrl(key: string): string;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** URL persisted or returned to clients. */
  getAssetUrl(key: string): string;
  resolveKeyFromUrl(url: string): string | null;
}

export interface UploadedFileRollbackOptions {
  deleteFile?: (key: string) => Promise<void>;
  onCleanupError?: (error: unknown) => void;
}

export function normalizeStorageKey(key: string): string {
  const normalized = key.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  const isSafeSegment = (segment: string) =>
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment) &&
    segment !== "." &&
    segment !== "..";

  if (!normalized || segments.some((segment) => !isSafeSegment(segment))) {
    throw new Error("INVALID_STORAGE_KEY");
  }

  return segments.join("/");
}

export function isLocalStorage(): boolean {
  return true;
}

export async function readStreamToBuffer(
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

/**
 * Persist metadata for a file that has already been uploaded. If persistence
 * fails, remove the orphaned file and keep the original persistence error.
 */
export async function persistWithUploadedFileRollback<T>(
  key: string,
  persist: () => Promise<T>,
  options: UploadedFileRollbackOptions = {}
): Promise<T> {
  try {
    return await persist();
  } catch (error) {
    try {
      await (options.deleteFile ?? ((candidate) => storage.deleteFile(candidate)))(key);
    } catch (cleanupError) {
      options.onCleanupError?.(cleanupError);
    }
    throw error;
  }
}

export const storage: StorageService = {
  driver: "local",

  async uploadFile({ key, body }): Promise<void> {
    const normalized = normalizeStorageKey(key);
    const filepath = join(uploadsRoot, normalized);
    await mkdir(dirname(filepath), { recursive: true });
    await writeFile(filepath, body, { flag: "wx" });
  },

  async deleteFile(key: string): Promise<void> {
    const filepath = join(uploadsRoot, normalizeStorageKey(key));
    try {
      await unlink(filepath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  },

  getPublicUrl(key: string): string {
    return `/uploads/${normalizeStorageKey(key)}`;
  },

  async getSignedUrl(key: string): Promise<string> {
    return this.getPublicUrl(key);
  },

  getAssetUrl(key: string): string {
    return this.getPublicUrl(key);
  },

  resolveKeyFromUrl(url: string): string | null {
    const trimmed = url.trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed)) return null;

    let path = trimmed;
    if (path.startsWith("/uploads/")) path = path.slice("/uploads/".length);
    else if (path.startsWith("uploads/")) path = path.slice("uploads/".length);

    try {
      return normalizeStorageKey(path);
    } catch {
      return null;
    }
  },
};
