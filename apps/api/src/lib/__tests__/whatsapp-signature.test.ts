import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWhatsAppWebhookSignature } from "../whatsapp-signature.js";

describe("verifyWhatsAppWebhookSignature", () => {
  const secret = "test-app-secret";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  function sign(payload: string): string {
    return `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
  }

  it("accepts a valid signature", () => {
    expect(verifyWhatsAppWebhookSignature(body, sign(body), secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyWhatsAppWebhookSignature(body, sign('{"object":"evil"}'), secret)).toBe(false);
  });

  it("rejects missing or malformed headers", () => {
    expect(verifyWhatsAppWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyWhatsAppWebhookSignature(body, "sha1=deadbeef", secret)).toBe(false);
  });
});
