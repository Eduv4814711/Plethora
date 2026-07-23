const BLOCKED_MIMES = new Set(["image/svg+xml", "text/html", "application/xhtml+xml"]);
const LEGACY_OFFICE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const OOXML_MIMES = new Map<string, string>([
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "word/"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xl/"],
]);

export function sanitizeUploadFilename(name: string, mime?: string): string {
  const base = name
    .replace(/[/\\]/g, "")
    .replace(/\.\./g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "_")
    .trim();
  const safe = base.slice(0, 120) || "file";
  if (!mime) return safe;

  const extension = extensionForMime(mime);
  if (extension === "bin") return safe;
  const stem = safe.replace(/\.[A-Za-z0-9]{1,12}$/u, "").trim() || "file";
  return `${stem.slice(0, Math.max(1, 119 - extension.length))}.${extension}`;
}

export function extensionForMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt",
    "text/csv": "csv",
  };
  return map[mime] ?? "bin";
}

function startsWith(buffer: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function isUtf8Text(buffer: Buffer): boolean {
  if (buffer.length === 0 || buffer.includes(0)) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return !/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(text);
  } catch {
    return false;
  }
}

/**
 * Validate the declared MIME against an independently inspected file
 * signature. OOXML files are also checked for their expected archive root so
 * an arbitrary ZIP cannot be relabelled as a Word or Excel document.
 */
export function matchesMagicBytes(buffer: Buffer, mime: string): boolean {
  if (BLOCKED_MIMES.has(mime)) return false;
  switch (mime) {
    case "image/jpeg":
      return startsWith(buffer, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif":
      return buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
        buffer.subarray(0, 6).toString("ascii") === "GIF89a";
    case "image/webp":
      return startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP";
    case "application/pdf":
      return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
    case "application/msword":
    case "application/vnd.ms-excel":
      return startsWith(buffer, [...LEGACY_OFFICE_MAGIC]);
    case "text/plain":
      return isUtf8Text(buffer);
    case "text/csv":
      return isUtf8Text(buffer) && /[,;\t\r\n]/.test(buffer.toString("utf8"));
    default: {
      const expectedRoot = OOXML_MIMES.get(mime);
      if (!expectedRoot || !startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return false;
      const archiveDirectory = buffer.toString("latin1");
      return archiveDirectory.includes("[Content_Types].xml") &&
        archiveDirectory.includes(expectedRoot);
    }
  }
}

export async function readStreamPrefix(
  stream: NodeJS.ReadableStream,
  maxBytes: number
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const room = maxBytes - total;
    if (room <= 0) break;
    const slice = buf.length > room ? buf.subarray(0, room) : buf;
    chunks.push(slice);
    total += slice.length;
    if (total >= maxBytes) break;
  }
  return Buffer.concat(chunks);
}
