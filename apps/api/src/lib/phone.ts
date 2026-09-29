/**
 * Shared phone normalization utilities for Plethora ERP.
 *
 * Used for WhatsApp messaging, click-to-chat URLs, and employee phone lookups.
 * South African numbers are formatted as 27XXXXXXXXX (11 digits, country code 27).
 * International numbers preserve their international country code without '+' or formatting.
 */

/**
 * Normalizes a phone number into digits-only international format suitable for Meta WhatsApp APIs
 * and database lookups.
 *
 * Examples:
 * - "+27 82 123 4567" -> "27821234567"
 * - "082 123 4567" (SA domestic) -> "27821234567"
 * - "27821234567" -> "27821234567"
 * - "+1 (555) 234-5678" -> "15552345678"
 */
export function normalizeWhatsAppPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const trimmed = phone.trim();
  if (!trimmed) return "";

  // Remove all non-digit characters
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  // South African standard mobile/landline numbers:
  // Starts with '0' and has 10 digits (e.g. 0821234567) -> prefix with SA country code 27
  if (digits.startsWith("0") && digits.length === 10) {
    return "27" + digits.slice(1);
  }

  // Already prefixed with SA country code 27 and standard length (11 digits)
  if (digits.startsWith("27") && digits.length === 11) {
    return digits;
  }

  return digits;
}

export const normalizePhoneNumber = normalizeWhatsAppPhone;

/**
 * Generate a wa.me direct click-to-chat URL.
 */
export function formatPhoneForWaMe(phone: string | null | undefined): string | null {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}`;
}
