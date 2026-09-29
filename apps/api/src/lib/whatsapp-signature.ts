import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify Meta WhatsApp webhook X-Hub-Signature-256 header.
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 */
export function verifyWhatsAppWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader?.startsWith("sha256=") || !appSecret) return false;
  const expected = signatureHeader.slice("sha256=".length).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(expected)) return false;

  const computed = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    const compBuf = Buffer.from(computed, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (compBuf.length !== expBuf.length) return false;
    return timingSafeEqual(compBuf, expBuf);
  } catch {
    return false;
  }
}
