import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as getS3SignedUrl } from "@aws-sdk/s3-request-presigner";
import { uploadsRoot } from "./uploads-root.js";
import { env } from "./env.js";

export type StorageDriver = "local" | "s3";

export interface UploadFileOptions {
  key: string;
  body: Buffer;
  contentType?: string;
  cacheControl?: string;
}

export interface StorageStreamResult {
  stream: Readable;
  contentLength?: number;
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
  getObjectStream?(key: string): Promise<StorageStreamResult | null>;
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
  return env.storage.driver === "local";
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

function resolveKeyFromStoredUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  let path = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      path = parsed.pathname;
    } catch {
      return null;
    }
  }

  if (path.startsWith("/uploads/")) path = path.slice("/uploads/".length);
  else if (path.startsWith("uploads/")) path = path.slice("uploads/".length);
  else if (/^https?:\/\//i.test(trimmed)) return null;

  try {
    return normalizeStorageKey(path);
  } catch {
    return null;
  }
}

export function createLocalStorageService(): StorageService {
  return {
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
      return resolveKeyFromStoredUrl(trimmed);
    },
  };
}

export interface S3StorageConfig {
  bucket: string;
  region: string;
  client?: S3Client;
}

export function createS3StorageService(config: S3StorageConfig): StorageService {
  const client = config.client ?? new S3Client({ region: config.region });

  return {
    driver: "s3",

    async uploadFile({ key, body, contentType, cacheControl }): Promise<void> {
      const normalized = normalizeStorageKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: normalized,
          Body: body,
          ContentType: contentType ?? "application/octet-stream",
          CacheControl: cacheControl ?? "private, max-age=0, no-store",
        })
      );
    },

    async deleteFile(key: string): Promise<void> {
      const normalized = normalizeStorageKey(key);
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: normalized,
        })
      );
    },

    getPublicUrl(key: string): string {
      return `/uploads/${normalizeStorageKey(key)}`;
    },

    async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
      const normalized = normalizeStorageKey(key);
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: normalized,
      });
      return getS3SignedUrl(client, command, { expiresIn: expiresInSeconds });
    },

    getAssetUrl(key: string): string {
      return this.getPublicUrl(key);
    },

    resolveKeyFromUrl(url: string): string | null {
      return resolveKeyFromStoredUrl(url);
    },

    async getObjectStream(key: string): Promise<StorageStreamResult | null> {
      const normalized = normalizeStorageKey(key);
      try {
        const res = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: normalized,
          })
        );
        if (!res.Body) return null;
        return {
          stream: res.Body as Readable,
          contentLength: typeof res.ContentLength === "number" ? res.ContentLength : undefined,
        };
      } catch (err) {
        const name = (err as { name?: string })?.name;
        if (name === "NoSuchKey" || name === "NotFound") return null;
        throw err;
      }
    },
  };
}

export const storage: StorageService =
  env.storage.driver === "s3" && env.storage.bucket
    ? createS3StorageService({
        bucket: env.storage.bucket,
        region: env.storage.region,
      })
    : createLocalStorageService();
