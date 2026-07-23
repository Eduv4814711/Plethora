import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { FastifyReply } from "fastify";
import { uploadsRoot } from "./uploads-root.js";
import { normalizeStorageKey, storage } from "./storage.js";
import { sanitizeUploadFilename } from "./upload-validation.js";

const SAFE_DOWNLOAD_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

export function privateDownloadUrl(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function resolvePrivateStorageKey(
  storedReference: string,
  allowedPrefixes: readonly string[]
): string | null {
  const key = storage.resolveKeyFromUrl(storedReference);
  if (!key) return null;

  const prefixes = allowedPrefixes.map((prefix) => {
    const normalized = normalizeStorageKey(prefix);
    return normalized.endsWith("/") ? normalized : `${normalized}/`;
  });
  if (!prefixes.some((prefix) => key.startsWith(prefix))) return null;
  return key;
}

function safeAttachmentName(name: string): { ascii: string; encoded: string } {
  const safe = name.replace(/[\u0000-\u001F\u007F"\\]/g, "_").trim() || "download";
  return {
    ascii: safe.replace(/[^\x20-\x7E]/g, "_"),
    encoded: encodeURIComponent(safe).replace(
      /['()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    ),
  };
}

export async function sendPrivateStoredFile(
  reply: FastifyReply,
  options: {
    storedReference: string;
    allowedPrefixes: readonly string[];
    fileName: string;
    mimeType: string;
  }
) {
  const key = resolvePrivateStorageKey(options.storedReference, options.allowedPrefixes);
  if (!key) {
    return reply.code(404).send({ error: "Not found", message: "Stored file not found" });
  }

  const root = resolve(uploadsRoot);
  const candidatePath = resolve(join(root, ...key.split("/")));
  if (!candidatePath.startsWith(`${root}${sep}`)) {
    return reply.code(404).send({ error: "Not found", message: "Stored file not found" });
  }

  let fileStats;
  let filePath: string;
  try {
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(candidatePath)]);
    if (!realFile.startsWith(`${realRoot}${sep}`)) {
      return reply.code(404).send({ error: "Not found", message: "Stored file not found" });
    }
    filePath = realFile;
    fileStats = await stat(filePath);
  } catch {
    return reply.code(404).send({ error: "Not found", message: "Stored file not found" });
  }
  if (!fileStats.isFile()) {
    return reply.code(404).send({ error: "Not found", message: "Stored file not found" });
  }

  const name = safeAttachmentName(
    sanitizeUploadFilename(options.fileName, options.mimeType)
  );
  reply.header(
    "content-type",
    SAFE_DOWNLOAD_MIMES.has(options.mimeType) ? options.mimeType : "application/octet-stream"
  );
  reply.header("content-length", String(fileStats.size));
  reply.header(
    "content-disposition",
    `attachment; filename="${name.ascii}"; filename*=UTF-8''${name.encoded}`
  );
  reply.header("cache-control", "private, no-store");
  reply.header("pragma", "no-cache");
  reply.header("x-content-type-options", "nosniff");
  return reply.send(createReadStream(filePath));
}
