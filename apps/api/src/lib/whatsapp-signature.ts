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
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = signatureHeader.slice("sha256=".length);
  const computed = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    return timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}
