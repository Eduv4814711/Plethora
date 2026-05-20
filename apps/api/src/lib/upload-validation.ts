const MAGIC: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
];

const BLOCKED_MIMES = new Set(["image/svg+xml", "text/html", "application/xhtml+xml"]);

export function sanitizeUploadFilename(name: string): string {
  const base = name.replace(/[/\\]/g, "").replace(/\.\./g, "").trim();
  return base.slice(0, 120) || "file";
}

export function extensionForMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  return map[mime] ?? "bin";
}

export function matchesMagicBytes(buffer: Buffer, mime: string): boolean {
  if (BLOCKED_MIMES.has(mime)) return false;
  const rule = MAGIC.find((r) => r.mime === mime);
  if (!rule) return false;
  const offset = rule.offset ?? 0;
  if (buffer.length < offset + rule.bytes.length) return false;
  return rule.bytes.every((b, i) => buffer[offset + i] === b);
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
