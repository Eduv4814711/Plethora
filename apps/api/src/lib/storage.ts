import { mkdir, unlink, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { uploadsRoot } from "./uploads-root.js";
import { createSignedDownloadPath } from "./signed-url.js";

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
  readLocalFile(key: string): Promise<Buffer>;
}

export function normalizeStorageKey(key: string): string {
  return key.replace(/^\/+/, "");
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

  async getSignedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const normalized = normalizeStorageKey(key);
    if (normalized.startsWith("logos/")) {
      return this.getPublicUrl(normalized);
    }
    return createSignedDownloadPath(normalized, expiresInSeconds).path;
  },

  /**
   * URL stored in the DB / returned for logos. Non-logo keys resolve to
   * `/uploads/...` paths that are NOT publicly served — clients must use
   * `getSignedUrl` (or document download) to fetch the bytes.
   */
  getAssetUrl(key: string): string {
    return this.getPublicUrl(key);
  },

  async readLocalFile(key: string): Promise<Buffer> {
    return readFile(join(uploadsRoot, normalizeStorageKey(key)));
  },

  resolveKeyFromUrl(url: string): string | null {
    const trimmed = url.trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed)) return null;

    let path = trimmed;
    if (path.startsWith("/uploads/")) path = path.slice("/uploads/".length);
    else if (path.startsWith("uploads/")) path = path.slice("uploads/".length);

    const normalized = normalizeStorageKey(path);
    return normalized || null;
  },
};
