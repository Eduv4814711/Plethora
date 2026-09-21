import { describe, expect, it } from "vitest";
import { normalizeWhatsAppPhone, formatPhoneForWaMe } from "../phone.js";

describe("phone normalization utilities", () => {
  it("normalizes South African numbers with leading 0 to 27 prefix", () => {
    expect(normalizeWhatsAppPhone("0821234567")).toBe("27821234567");
    expect(normalizeWhatsAppPhone("082 123 4567")).toBe("27821234567");
    expect(normalizeWhatsAppPhone("(082) 123-4567")).toBe("27821234567");
  });

  it("normalizes South African numbers with international +27 prefix", () => {
    expect(normalizeWhatsAppPhone("+27 82 123 4567")).toBe("27821234567");
    expect(normalizeWhatsAppPhone("+27821234567")).toBe("27821234567");
    expect(normalizeWhatsAppPhone("27821234567")).toBe("27821234567");
  });

  it("handles non-South African international numbers without converting to 27", () => {
    expect(normalizeWhatsAppPhone("+1 (555) 234-5678")).toBe("15552345678");
    expect(normalizeWhatsAppPhone("+44 7911 123456")).toBe("447911123456");
  });

  it("handles empty, null, and undefined inputs safely", () => {
    expect(normalizeWhatsAppPhone("")).toBe("");
    expect(normalizeWhatsAppPhone(null)).toBe("");
    expect(normalizeWhatsAppPhone(undefined)).toBe("");
    expect(normalizeWhatsAppPhone("   ")).toBe("");
  });

  it("generates correct wa.me URLs", () => {
    expect(formatPhoneForWaMe("0821234567")).toBe("https://wa.me/27821234567");
    expect(formatPhoneForWaMe("+27 82 123 4567")).toBe("https://wa.me/27821234567");
    expect(formatPhoneForWaMe(null)).toBe(null);
    expect(formatPhoneForWaMe("")).toBe(null);
  });
});
