import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const DEFAULT_TTL_SECONDS = 15 * 60;

export function createDownloadSignature(key: string, expiresAt: number): string {
  return createHmac("sha256", config.jwt.accessSecret)
    .update(`${key}:${expiresAt}`)
    .digest("hex");
}

export function createSignedDownloadPath(
  key: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  downloadPath = "/documents/download"
): { path: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createDownloadSignature(key, expiresAt);
  const q = new URLSearchParams({
    key,
    expires: String(expiresAt),
    sig,
  });
  return { path: `${downloadPath}?${q.toString()}`, expiresAt };
}

export function verifySignedDownload(
  key: string,
  expires: string | undefined,
  sig: string | undefined
): boolean {
  const expiresAt = Number(expires);
  if (!key || !sig || !Number.isFinite(expiresAt)) return false;
  if (expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = createDownloadSignature(key, expiresAt);
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
