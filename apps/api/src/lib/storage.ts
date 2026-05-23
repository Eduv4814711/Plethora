import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env.js";
import { uploadsRoot } from "./uploads-root.js";

export type StorageDriver = "local" | "s3";

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
  /** URL persisted or returned to clients (local path or S3/CDN URL). */
  getAssetUrl(key: string, options?: { proxied?: boolean }): string;
  resolveKeyFromUrl(url: string): string | null;
}

const DEFAULT_SIGNED_URL_TTL_SEC = 3600;

export function normalizeStorageKey(key: string): string {
  return key.replace(/^\/+/, "");
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function createLocalStorageService(): StorageService {
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

    getAssetUrl(key: string, options?: { proxied?: boolean }): string {
      const path = this.getPublicUrl(key);
      return options?.proxied ? `/api${path}` : path;
    },

    resolveKeyFromUrl(url: string): string | null {
      const trimmed = url.trim();
      if (!trimmed || /^https?:\/\//i.test(trimmed)) return null;

      let path = trimmed;
      if (path.startsWith("/api/uploads/")) path = path.slice("/api/uploads/".length);
      else if (path.startsWith("/uploads/")) path = path.slice("/uploads/".length);
      else if (path.startsWith("uploads/")) path = path.slice("uploads/".length);

      const normalized = normalizeStorageKey(path);
      return normalized || null;
    },
  };
}

function createS3StorageService(): StorageService {
  const bucket = env.storage.s3BucketName!;
  const region = env.storage.awsRegion!;
  const publicBase = env.storage.s3PublicBaseUrl
    ? trimTrailingSlash(env.storage.s3PublicBaseUrl)
    : undefined;

  const client = new S3Client({ region });

  return {
    driver: "s3",

    async uploadFile({ key, body, contentType, cacheControl }): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: normalizeStorageKey(key),
          Body: body,
          ContentType: contentType,
          CacheControl: cacheControl,
        })
      );
    },

    async deleteFile(key: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: normalizeStorageKey(key),
        })
      );
    },

    getPublicUrl(key: string): string {
      const normalized = normalizeStorageKey(key);
      if (publicBase) {
        return `${publicBase}/${normalized}`;
      }
      return `https://${bucket}.s3.${region}.amazonaws.com/${normalized}`;
    },

    async getSignedUrl(key: string, expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SEC): Promise<string> {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: normalizeStorageKey(key),
        }),
        { expiresIn: expiresInSeconds }
      );
    },

    getAssetUrl(key: string): string {
      return this.getPublicUrl(key);
    },

    resolveKeyFromUrl(url: string): string | null {
      const trimmed = url.trim();
      if (!trimmed) return null;

      if (publicBase && trimmed.startsWith(publicBase)) {
        return normalizeStorageKey(trimmed.slice(publicBase.length)) || null;
      }

      try {
        const parsed = new URL(trimmed);
        const host = parsed.hostname.toLowerCase();
        const isBucketHost =
          host === `${bucket}.s3.${region}.amazonaws.com`.toLowerCase() ||
          host === `${bucket}.s3.amazonaws.com`.toLowerCase() ||
          host.startsWith(`${bucket}.s3.`);
        if (isBucketHost || (publicBase && parsed.origin === new URL(publicBase).origin)) {
          return normalizeStorageKey(parsed.pathname) || null;
        }
      } catch {
        return null;
      }

      return null;
    },
  };
}

function assertStorageEnv(): void {
  if (env.storage.driver !== "s3") return;

  const errors: string[] = [];
  if (!env.storage.awsRegion) {
    errors.push("AWS_REGION is required when STORAGE_DRIVER=s3.");
  }
  if (!env.storage.s3BucketName) {
    errors.push("S3_BUCKET_NAME is required when STORAGE_DRIVER=s3.");
  }
  if (errors.length > 0) {
    throw new Error(
      `Invalid storage configuration:\n${errors.map((e) => `- ${e}`).join("\n")}`
    );
  }
}

function createStorageService(): StorageService {
  assertStorageEnv();
  return env.storage.driver === "s3" ? createS3StorageService() : createLocalStorageService();
}

export const storage: StorageService = createStorageService();
